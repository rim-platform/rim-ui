//! The identity key's backup in the history archive, as key identity sees it: the record this
//! device seals with the backup key, taking the identity key over from such a record on a
//! device that holds only a device key, and the key the archive key is wrapped under.
//!
//! The backup key comes from the recovery kit's secret (`recovery_kit`), never from the
//! archive's passphrase, so whoever can read the archive cannot read the identity key. The
//! archive side (`history_archive::identity`) stores the sealed bytes.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::recovery_kit::{self, BackupKey};
use super::statement::{SecretKey, Statement};
use super::{identity_at_head, key, KeyIdentityError, KeyIdentityState, LogStatus, Result};

/// HKDF salt of the archive key wrap key.
const WRAP_SALT: &[u8] = b"rim.history-archive.v1";
/// HKDF info of the archive key wrap key.
const WRAP_INFO: &[u8] = b"archive key wrap";

/// Version of the backup record's plaintext.
const RECORD_VERSION: u32 = 1;

/// A backup key as the keyring record keeps it: base64url.
pub(crate) fn encode_key(key: &[u8; 32]) -> Zeroizing<String> {
    Zeroizing::new(URL_SAFE_NO_PAD.encode(key))
}

fn decode_key(text: &str) -> Result<BackupKey> {
    let bytes = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(text)
            .map_err(|_| KeyIdentityError::Keyring("stored backup key is not base64".into()))?,
    );
    let mut key = Zeroizing::new([0u8; 32]);
    if bytes.len() != key.len() {
        return Err(KeyIdentityError::Keyring(
            "stored backup key has the wrong length".into(),
        ));
    }
    key.copy_from_slice(&bytes);
    Ok(key)
}

/// The key the archive key is wrapped under for `identity`:
/// `HKDF-SHA256(ikm = identity seed, salt = "rim.history-archive.v1", info = "archive key wrap")`.
pub(crate) fn archive_wrap_key(identity: &SecretKey) -> Zeroizing<[u8; 32]> {
    identity.derive_key(WRAP_SALT, WRAP_INFO)
}

/// The plaintext of a backup record: the identity key at the head this device verified, and a
/// rotation's new key while the server has not confirmed it.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRecord {
    v: u32,
    principal_id: String,
    key_seq: u32,
    identity_seed: Zeroizing<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending_identity_seed: Option<Zeroizing<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending_key_seq: Option<u32>,
}

/// What this device writes to the archive for an account whose identity key it holds.
pub(crate) struct BackupMaterial {
    /// The backup key and the record to seal with it; `None` when this device has no backup
    /// key.
    pub(crate) record: Option<(BackupKey, Zeroizing<Vec<u8>>)>,
    /// The key to wrap the archive key under.
    pub(crate) wrap_key: Zeroizing<[u8; 32]>,
}

impl KeyIdentityState {
    /// The backup record and wrap key for `principal_id`, after verifying the server's log.
    /// `NoIdentityKey` when this device does not hold the head's identity key.
    pub(crate) fn backup_material(
        &self,
        principal_id: &str,
        log: &[Statement],
    ) -> Result<BackupMaterial> {
        let head = Self::head(principal_id, log)?;
        let _guard = self.guard()?;
        let (record, identity) = self.identity(principal_id, &head)?;
        let backup = match &record.backup_key {
            None => None,
            Some(text) => {
                let plaintext = BackupRecord {
                    v: RECORD_VERSION,
                    principal_id: principal_id.to_string(),
                    key_seq: head.seq,
                    identity_seed: identity.to_text(),
                    pending_identity_seed: record.pending_identity_seed.clone(),
                    pending_key_seq: record
                        .pending_identity_seed
                        .as_ref()
                        .and(record.pending_identity_seq),
                };
                let bytes = Zeroizing::new(serde_json::to_vec(&plaintext).map_err(|e| {
                    KeyIdentityError::Crypto(format!("cannot encode the backup: {e}"))
                })?);
                Some((decode_key(text)?, bytes))
            }
        };
        Ok(BackupMaterial {
            record: backup,
            wrap_key: archive_wrap_key(&identity),
        })
    }

    /// Wrap keys of every identity key this device holds for `principal_id`: the current one
    /// and a pending one. Empty without keys.
    pub(crate) fn archive_wrap_keys(&self, principal_id: &str) -> Result<Vec<Zeroizing<[u8; 32]>>> {
        let record = {
            let _guard = self.guard()?;
            self.keys().record(principal_id)?
        };
        let Some(record) = record else {
            return Ok(Vec::new());
        };
        [&record.identity_seed, &record.pending_identity_seed]
            .into_iter()
            .flatten()
            .map(|text| Ok(archive_wrap_key(&key(text)?)))
            .collect()
    }

