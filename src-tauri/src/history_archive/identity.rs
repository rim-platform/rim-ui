//! The identity key in the archive: each device's sealed backup of an account's identity key,
//! and each device's wraps of the archive key under the identity keys it holds.
//!
//! ```text
//! <folder>/
//!   devices/<device id>/key-wraps.json                            archive key wrapped (plain JSON)
//!   accounts/<account tag>/devices/<device id>/identity-backup.rimx   identity key, sealed
//! ```
//!
//! Both are written only by the device whose id they carry. The backup is sealed under the
//! backup key, which only the recovery kit's secret gives, so the archive's passphrase does not
//! open it. The keys come from `key_identity`; this module sees them as 32 opaque bytes.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::archive::Archive;
use super::crypto::{self, ArchiveKey};
use super::format::{
    self, check_id, devices_dir, file_path, FileKind, FilePlace, IDENTITY_BACKUP_NAME,
};
use super::{ArchiveError, ArchiveStatus, HistoryArchiveState};
use crate::message_cache::AccountId;

/// The directory of per-device files outside any account.
const KEY_WRAP_DEVICES_DIR: &str = "devices";
/// A device's key wrap file inside its directory.
const KEY_WRAP_FILE_NAME: &str = "key-wraps.json";
/// `format` of a key wrap file.
const KEY_WRAP_FORMAT: &str = "rim-history-archive-key-wraps";
/// `kind` of a wrap under an identity key.
pub(crate) const IDENTITY_WRAP_KIND: &str = "identity-v1";

fn key_wrap_path(device_id: &str) -> String {
    format!("{KEY_WRAP_DEVICES_DIR}/{device_id}/{KEY_WRAP_FILE_NAME}")
}

/// What an identity wrap authenticates besides the key: the archive and the account.
fn identity_wrap_aad(archive_id: &str, account_tag: &str) -> Vec<u8> {
    format!("rim-history-archive v1 identity key wrap\0{archive_id}\0{account_tag}").into_bytes()
}

/// `devices/<device id>/key-wraps.json`. Entries of a kind this build does not know are kept
/// as they are when the device rewrites the file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyWrapFile {
    format: String,
    v: u32,
    archive_id: String,
    device_id: String,
    key_wraps: Vec<serde_json::Value>,
}

/// An `identity-v1` entry: the archive key under a key derived from an identity key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityWrap {
    kind: String,
    /// The account tag of the account whose identity key it is.
    account: String,
    /// Base64 XChaCha20-Poly1305 nonce.
    nonce: String,
    /// Base64 ciphertext of the 32-byte archive key, tag included.
    wrapped: String,
}

impl IdentityWrap {
    fn from_value(value: &serde_json::Value) -> Option<Self> {
        if value.get("kind").and_then(|k| k.as_str()) != Some(IDENTITY_WRAP_KIND) {
            return None;
        }
        serde_json::from_value(value.clone()).ok()
    }

    fn seal(
        archive_id: &str,
        account_tag: &str,
        wrap_key: &[u8; 32],
        key: &ArchiveKey,
    ) -> Result<Self, ArchiveError> {
        let (nonce, wrapped) = crypto::seal(
            wrap_key,
            &identity_wrap_aad(archive_id, account_tag),
            key.as_bytes(),
        )?;
        Ok(Self {
            kind: IDENTITY_WRAP_KIND.into(),
            account: account_tag.into(),
            nonce: STANDARD.encode(nonce),
            wrapped: STANDARD.encode(wrapped),
        })
    }

    /// The archive key, if `wrap_key` opens this wrap. A wrap under another key is `None`.
    fn open(&self, archive_id: &str, wrap_key: &[u8; 32]) -> Option<ArchiveKey> {
        let nonce = STANDARD.decode(&self.nonce).ok()?;
        let wrapped = STANDARD.decode(&self.wrapped).ok()?;
        let bytes = crypto::open(
            wrap_key,
            &nonce,
            &identity_wrap_aad(archive_id, &self.account),
            &wrapped,
        )
        .ok()?;
        ArchiveKey::from_slice(&bytes)
    }
}