    /// Check `secret` (a recovery phrase, a `RK1-` key or a whole kit) against the head's
    /// recovery key and return its backup key.
    fn checked_backup_key(
        principal_id: &str,
        log: &[Statement],
        secret: &str,
    ) -> Result<BackupKey> {
        let head = Self::head(principal_id, log)?;
        let secret = recovery_kit::parse_recovery_secret(secret)?;
        if secret.key.public_key() != head.recovery_key {
            return Err(KeyIdentityError::Invalid(
                "this recovery phrase or key does not belong to this account".into(),
            ));
        }
        Ok(secret.backup_key)
    }

    /// Keep the backup key of `secret` on this device, so it can back up the identity key
    /// (an account enrolled before the backup existed, or with a kit this device never saw).
    pub(crate) fn set_backup_key(
        &self,
        principal_id: &str,
        log: &[Statement],
        secret: &str,
    ) -> Result<()> {
        let backup_key = Self::checked_backup_key(principal_id, log, secret)?;
        let _guard = self.guard()?;
        let mut record = self.record(principal_id)?;
        record.backup_key = Some(encode_key(&backup_key));
        self.keys().put_record(&record)
    }

    /// Start taking the identity key over: check `secret` against the head and that this
    /// device holds keys for the account but not the head's identity key. Returns the backup
    /// key to open the archive's backups with.
    pub(crate) fn begin_takeover(
        &self,
        principal_id: &str,
        log: &[Statement],
        secret: &str,
    ) -> Result<BackupKey> {
        let backup_key = Self::checked_backup_key(principal_id, log, secret)?;
        let head = Self::head(principal_id, log)?;
        let _guard = self.guard()?;
        let mut record = self.record(principal_id)?;
        if identity_at_head(&mut record, &head)?.0.is_some() {
            return Err(KeyIdentityError::Invalid(
                "this computer already holds the account's identity key".into(),
            ));
        }
        Ok(backup_key)
    }