/// A device's key wrap file, or `None` when it is missing, unreadable, or names another
/// archive or device.
fn read_key_wraps(archive: &Archive, device_id: &str) -> Result<Option<KeyWrapFile>, ArchiveError> {
    let Some(bytes) = archive.provider().read(&key_wrap_path(device_id))? else {
        return Ok(None);
    };
    match serde_json::from_slice::<KeyWrapFile>(&bytes) {
        Ok(file)
            if file.format == KEY_WRAP_FORMAT
                && file.archive_id == archive.id()
                && file.device_id == device_id =>
        {
            Ok(Some(file))
        }
        Ok(_) => Ok(None),
        Err(e) => {
            log::warn!("[history_archive] unreadable key wrap file: {e}");
            Ok(None)
        }
    }
}

/// What a write of the identity key's files did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct IdentityWrite {
    pub backup_written: bool,
    pub wrap_written: bool,
}

/// The identity key backups found for an account.
#[derive(Default)]
pub(crate) struct IdentityBackups {
    /// Backup files found, opened or not.
    pub found: usize,
    /// The plaintext of each backup the backup key opened.
    pub opened: Vec<Zeroizing<Vec<u8>>>,
}

impl HistoryArchiveState {
    /// Write this device's identity files for `account`: the wrap of the archive key under
    /// `wrap_key`, replacing any earlier wrap of this device for the account, and, with a
    /// backup key, the sealed `backup` record. A file that already holds the same is left as it
    /// is, so calling this again changes nothing.
    pub(crate) fn write_identity(
        &self,
        account: &AccountId,
        backup: Option<(&[u8; 32], &[u8])>,
        wrap_key: &[u8; 32],
    ) -> Result<IdentityWrite, ArchiveError> {
        let _op = self.op.lock().unwrap_or_else(|e| e.into_inner());
        let archive = self.open_archive(account)?;
        let device_id = self.device_id()?;
        check_id(&device_id)?;
        let tag = archive.key().account_tag(&account.label());
        let wrap_written = write_wrap(&archive, &device_id, &tag, wrap_key)?;
        let backup_written = match backup {
            Some((backup_key, plaintext)) => {
                write_backup(&archive, &device_id, &tag, backup_key, plaintext)?
            }
            None => false,
        };
        Ok(IdentityWrite {
            backup_written,
            wrap_written,
        })
    }

    /// Every device's identity key backup for `account`, opened with `backup_key`. A backup
    /// that does not open (another account's key, a damaged file) is counted but not returned.
    pub(crate) fn read_identity_backups(
        &self,
        account: &AccountId,
        backup_key: &[u8; 32],
    ) -> Result<IdentityBackups, ArchiveError> {
        let _op = self.op.lock().unwrap_or_else(|e| e.into_inner());
        let archive = self.open_archive(account)?;
        let tag = archive.key().account_tag(&account.label());
        let mut backups = IdentityBackups::default();
        for device_id in archive.provider().list_dirs(&devices_dir(&tag))? {
            if check_id(&device_id).is_err() {
                continue;
            }
            let path = file_path(&tag, &device_id, IDENTITY_BACKUP_NAME);
            let Some(bytes) = archive.provider().read(&path)? else {
                continue;
            };
            backups.found += 1;
            let place = FilePlace {
                archive_id: archive.id(),
                account_tag: &tag,
                device_id: &device_id,
                name: IDENTITY_BACKUP_NAME,
            };
            match format::open_file_under(backup_key, FileKind::IdentityBackup, &place, &bytes) {
                Ok(plaintext) => backups.opened.push(plaintext),
                Err(e) => log::warn!("[history_archive] identity backup does not open: {e}"),
            }
        }
        Ok(backups)
    }

    /// Whether one of `wrap_keys` opens a wrap of the account's archive key.
    pub(crate) fn can_unlock_with_identity(
        &self,
        account: &AccountId,
        wrap_keys: &[Zeroizing<[u8; 32]>],
    ) -> Result<bool, ArchiveError> {
        if wrap_keys.is_empty() {
            return Ok(false);
        }
        Ok(self.find_identity_wrap(account, wrap_keys)?.is_some())
    }