    /// Finish taking the identity key over from the opened backup `records`: keep the one key
    /// whose public key is the head's identity key, with the backup key. `None` when no record
    /// holds it (every backup is older than the last rotation).
    pub(crate) fn finish_takeover(
        &self,
        principal_id: &str,
        log: &[Statement],
        backup_key: &[u8; 32],
        records: &[Zeroizing<Vec<u8>>],
    ) -> Result<Option<LogStatus>> {
        let head = Self::head(principal_id, log)?;
        let mut found = None;
        for bytes in records {
            let record: BackupRecord = match serde_json::from_slice(bytes) {
                Ok(record) => record,
                Err(e) => {
                    log::warn!("[key_identity] an identity backup is not readable: {e}");
                    continue;
                }
            };
            if record.principal_id != principal_id {
                continue;
            }
            for text in [
                Some(&record.identity_seed),
                record.pending_identity_seed.as_ref(),
            ]
            .into_iter()
            .flatten()
            {
                let candidate = key(text)?;
                if candidate.public_key() == head.identity_key {
                    found = Some(candidate);
                }
            }
        }
        let Some(identity) = found else {
            return Ok(None);
        };

        let _guard = self.guard()?;
        let mut record = self.record(principal_id)?;
        record.identity_seed = Some(identity.to_text());
        record.pending_identity_seed = None;
        record.pending_identity_seq = None;
        record.backup_key = Some(encode_key(backup_key));
        self.keys().put_record(&record)?;
        Ok(Some(LogStatus {
            principal_id: head.principal_id,
            seq: head.seq,
            holds_identity_key: true,
        }))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::super::store::{KeyRecord, Keys, MemorySecretStore};
    use super::super::{statement, Challenge, ServerAccount};
    use super::*;

    const ENDPOINT: &str = "http://localhost:8080/api";

    // Known-answer vectors of the backup key (from a phrase and from a v1 seed) and of the
    // archive key wrap key.
    const VECTOR_ENTROPY: &str = "000102030405060708090a0b0c0d0e0f";
    const VECTOR_PHRASE_BACKUP_KEY: &str =
        "2438cbcffe2da40ecca624572cc87e128658014f3c05c2431ba039b03a4035bf";
    const VECTOR_V1_SEED: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const VECTOR_V1_BACKUP_KEY: &str =
        "4262b4cecee03da62eaa49f56889412370a08500e57b11e3ac9a06f7b1a8c302";
    const VECTOR_IDENTITY_SEED: &str =
        "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
    const VECTOR_WRAP_KEY: &str =
        "4a91b2fbae43381b5dc85eb455dce1c22ed89ed182aeb4e6b31ff46cbf2f57c9";

    fn bytes32(hex_text: &str) -> [u8; 32] {
        hex::decode(hex_text).unwrap().try_into().unwrap()
    }

    #[test]
    fn the_backup_and_wrap_keys_match_their_known_answer_vectors() {
        let entropy: [u8; 16] = hex::decode(VECTOR_ENTROPY).unwrap().try_into().unwrap();
        let backup = recovery_kit::phrase_backup_key(&entropy).unwrap();
        assert_eq!(hex::encode(*backup), VECTOR_PHRASE_BACKUP_KEY);
        // Not the recovery key's seed: another `info`.
        let recovery = recovery_kit::phrase_key(&entropy).unwrap();
        assert_ne!(backup.as_ref(), recovery.seed());

        let v1 = SecretKey::from_seed(Zeroizing::new(bytes32(VECTOR_V1_SEED)));
        let rk1 = recovery_kit::format_recovery_key(v1.seed());
        let secret = recovery_kit::parse_recovery_secret(&rk1).unwrap();
        assert_eq!(hex::encode(*secret.backup_key), VECTOR_V1_BACKUP_KEY);

        let identity = SecretKey::from_seed(Zeroizing::new(bytes32(VECTOR_IDENTITY_SEED)));
        assert_eq!(hex::encode(*archive_wrap_key(&identity)), VECTOR_WRAP_KEY);
    }

    fn enrolled() -> (KeyIdentityState, String, Vec<Statement>, String) {
        let state = KeyIdentityState::new(Arc::new(MemorySecretStore::default()));
        let draft = state.begin_enrollment("Laptop").unwrap();
        let account = ServerAccount {
            endpoint: ENDPOINT.into(),
            user_id: "u1".into(),
            username: "ada".into(),
        };
        let challenge = Challenge {
            challenge_id: "00000000-0000-0000-0000-000000000009".into(),
            nonce: "bm9uY2U".into(),
        };
        let statements = state
            .sign_enrollment(&draft.draft_id, &account, &challenge)
            .unwrap();
        state
            .settle(&account, Some(draft.principal_id.as_str()))
            .unwrap();
        (
            state,
            draft.principal_id.clone(),
            statements.key_log,
            draft.recovery_phrase.join(" "),
        )
    }

    /// A device that holds only a device key for `principal_id`.
    fn linked(principal_id: &str) -> KeyIdentityState {
        let store = Arc::new(MemorySecretStore::default());
        Keys(store.as_ref())
            .put_record(&KeyRecord {
                v: 1,
                principal_id: principal_id.into(),
                device_id: uuid::Uuid::now_v7().to_string(),
                device_name: "Desktop".into(),
                device_seed: SecretKey::generate().unwrap().to_text(),
                identity_seed: None,
                pending_identity_seed: None,
                pending_identity_seq: None,
                backup_key: None,
                confirmed: true,
                replaced: None,
            })
            .unwrap();
        KeyIdentityState::new(store)
    }

    #[test]
    fn a_backup_record_moves_the_identity_key_to_a_linked_device() {
        let (a, principal, log, phrase) = enrolled();
        let material = a.backup_material(&principal, &log).unwrap();
        let (backup_key, record) = material.record.unwrap();
        let text = std::str::from_utf8(&record).unwrap();
        assert!(text.contains(&format!("\"principalId\":\"{principal}\"")));
        assert!(text.contains("\"keySeq\":0"));

        let b = linked(&principal);
        assert!(b.backup_material(&principal, &log).is_err());
        let opened = b.begin_takeover(&principal, &log, &phrase).unwrap();
        assert_eq!(*opened, *backup_key);
        let status = b
            .finish_takeover(&principal, &log, &opened, &[record])
            .unwrap()
            .unwrap();
        assert!(status.holds_identity_key);
        assert!(b.sync_log(&principal, &log).unwrap().holds_identity_key);
        // B can now back the key up itself, under the same backup key and wrap key.
        let again = b.backup_material(&principal, &log).unwrap();
        assert_eq!(*again.record.unwrap().0, *backup_key);
        assert_eq!(*again.wrap_key, *material.wrap_key);
        assert_eq!(b.archive_wrap_keys(&principal).unwrap().len(), 1);
    }

    #[test]
    fn a_takeover_refuses_a_wrong_secret_a_stale_backup_and_a_holder() {
        let (a, principal, log, phrase) = enrolled();
        let (_, old_record) = a.backup_material(&principal, &log).unwrap().record.unwrap();
        let b = linked(&principal);

        let other_phrase = recovery_kit::phrase_words(&[7u8; 16]).unwrap().join(" ");
        assert!(b.begin_takeover(&principal, &log, &other_phrase).is_err());
        assert!(a.begin_takeover(&principal, &log, &phrase).is_err());
        let stranger = KeyIdentityState::new(Arc::new(MemorySecretStore::default()));
        assert!(matches!(
            stranger.begin_takeover(&principal, &log, &phrase),
            Err(KeyIdentityError::NoKeys)
        ));

        // A rotates; the backup B finds still holds the old key.
        let entry = a.begin_rotation(&principal, &log).unwrap();
        let mut rotated = log.clone();
        rotated.push(entry);
        let backup_key = b.begin_takeover(&principal, &rotated, &phrase).unwrap();
        assert!(b
            .finish_takeover(
                &principal,
                &rotated,
                &backup_key,
                std::slice::from_ref(&old_record)
            )
            .unwrap()
            .is_none());
        assert!(!b.sync_log(&principal, &rotated).unwrap().holds_identity_key);

        // The backup A writes during the rotation carries the pending key, which the head
        // now names.
        let (_, pending_record) = a.backup_material(&principal, &log).unwrap().record.unwrap();
        assert!(std::str::from_utf8(&pending_record)
            .unwrap()
            .contains("pendingIdentitySeed"));
        assert!(b
            .finish_takeover(
                &principal,
                &rotated,
                &backup_key,
                &[old_record, pending_record]
            )
            .unwrap()
            .is_some());
        assert!(b.sync_log(&principal, &rotated).unwrap().holds_identity_key);
    }

    #[test]
    fn a_rotation_changes_the_wrap_key() {
        let (a, principal, log, _) = enrolled();
        let before = a.backup_material(&principal, &log).unwrap().wrap_key;
        let entry = a.begin_rotation(&principal, &log).unwrap();
        let mut rotated = log.clone();
        rotated.push(entry);
        assert_eq!(a.archive_wrap_keys(&principal).unwrap().len(), 2);
        a.sync_log(&principal, &rotated).unwrap();
        let after = a.backup_material(&principal, &rotated).unwrap().wrap_key;
        assert_ne!(*before, *after);
        let held = a.archive_wrap_keys(&principal).unwrap();
        assert_eq!(held.len(), 1);
        assert_eq!(*held[0], *after);
    }

    #[test]
    fn an_account_with_a_v1_kit_backs_up_under_its_rk1_key() {
        let store = Arc::new(MemorySecretStore::default());
        let state = KeyIdentityState::new(store.clone());
        let identity = SecretKey::generate().unwrap();
        let recovery = SecretKey::from_seed(Zeroizing::new([42u8; 32]));
        let inception = statement::inception(&identity, &recovery.public_key(), &statement::now());
        let principal = statement::principal_id(&inception.payload);
        let log = vec![inception];
        Keys(store.as_ref())
            .put_record(&KeyRecord {
                v: 1,
                principal_id: principal.clone(),
                device_id: uuid::Uuid::now_v7().to_string(),
                device_name: "Laptop".into(),
                device_seed: SecretKey::generate().unwrap().to_text(),
                identity_seed: Some(identity.to_text()),
                pending_identity_seed: None,
                pending_identity_seq: None,
                backup_key: None,
                confirmed: true,
                replaced: None,
            })
            .unwrap();
        // Enrolled before the backup existed: no backup key until the kit's key is given.
        assert!(state
            .backup_material(&principal, &log)
            .unwrap()
            .record
            .is_none());
        let rk1 = recovery_kit::format_recovery_key(recovery.seed());
        assert!(state
            .set_backup_key(&principal, &log, "abandon abandon abandon")
            .is_err());
        state.set_backup_key(&principal, &log, &rk1).unwrap();
        let (backup_key, record) = state
            .backup_material(&principal, &log)
            .unwrap()
            .record
            .unwrap();

        let b = linked(&principal);
        let opened = b.begin_takeover(&principal, &log, &rk1).unwrap();
        assert_eq!(*opened, *backup_key);
        assert!(b
            .finish_takeover(&principal, &log, &opened, &[record])
            .unwrap()
            .is_some());
    }
}