    /// Put the archive key back on this device from a wrap one of `wrap_keys` opens.
    pub(crate) fn unlock_with_identity(
        &self,
        account: &AccountId,
        wrap_keys: &[Zeroizing<[u8; 32]>],
    ) -> Result<ArchiveStatus, ArchiveError> {
        let (archive_id, key) = self
            .find_identity_wrap(account, wrap_keys)?
            .ok_or(ArchiveError::NoIdentityWrap)?;
        self.keys.set(&archive_id, &key)?;
        self.status(account)
    }

    /// The account's archive id and key from the first wrap, of any device, that one of
    /// `wrap_keys` opens and that names this account. Wraps under other keys are skipped.
    fn find_identity_wrap(
        &self,
        account: &AccountId,
        wrap_keys: &[Zeroizing<[u8; 32]>],
    ) -> Result<Option<(String, ArchiveKey)>, ArchiveError> {
        account.validate()?;
        let config = self.config(account)?.ok_or(ArchiveError::NotConfigured)?;
        let provider = self.open_provider(&config.provider)?;
        let manifest = Archive::inspect(provider.as_ref())?.ok_or_else(|| {
            ArchiveError::Unavailable(format!("no archive in {}", provider.describe()))
        })?;
        if manifest.archive_id != config.archive_id {
            return Err(ArchiveError::Mismatch);
        }
        let label = account.label();
        for device_id in provider.list_dirs(KEY_WRAP_DEVICES_DIR)? {
            if check_id(&device_id).is_err() {
                continue;
            }
            let Some(bytes) = provider.read(&key_wrap_path(&device_id))? else {
                continue;
            };
            let Ok(file) = serde_json::from_slice::<KeyWrapFile>(&bytes) else {
                continue;
            };
            if file.format != KEY_WRAP_FORMAT || file.archive_id != config.archive_id {
                continue;
            }
            for wrap in file.key_wraps.iter().filter_map(IdentityWrap::from_value) {
                for wrap_key in wrap_keys {
                    let Some(key) = wrap.open(&config.archive_id, wrap_key) else {
                        continue;
                    };
                    if key.account_tag(&label) == wrap.account {
                        return Ok(Some((config.archive_id.clone(), key)));
                    }
                }
            }
        }
        Ok(None)
    }
}

/// Make this device's key wrap file hold exactly one identity wrap for `tag`, under
/// `wrap_key`. Returns whether the file was written.
fn write_wrap(
    archive: &Archive,
    device_id: &str,
    tag: &str,
    wrap_key: &[u8; 32],
) -> Result<bool, ArchiveError> {
    let mut file = read_key_wraps(archive, device_id)?.unwrap_or_else(|| KeyWrapFile {
        format: KEY_WRAP_FORMAT.into(),
        v: 1,
        archive_id: archive.id().to_string(),
        device_id: device_id.to_string(),
        key_wraps: Vec::new(),
    });
    let for_account: Vec<IdentityWrap> = file
        .key_wraps
        .iter()
        .filter_map(IdentityWrap::from_value)
        .filter(|w| w.account == tag)
        .collect();
    let current = match for_account.as_slice() {
        [only] => only
            .open(archive.id(), wrap_key)
            .is_some_and(|key| key.as_bytes() == archive.key().as_bytes()),
        _ => false,
    };
    if current {
        return Ok(false);
    }
    file.key_wraps
        .retain(|value| IdentityWrap::from_value(value).is_none_or(|w| w.account != tag));
    let wrap = IdentityWrap::seal(archive.id(), tag, wrap_key, archive.key())?;
    file.key_wraps
        .push(serde_json::to_value(&wrap).map_err(|e| ArchiveError::Format(e.to_string()))?);
    let bytes =
        serde_json::to_vec_pretty(&file).map_err(|e| ArchiveError::Format(e.to_string()))?;
    archive
        .provider()
        .write(&key_wrap_path(device_id), &bytes)?;
    Ok(true)
}

/// Seal `plaintext` as this device's identity backup for `tag`, unless the backup there
/// already opens to the same bytes. Returns whether the file was written.
fn write_backup(
    archive: &Archive,
    device_id: &str,
    tag: &str,
    backup_key: &[u8; 32],
    plaintext: &[u8],
) -> Result<bool, ArchiveError> {
    let path = file_path(tag, device_id, IDENTITY_BACKUP_NAME);
    let place = FilePlace {
        archive_id: archive.id(),
        account_tag: tag,
        device_id,
        name: IDENTITY_BACKUP_NAME,
    };
    if let Some(bytes) = archive.provider().read(&path)? {
        let same = format::open_file_under(backup_key, FileKind::IdentityBackup, &place, &bytes)
            .is_ok_and(|existing| existing.as_slice() == plaintext);
        if same {
            return Ok(false);
        }
    }
    let sealed = format::seal_file_under(backup_key, FileKind::IdentityBackup, &place, plaintext)?;
    archive.provider().write(&path, &sealed)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::super::format::seal_file_with_nonce;
    use super::super::tests::Device;
    use super::*;
    use crate::message_cache::tests::account;

    const BACKUP_KEY: [u8; 32] = [5u8; 32];
    const OLD_WRAP: [u8; 32] = [6u8; 32];
    const NEW_WRAP: [u8; 32] = [7u8; 32];

    fn wrap_keys(keys: &[[u8; 32]]) -> Vec<Zeroizing<[u8; 32]>> {
        keys.iter().map(|k| Zeroizing::new(*k)).collect()
    }

    fn wrap_file(folder: &std::path::Path, device: &Device) -> serde_json::Value {
        let bytes = std::fs::read(
            folder
                .join(KEY_WRAP_DEVICES_DIR)
                .join(device.device_id())
                .join(KEY_WRAP_FILE_NAME),
        )
        .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[test]
    fn backups_round_trip_through_a_folder_and_open_only_with_the_backup_key() {
        let folder = tempfile::tempdir().unwrap();
        let a = Device::new("alice");
        let b = Device::new("alice");
        a.connect(folder.path());
        b.connect(folder.path());

        let written = a
            .archive
            .write_identity(&account("alice"), Some((&BACKUP_KEY, b"seed")), &OLD_WRAP)
            .unwrap();
        assert_eq!(
            written,
            IdentityWrite {
                backup_written: true,
                wrap_written: true
            }
        );
        // The same again writes nothing.
        let again = a
            .archive
            .write_identity(&account("alice"), Some((&BACKUP_KEY, b"seed")), &OLD_WRAP)
            .unwrap();
        assert_eq!(again, IdentityWrite::default());

        let read = b
            .archive
            .read_identity_backups(&account("alice"), &BACKUP_KEY)
            .unwrap();
        assert_eq!(read.found, 1);
        assert_eq!(read.opened.len(), 1);
        assert_eq!(read.opened[0].as_slice(), b"seed");

        // The archive key alone (anyone with the passphrase) does not open it.
        let wrong = b
            .archive
            .read_identity_backups(&account("alice"), &[9u8; 32])
            .unwrap();
        assert_eq!(wrong.found, 1);
        assert!(wrong.opened.is_empty());

        // Another account in the same folder has no backup.
        let other = b
            .archive
            .read_identity_backups(&account("bob"), &BACKUP_KEY);
        assert!(matches!(other, Err(ArchiveError::NotConfigured)));
    }

    #[test]
    fn a_new_wrap_replaces_the_old_one_and_the_old_key_no_longer_unlocks() {
        let folder = tempfile::tempdir().unwrap();
        let a = Device::new("alice");
        a.connect(folder.path());
        let alice = account("alice");

        a.archive.write_identity(&alice, None, &OLD_WRAP).unwrap();
        assert!(a
            .archive
            .can_unlock_with_identity(&alice, &wrap_keys(&[OLD_WRAP]))
            .unwrap());

        let written = a.archive.write_identity(&alice, None, &NEW_WRAP).unwrap();
        assert!(written.wrap_written);
        assert!(!written.backup_written);
        let file = wrap_file(folder.path(), &a);
        assert_eq!(file["format"], KEY_WRAP_FORMAT);
        assert_eq!(file["keyWraps"].as_array().unwrap().len(), 1);
        assert_eq!(file["keyWraps"][0]["kind"], IDENTITY_WRAP_KIND);

        assert!(!a
            .archive
            .can_unlock_with_identity(&alice, &wrap_keys(&[OLD_WRAP]))
            .unwrap());
        assert!(a
            .archive
            .can_unlock_with_identity(&alice, &wrap_keys(&[OLD_WRAP, NEW_WRAP]))
            .unwrap());
        assert!(!a.archive.can_unlock_with_identity(&alice, &[]).unwrap());
    }

    #[test]
    fn a_locked_device_unlocks_with_a_wrap_another_device_wrote() {
        let folder = tempfile::tempdir().unwrap();
        let a = Device::new("alice");
        let b = Device::new("alice");
        a.connect(folder.path());
        b.connect(folder.path());
        let alice = account("alice");
        a.archive.write_identity(&alice, None, &NEW_WRAP).unwrap();

        let archive_id = b.archive.status(&alice).unwrap().archive_id.unwrap();
        b.forget_key(&archive_id);
        assert!(!b.archive.status(&alice).unwrap().unlocked);

        assert!(matches!(
            b.archive
                .unlock_with_identity(&alice, &wrap_keys(&[OLD_WRAP])),
            Err(ArchiveError::NoIdentityWrap)
        ));
        let status = b
            .archive
            .unlock_with_identity(&alice, &wrap_keys(&[NEW_WRAP]))
            .unwrap();
        assert!(status.unlocked);
        // The key it put back is the archive's: a backup round trip works again.
        b.export();
    }

    #[test]
    fn unknown_wrap_kinds_and_other_accounts_survive_a_rewrite() {
        let folder = tempfile::tempdir().unwrap();
        let a = Device::new("alice");
        a.connect(folder.path());
        let alice = account("alice");
        a.archive.write_identity(&alice, None, &OLD_WRAP).unwrap();

        let path = folder
            .path()
            .join(KEY_WRAP_DEVICES_DIR)
            .join(a.device_id())
            .join(KEY_WRAP_FILE_NAME);
        let mut file = wrap_file(folder.path(), &a);
        let entries = file["keyWraps"].as_array_mut().unwrap();
        entries.push(serde_json::json!({ "kind": "hardware-v9", "blob": "x" }));
        entries.push(serde_json::json!({
            "kind": IDENTITY_WRAP_KIND, "account": "0".repeat(32), "nonce": "", "wrapped": ""
        }));
        std::fs::write(&path, serde_json::to_vec(&file).unwrap()).unwrap();

        a.archive.write_identity(&alice, None, &NEW_WRAP).unwrap();
        let file = wrap_file(folder.path(), &a);
        let kinds: Vec<&str> = file["keyWraps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["kind"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            vec!["hardware-v9", IDENTITY_WRAP_KIND, IDENTITY_WRAP_KIND]
        );
    }

    #[test]
    fn a_backup_moved_to_another_device_folder_does_not_open() {
        let folder = tempfile::tempdir().unwrap();
        let a = Device::new("alice");
        a.connect(folder.path());
        let alice = account("alice");
        a.archive
            .write_identity(&alice, Some((&BACKUP_KEY, b"seed")), &OLD_WRAP)
            .unwrap();
        let tag_dir = std::fs::read_dir(folder.path().join("accounts"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let from = tag_dir
            .join("devices")
            .join(a.device_id())
            .join(IDENTITY_BACKUP_NAME);
        let other = tag_dir
            .join("devices")
            .join("aaaaaaaa-0000-4000-8000-000000000000");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::rename(&from, other.join(IDENTITY_BACKUP_NAME)).unwrap();

        let read = a
            .archive
            .read_identity_backups(&alice, &BACKUP_KEY)
            .unwrap();
        assert_eq!(read.found, 1);
        assert!(read.opened.is_empty());
    }

    // Known-answer vector of a sealed identity backup, under the backup key of the recovery
    // phrase vector (entropy 00 01 … 0f).
    const VECTOR_BACKUP_KEY: &str =
        "2438cbcffe2da40ecca624572cc87e128658014f3c05c2431ba039b03a4035bf";
    const VECTOR_ARCHIVE_ID: &str = "6f1c8a52-1d7e-4f0a-9a43-1c2b8a1f0e55";
    const VECTOR_ACCOUNT_TAG: &str = "00112233445566778899aabbccddeeff";
    const VECTOR_DEVICE_ID: &str = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const VECTOR_NONCE: &str = "404142434445464748494a4b4c4d4e4f5051525354555657";
    const VECTOR_PLAINTEXT: &str = concat!(
        r#"{"v":1,"principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","#,
        r#""keySeq":0,"identitySeed":"ed25519:ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8"}"#
    );
    const VECTOR_SEALED: &str = concat!(
        "52494d580103404142434445464748494a4b4c4d4e4f50515253545556572c99",
        "273079b132162a65eb3fedb5f5250ee55435c15895077b742fb1f2b709847ec9",
        "124e45c8d94a4ddeb6ac6930670ce9752afd0a96a0ccc85fc164349d35ac667e",
        "4848c3c32ebf0af8090fccd7e804aaae05cf481c4b177f185facaac4635db959",
        "0bcd6f6f08607adca293a305e98ed592aa712c602e443752ccf6eee733b92f05",
        "5243e1cd6e338f9fcf35f1f58d6076d4fabcf69c4133f0edf402da8c60a58807",
        "bd105bb3844de3",
    );

    #[test]
    fn a_sealed_backup_matches_its_known_answer_vector() {
        let key: [u8; 32] = hex::decode(VECTOR_BACKUP_KEY).unwrap().try_into().unwrap();
        let nonce: [u8; 24] = hex::decode(VECTOR_NONCE).unwrap().try_into().unwrap();
        let place = FilePlace {
            archive_id: VECTOR_ARCHIVE_ID,
            account_tag: VECTOR_ACCOUNT_TAG,
            device_id: VECTOR_DEVICE_ID,
            name: IDENTITY_BACKUP_NAME,
        };
        let sealed = seal_file_with_nonce(
            &key,
            &nonce,
            FileKind::IdentityBackup,
            &place,
            VECTOR_PLAINTEXT.as_bytes(),
        )
        .unwrap();
        assert_eq!(hex::encode(&sealed), VECTOR_SEALED);
        let opened =
            format::open_file_under(&key, FileKind::IdentityBackup, &place, &sealed).unwrap();
        assert_eq!(opened.as_slice(), VECTOR_PLAINTEXT.as_bytes());
    }

    // Known-answer vector of an identity wrap: archive key 60 61 … 7f under the wrap key of
    // identity seed 20 21 … 3f, nonce 80 81 … 97.
    const VECTOR_WRAP_KEY: &str =
        "4a91b2fbae43381b5dc85eb455dce1c22ed89ed182aeb4e6b31ff46cbf2f57c9";
    const VECTOR_WRAP_NONCE: &str = "gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaX";
    const VECTOR_WRAPPED: &str = "7V00oND8ZorkpfnJFKA1z3b3F5NjQ06pY20vPcfQuPMCMMGaNR231yQTWGP0EPFv";

    #[test]
    fn an_identity_wrap_matches_its_known_answer_vector() {
        let wrap_key: [u8; 32] = hex::decode(VECTOR_WRAP_KEY).unwrap().try_into().unwrap();
        let archive_key: Vec<u8> = (0x60..0x80).collect();
        let nonce: [u8; 24] = STANDARD
            .decode(VECTOR_WRAP_NONCE)
            .unwrap()
            .try_into()
            .unwrap();
        let wrapped = crypto::seal_with_nonce(
            &wrap_key,
            &nonce,
            &identity_wrap_aad(VECTOR_ARCHIVE_ID, VECTOR_ACCOUNT_TAG),
            &archive_key,
        )
        .unwrap();
        assert_eq!(STANDARD.encode(&wrapped), VECTOR_WRAPPED);

        let wrap = IdentityWrap::from_value(&serde_json::json!({
            "kind": IDENTITY_WRAP_KIND,
            "account": VECTOR_ACCOUNT_TAG,
            "nonce": VECTOR_WRAP_NONCE,
            "wrapped": VECTOR_WRAPPED,
        }))
        .unwrap();
        let opened = wrap.open(VECTOR_ARCHIVE_ID, &wrap_key).unwrap();
        assert_eq!(opened.as_bytes().as_slice(), archive_key.as_slice());
        assert!(wrap.open(VECTOR_ARCHIVE_ID, &[0u8; 32]).is_none());
        assert!(wrap
            .open("6f1c8a52-1d7e-4f0a-9a43-000000000000", &wrap_key)
            .is_none());
    }
}
