//! The app's secrets: the message cache key, the history archive keys and cloud refresh
//! tokens, the offline session record, the key identity records and pending device links, the
//! AI provider keys, and the secret settings of plugins.
//!
//! They live in one encrypted file, `<app data>/secrets.vault` ([`SecretVault`]). Each record
//! is sealed on its own with XChaCha20-Poly1305 under the vault key, with its name bound in as
//! associated data. The vault key, 32 random bytes, is the one entry this app keeps in the OS
//! credential store, so no record is held to the store's size limit, and the store is asked
//! for it once per run rather than once per secret.
//!
//! - macOS: Keychain. Windows: Credential Manager. Both are `keyring`'s defaults.
//! - Linux: the desktop keyring service (Secret Service over D-Bus, provided by GNOME Keyring,
//!   KWallet or KeePassXC), never the kernel keyring, which the kernel clears on reboot.
//!
//! On Linux there is no fallback: when no Secret Service is running, the vault key cannot be
//! read and every secret fails with an error that says so, instead of being stored somewhere
//! that does not persist.
//!
//! A secret still in the credential store moves into the vault the first time it is read. A
//! vault that does not open under its key is moved aside, never overwritten, and the call
//! that found it fails with [`VaultError::Unreadable`]. A vault where only some records do not
//! open keeps the others: those records are moved aside on their own, and reading one of them
//! fails with [`VaultError::RecordUnreadable`] for the rest of the run.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, Zeroizing};

/// The service name the vault key is stored under; entries differ by user name.
const SERVICE: &str = "com.rim.rim-ui";

/// Credential store name of the vault key.
const VAULT_KEY_NAME: &str = "vault-key-v1";

/// The vault's file name in the app data directory.
const FILE_NAME: &str = "secrets.vault";
/// Where a write is prepared before it replaces the vault.
const TEMP_FILE_NAME: &str = "secrets.vault.tmp";

const FORMAT: &str = "rim-secret-vault";
const VERSION: u32 = 1;
/// Associated data of a record: this prefix, then the record's name.
const AAD_PREFIX: &[u8] = b"rim-secret-vault v1\0";
/// XChaCha20-Poly1305 nonce length: random nonces are safe at this size.
const NONCE_LEN: usize = 24;

/// The credential store entry for `user`.
#[cfg(target_os = "linux")]
fn entry(user: &str) -> keyring::Result<Entry> {
    let credential = keyring::secret_service::SsCredential::new_with_target(None, SERVICE, user)?;
    Ok(Entry::new_with_credential(Box::new(linux::Explaining(
        Box::new(credential),
    ))))
}

/// The credential store entry for `user`.
#[cfg(not(target_os = "linux"))]
fn entry(user: &str) -> keyring::Result<Entry> {
    Entry::new(SERVICE, user)
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum VaultError {
    /// The vault did not open under its key, or its key was gone. It was moved aside and a
    /// fresh vault started, so the secrets it held are lost on this device.
    #[error(
        "the secret vault could not be opened; the keys it held are lost on this computer \
         ({reason}; the old vault was moved to {moved_to})"
    )]
    Unreadable { moved_to: String, reason: String },
    /// This record did not open under the vault key and was moved aside with any others that
    /// did not; the rest of the vault is kept.
    #[error(
        "the secret {name} could not be opened and is lost on this computer (it was moved to \
         {moved_to})"
    )]
    RecordUnreadable { name: String, moved_to: String },
    /// The vault has a format version this build does not know. It is left as it is.
    #[error("the secret vault was written by a newer version of RIM; update the app")]
    Newer,
    /// The OS credential store failed while reading or writing the vault key.
    #[error("{0}")]
    Store(String),
    #[error("the secret vault failed: {0}")]
    Failed(String),
}

/// The OS credential store, by entry name.
trait Keyring: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<Zeroizing<String>>, String>;
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    /// Deleting what is not there is not an error.
    fn delete(&self, name: &str) -> Result<(), String>;
}

/// The real credential store, through [`entry`].
struct OsKeyring;

impl Keyring for OsKeyring {
    fn get(&self, name: &str) -> Result<Option<Zeroizing<String>>, String> {
        match entry(name).and_then(|entry| entry.get_password()) {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("OS credential store read failed: {e}")),
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        entry(name)
            .and_then(|entry| entry.set_password(value))
            .map_err(|e| format!("OS credential store write failed: {e}"))
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        match entry(name).and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("OS credential store delete failed: {e}")),
        }
    }
}

/// The vault file as stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultFile {
    format: String,
    v: u32,
    records: BTreeMap<String, SealedRecord>,
}

impl VaultFile {
    fn empty() -> Self {
        Self {
            format: FORMAT.into(),
            v: VERSION,
            records: BTreeMap::new(),
        }
    }
}

/// The format and version, read before the rest so a newer file is recognised as such.
#[derive(Deserialize)]
struct Header {
    format: String,
    v: u32,
}

/// One secret: base64url of its nonce and of its ciphertext with the tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SealedRecord {
    nonce: String,
    sealed: String,
}

/// Why a vault file is not usable.
enum Rejected {
    Newer,
    Unreadable(String),
}

/// What one call works on: the vault key and the file's records, all of which opened.
struct Loaded {
    key: Zeroizing<[u8; 32]>,
    file: VaultFile,
}

impl Loaded {
    fn get(&self, name: &str) -> Result<Option<Zeroizing<String>>, VaultError> {
        self.file
            .records
            .get(name)
            .map(|record| open_record(&self.key, name, record).map_err(VaultError::Failed))
            .transpose()
    }

    fn put(&mut self, name: &str, value: &str) -> Result<(), VaultError> {
        let record = seal_record(&self.key, name, value)?;
        self.file.records.insert(name.to_string(), record);
        Ok(())
    }
}

/// What the vault remembers between calls.
#[derive(Default)]
struct State {
    /// The vault key, once read or created.
    key: Option<Zeroizing<[u8; 32]>>,
    /// Names the credential store is known not to hold this run, so a miss asks it once.
    not_in_store: HashSet<String>,
    /// Records set aside this run because they did not open, with where they went.
    unreadable: BTreeMap<String, String>,
}

/// The encrypted secret file and its key. One lock serializes every call, file access
/// included; nothing but the key and the names known to be absent from the credential store
/// is kept between calls.
pub(crate) struct SecretVault {
    path: PathBuf,
    keyring: Box<dyn Keyring>,
    state: Mutex<State>,
}

impl SecretVault {
    /// The vault in `app_data_dir`, keyed from the OS credential store. Nothing is read
    /// before the first call.
    pub(crate) fn open(app_data_dir: &Path) -> Self {
        Self::new(app_data_dir, Box::new(OsKeyring))
    }

    fn new(dir: &Path, keyring: Box<dyn Keyring>) -> Self {
        Self {
            path: dir.join(FILE_NAME),
            keyring,
            state: Mutex::new(State::default()),
        }
    }

    /// The secret named `name`. A secret still in the credential store is moved into the
    /// vault and deleted there.
    pub(crate) fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, VaultError> {
        check_name(name)?;
        let mut state = self.lock();
        let mut vault = self.load(&mut state)?;
        if let Some(moved_to) = state.unreadable.get(name) {
            return Err(VaultError::RecordUnreadable {
                name: name.to_string(),
                moved_to: moved_to.clone(),
            });
        }
        if let Some(value) = vault.get(name)? {
            return Ok(Some(value));
        }
        if state.not_in_store.contains(name) {
            return Ok(None);
        }

        let Some(value) = self.keyring.get(name).map_err(VaultError::Store)? else {
            state.not_in_store.insert(name.to_string());
            return Ok(None);
        };
        if let Err(e) = vault
            .put(name, &value)
            .and_then(|()| self.save(&vault.file))
        {
            log::warn!("[secret_store] could not move {name} into the secret vault: {e}");
            return Ok(Some(value));
        }
        match self.keyring.delete(name) {
            Ok(()) => {
                state.not_in_store.insert(name.to_string());
                log::info!("[secret_store] moved {name} from the OS credential store into the secret vault");
            }
            Err(e) => log::warn!(
                "[secret_store] moved {name} into the secret vault but could not delete it from \
                 the OS credential store: {e}"
            ),
        }
        Ok(Some(value))
    }

    /// Store `value` as `name`, replacing what was there.
    pub(crate) fn write(&self, name: &str, value: &str) -> Result<(), VaultError> {
        check_name(name)?;
        let mut state = self.lock();
        let mut vault = self.load(&mut state)?;
        vault.put(name, value)?;
        self.save(&vault.file)?;
        state.unreadable.remove(name);
        Ok(())
    }

    /// Delete `name` from the vault, and from the credential store when it may still be
    /// there (best effort). Deleting what is not there is not an error.
    pub(crate) fn delete(&self, name: &str) -> Result<(), VaultError> {
        check_name(name)?;
        let mut state = self.lock();
        let mut vault = self.load(&mut state)?;
        if vault.file.records.remove(name).is_some() {
            self.save(&vault.file)?;
        }
        state.unreadable.remove(name);
        if !state.not_in_store.contains(name) {
            match self.keyring.delete(name) {
                Ok(()) => {
                    state.not_in_store.insert(name.to_string());
                }
                Err(e) => log::warn!(
                    "[secret_store] could not delete {name} from the OS credential store: {e}"
                ),
            }
        }
        Ok(())
    }

    /// Delete every record whose name starts with `prefix` from the vault, in one write.
    /// The credential store is not asked: names that share a prefix belong to records the
    /// vault itself created. Deleting what is not there is not an error.
    pub(crate) fn delete_prefixed(&self, prefix: &str) -> Result<(), VaultError> {
        if prefix.is_empty() {
            return Err(VaultError::Failed(
                "an empty prefix names every record".into(),
            ));
        }
        let mut state = self.lock();
        let mut vault = self.load(&mut state)?;
        let before = vault.file.records.len();
        vault
            .file
            .records
            .retain(|name, _| !name.starts_with(prefix));
        if vault.file.records.len() != before {
            self.save(&vault.file)?;
        }
        state.unreadable.retain(|name, _| !name.starts_with(prefix));
        Ok(())
    }

    /// The state lock. A panic under it leaves nothing half-done worth refusing.
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The vault key and the file, every record of which opens. An unusable file is moved
    /// aside, and so are records that do not open beside ones that do; the key is created when
    /// there is neither a key nor a vault worth keeping.
    fn load(&self, state: &mut State) -> Result<Loaded, VaultError> {
        let stored_key = match state.key.as_ref() {
            Some(key) => Some(key.clone()),
            None => self.read_key()?,
        };
        let raw = match fs::read(&self.path) {
            Ok(raw) => Some(raw),
            Err(e) if e.kind() == io::ErrorKind::NotFound => None,
            Err(e) => {
                return Err(VaultError::Failed(format!(
                    "cannot read {}: {e}",
                    self.path.display()
                )))
            }
        };

        let (key, file) = match (stored_key, raw) {
            (key, None) => (key, VaultFile::empty()),
            (Some(key), Some(raw)) => match parse(&raw).and_then(|file| split(&key, file)) {
                Ok((file, unopened)) if unopened.is_empty() => (Some(key), file),
                Ok((file, unopened)) => {
                    let moved_to = self.set_aside_records(&unopened)?;
                    self.save(&file)?;
                    for name in unopened.keys() {
                        state.unreadable.insert(name.clone(), moved_to.clone());
                    }
                    (Some(key), file)
                }
                Err(Rejected::Newer) => return Err(VaultError::Newer),
                Err(Rejected::Unreadable(reason)) => return Err(self.set_aside(reason)),
            },
            (None, Some(raw)) => match parse(&raw) {
                Ok(file) if file.records.is_empty() => (None, file),
                Err(Rejected::Newer) => return Err(VaultError::Newer),
                Ok(_) | Err(Rejected::Unreadable(_)) => {
                    return Err(
                        self.set_aside("its key is missing from the OS credential store".into())
                    )
                }
            },
        };
        let key = match key {
            Some(key) => key,
            None => self.create_key()?,
        };
        state.key = Some(key.clone());
        Ok(Loaded { key, file })
    }

    /// The vault key from the credential store. One that does not decode counts as missing.
    fn read_key(&self) -> Result<Option<Zeroizing<[u8; 32]>>, VaultError> {
        let Some(stored) = self
            .keyring
            .get(VAULT_KEY_NAME)
            .map_err(VaultError::Store)?
        else {
            return Ok(None);
        };
        let decoded = Zeroizing::new(
            URL_SAFE_NO_PAD
                .decode(stored.as_bytes())
                .unwrap_or_default(),
        );
        match <[u8; 32]>::try_from(decoded.as_slice()) {
            Ok(key) => Ok(Some(Zeroizing::new(key))),
            Err(_) => {
                log::warn!(
                    "[secret_store] the stored vault key is malformed; treating it as missing"
                );
                Ok(None)
            }
        }
    }

    /// A new random vault key, stored in the credential store.
    fn create_key(&self) -> Result<Zeroizing<[u8; 32]>, VaultError> {
        let mut key = Zeroizing::new([0u8; 32]);
        getrandom::fill(key.as_mut())
            .map_err(|e| VaultError::Failed(format!("random generation failed: {e}")))?;
        let encoded = Zeroizing::new(URL_SAFE_NO_PAD.encode(*key));
        self.keyring
            .set(VAULT_KEY_NAME, &encoded)
            .map_err(VaultError::Store)?;
        log::info!("[secret_store] generated a new secret vault key");
        Ok(key)
    }

    /// Move an unusable vault to `secrets.vault.unreadable-<timestamp>`, so the next write
    /// starts a fresh one, and say so.
    fn set_aside(&self, reason: String) -> VaultError {
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
        let aside = self
            .path
            .with_file_name(format!("{FILE_NAME}.unreadable-{stamp}"));
        if let Err(e) = fs::rename(&self.path, &aside) {
            return VaultError::Failed(format!(
                "the secret vault could not be opened ({reason}) nor moved aside: {e}"
            ));
        }
        log::warn!(
            "[secret_store] the secret vault could not be opened ({reason}); moved it to {}",
            aside.display()
        );
        VaultError::Unreadable {
            moved_to: aside.display().to_string(),
            reason,
        }
    }

    /// Write `records`, which did not open, to `secrets.vault.unreadable-records-<timestamp>` as
    /// a vault file of their own, and say where.
    fn set_aside_records(
        &self,
        records: &BTreeMap<String, SealedRecord>,
    ) -> Result<String, VaultError> {
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
        let aside = self
            .path
            .with_file_name(format!("{FILE_NAME}.unreadable-records-{stamp}"));
        let json = serde_json::to_vec(&VaultFile {
            records: records.clone(),
            ..VaultFile::empty()
        })
        .map_err(|e| VaultError::Failed(format!("cannot encode the records set aside: {e}")))?;
        write_new(&aside, &json).map_err(|e| {
            VaultError::Failed(format!(
                "records of the secret vault do not open and could not be moved aside: {e}"
            ))
        })?;
        let names: Vec<&str> = records.keys().map(String::as_str).collect();
        log::warn!(
            "[secret_store] vault records that do not open were moved to {}: {}",
            aside.display(),
            names.join(", ")
        );
        Ok(aside.display().to_string())
    }

    /// Replace the vault file atomically: write a temporary file next to it, flush it to
    /// disk, rename it over the vault. Owner-only on Unix.
    fn save(&self, file: &VaultFile) -> Result<(), VaultError> {
        let dir = self
            .path
            .parent()
            .ok_or_else(|| VaultError::Failed("the vault path has no directory".into()))?;
        let json = serde_json::to_vec(file)
            .map_err(|e| VaultError::Failed(format!("cannot encode the vault: {e}")))?;
        let temp = dir.join(TEMP_FILE_NAME);
        let written = fs::create_dir_all(dir)
            .and_then(|()| write_new(&temp, &json))
            .and_then(|()| fs::rename(&temp, &self.path));
        if let Err(e) = written {
            let _ = fs::remove_file(&temp);
            return Err(VaultError::Failed(format!(
                "cannot write {}: {e}",
                self.path.display()
            )));
        }
        sync_dir(dir);
        Ok(())
    }
}

/// The vault key's own entry is never a record.
fn check_name(name: &str) -> Result<(), VaultError> {
    if name == VAULT_KEY_NAME {
        return Err(VaultError::Failed(format!("{name} is a reserved name")));
    }
    Ok(())
}

fn parse(raw: &[u8]) -> Result<VaultFile, Rejected> {
    let header: Header = serde_json::from_slice(raw)
        .map_err(|e| Rejected::Unreadable(format!("it is not a vault file: {e}")))?;
    if header.format != FORMAT {
        return Err(Rejected::Unreadable(format!(
            "its format is {:?}, not {FORMAT:?}",
            header.format
        )));
    }
    if header.v > VERSION {
        return Err(Rejected::Newer);
    }
    if header.v != VERSION {
        return Err(Rejected::Unreadable(format!(
            "version {} is not supported",
            header.v
        )));
    }
    serde_json::from_slice(raw).map_err(|e| Rejected::Unreadable(format!("it is malformed: {e}")))
}

/// The file with the records that open under `key`, and the records that do not. When none
/// opens, the key is not the vault's and the whole file is unreadable.
fn split(
    key: &[u8; 32],
    mut file: VaultFile,
) -> Result<(VaultFile, BTreeMap<String, SealedRecord>), Rejected> {
    let mut unopened = BTreeMap::new();
    let mut first_error = None;
    let names: Vec<String> = file.records.keys().cloned().collect();
    for name in names {
        if let Err(e) = open_record(key, &name, &file.records[&name]) {
            first_error.get_or_insert(e);
            if let Some(record) = file.records.remove(&name) {
                unopened.insert(name, record);
            }
        }
    }
    if file.records.is_empty() {
        if let Some(reason) = first_error {
            return Err(Rejected::Unreadable(reason));
        }
    }
    Ok((file, unopened))
}

fn aad(name: &str) -> Vec<u8> {
    [AAD_PREFIX, name.as_bytes()].concat()
}

fn seal_record(key: &[u8; 32], name: &str, value: &str) -> Result<SealedRecord, VaultError> {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce)
        .map_err(|e| VaultError::Failed(format!("random generation failed: {e}")))?;
    let sealed = XChaCha20Poly1305::new(key.into())
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: value.as_bytes(),
                aad: &aad(name),
            },
        )
        .map_err(|_| VaultError::Failed("encryption failed".into()))?;
    Ok(SealedRecord {
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        sealed: URL_SAFE_NO_PAD.encode(sealed),
    })
}

/// The record's secret. Fails unless it was sealed under `key` as `name`.
fn open_record(
    key: &[u8; 32],
    name: &str,
    record: &SealedRecord,
) -> Result<Zeroizing<String>, String> {
    let nonce = URL_SAFE_NO_PAD
        .decode(&record.nonce)
        .ok()
        .filter(|nonce| nonce.len() == NONCE_LEN)
        .ok_or_else(|| format!("record {name} has a malformed nonce"))?;
    let sealed = URL_SAFE_NO_PAD
        .decode(&record.sealed)
        .map_err(|_| format!("record {name} is not base64"))?;
    let plain = XChaCha20Poly1305::new(key.into())
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &sealed,
                aad: &aad(name),
            },
        )
        .map_err(|_| format!("record {name} does not open under the vault key"))?;
    String::from_utf8(plain).map(Zeroizing::new).map_err(|e| {
        e.into_bytes().zeroize();
        format!("record {name} is not text")
    })
}

/// Create `path` afresh (a leftover from an interrupted write is removed first), write
/// `bytes` and flush them to disk. Owner-only on Unix.
fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Flush a rename in `dir` to disk.
#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Err(e) = fs::File::open(dir).and_then(|dir| dir.sync_all()) {
        log::warn!("[secret_store] could not flush the vault directory: {e}");
    }
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

#[cfg(target_os = "linux")]
mod linux {
    use std::any::Any;
    use std::fmt;

    use keyring::credential::{Credential, CredentialApi};
    use keyring::Error;

    /// The Secret Service credential, with its failures explained (see [`explain`]).
    pub(super) struct Explaining(pub(super) Box<Credential>);

    impl CredentialApi for Explaining {
        fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
            self.0.set_secret(secret).map_err(explain)
        }

        fn get_secret(&self) -> keyring::Result<Vec<u8>> {
            self.0.get_secret().map_err(explain)
        }

        fn delete_credential(&self) -> keyring::Result<()> {
            self.0.delete_credential().map_err(explain)
        }

        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    impl fmt::Debug for Explaining {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.debug_tuple("Explaining").field(&self.0).finish()
        }
    }

    /// Says what to do about a Secret Service failure; the original error stays attached.
    fn explain(err: Error) -> Error {
        match err {
            // A locked collection whose unlock prompt could not be shown comes back as a plain
            // D-Bus failure, recognisable only by the Secret Service's error name, which only
            // the error's debug form carries.
            Error::PlatformFailure(source) if format!("{source:?}").contains(IS_LOCKED) => {
                Error::NoStorageAccess(Box::new(Explained {
                    hint: LOCKED,
                    source,
                }))
            }
            Error::PlatformFailure(source) => Error::PlatformFailure(Box::new(Explained {
                hint: NOT_RUNNING,
                source,
            })),
            Error::NoStorageAccess(source) => Error::NoStorageAccess(Box::new(Explained {
                hint: LOCKED,
                source,
            })),
            other => other,
        }
    }

    const IS_LOCKED: &str = "org.freedesktop.Secret.Error.IsLocked";

    pub(super) const NOT_RUNNING: &str = "the desktop keyring service (Secret Service) is not \
        available or failed. On Linux RIM keeps its keys there, so GNOME Keyring, KWallet or \
        another Secret Service provider must be running in your desktop session";

    pub(super) const LOCKED: &str = "the desktop keyring is locked or its unlock prompt was \
        dismissed. Unlock it and try again";

    #[derive(Debug)]
    struct Explained {
        hint: &'static str,
        source: Box<dyn std::error::Error + Send + Sync>,
    }

    impl fmt::Display for Explained {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "{} ({})", self.hint, self.source)
        }
    }

    impl std::error::Error for Explained {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(self.source.as_ref())
        }
    }

    #[cfg(test)]
    mod tests {
        use keyring::credential::CredentialBuilderApi;
        use keyring::mock::{MockCredential, MockCredentialBuilder};
        use keyring::Entry;

        use super::*;

        /// An in-memory store standing in for the Secret Service.
        fn store() -> Box<Credential> {
            MockCredentialBuilder {}.build(None, "svc", "user").unwrap()
        }

        fn mock(credential: &Credential) -> &MockCredential {
            credential.as_any().downcast_ref().unwrap()
        }

        fn entry(credential: Box<Credential>) -> Entry {
            Entry::new_with_credential(Box::new(Explaining(credential)))
        }

        #[test]
        fn reads_writes_and_deletes_go_to_the_secret_service() {
            let entry = entry(store());
            assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
            entry.set_password("new").unwrap();
            assert_eq!(entry.get_password().unwrap(), "new");
            entry.delete_credential().unwrap();
            assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
            assert!(matches!(entry.delete_credential(), Err(Error::NoEntry)));
        }

        #[test]
        fn no_secret_service_is_an_error_that_says_so() {
            let current = store();
            mock(current.as_ref()).set_error(Error::PlatformFailure(
                "org.freedesktop.DBus.Error.ServiceUnknown".into(),
            ));
            let err = entry(current).get_password().unwrap_err();
            assert!(matches!(err, Error::PlatformFailure(_)));
            let message = err.to_string();
            assert!(message.contains(NOT_RUNNING), "{message}");
            assert!(message.contains("ServiceUnknown"), "{message}");
        }

        #[test]
        fn a_locked_keyring_says_to_unlock_it() {
            let current = store();
            mock(current.as_ref()).set_error(Error::NoStorageAccess("prompt dismissed".into()));
            let err = entry(current).get_password().unwrap_err();
            assert!(err.to_string().contains(LOCKED), "{err}");

            // What GNOME Keyring answers when it cannot show its unlock prompt.
            let current = store();
            mock(current.as_ref()).set_error(Error::PlatformFailure(
                "D-Bus error: Cannot create an item in a locked collection \
                 (org.freedesktop.Secret.Error.IsLocked)"
                    .into(),
            ));
            let err = entry(current).set_password("x").unwrap_err();
            assert!(matches!(err, Error::NoStorageAccess(_)));
            assert!(err.to_string().contains(LOCKED), "{err}");
        }
    }
}

/// Against the real store. Needs a running, unlocked Secret Service:
/// `cargo test secret_store -- --ignored` inside a desktop session.
#[cfg(all(test, target_os = "linux"))]
mod system_tests {
    use keyring::credential::CredentialApi;
    use keyring::secret_service::SsCredential;

    use super::*;

    #[test]
    #[ignore = "needs a running Secret Service"]
    fn secrets_round_trip() {
        let user = format!("system-test-{}", uuid::Uuid::new_v4());
        let current = SsCredential::new_with_target(None, SERVICE, &user).unwrap();
        let entry = entry(&user).unwrap();

        entry.set_password("updated").unwrap();
        assert_eq!(entry.get_password().unwrap(), "updated");
        assert_eq!(current.get_password().unwrap(), "updated");
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::*;

    /// An in-memory credential store that counts reads by name.
    #[derive(Clone, Default)]
    struct MemoryKeyring {
        entries: Arc<Mutex<HashMap<String, String>>>,
        reads: Arc<Mutex<HashMap<String, usize>>>,
        failing: Arc<Mutex<bool>>,
    }

    impl MemoryKeyring {
        fn has(&self, name: &str) -> bool {
            self.entries.lock().unwrap().contains_key(name)
        }

        fn put(&self, name: &str, value: &str) {
            self.entries
                .lock()
                .unwrap()
                .insert(name.into(), value.into());
        }

        fn remove(&self, name: &str) {
            self.entries.lock().unwrap().remove(name);
        }

        fn reads(&self, name: &str) -> usize {
            self.reads.lock().unwrap().get(name).copied().unwrap_or(0)
        }

        fn fail(&self) {
            *self.failing.lock().unwrap() = true;
        }

        fn check(&self) -> Result<(), String> {
            if *self.failing.lock().unwrap() {
                return Err("the keyring is locked".into());
            }
            Ok(())
        }
    }

    impl Keyring for MemoryKeyring {
        fn get(&self, name: &str) -> Result<Option<Zeroizing<String>>, String> {
            self.check()?;
            *self.reads.lock().unwrap().entry(name.into()).or_default() += 1;
            Ok(self
                .entries
                .lock()
                .unwrap()
                .get(name)
                .cloned()
                .map(Zeroizing::new))
        }

        fn set(&self, name: &str, value: &str) -> Result<(), String> {
            self.check()?;
            self.put(name, value);
            Ok(())
        }

        fn delete(&self, name: &str) -> Result<(), String> {
            self.check()?;
            self.remove(name);
            Ok(())
        }
    }

    fn vault(dir: &Path, keyring: &MemoryKeyring) -> SecretVault {
        SecretVault::new(dir, Box::new(keyring.clone()))
    }

    fn read(vault: &SecretVault, name: &str) -> Option<String> {
        vault.read(name).unwrap().map(|value| value.to_string())
    }

    fn stored(dir: &Path) -> VaultFile {
        serde_json::from_slice(&fs::read(dir.join(FILE_NAME)).unwrap()).unwrap()
    }

    fn set_aside_files(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("secrets.vault.unreadable-"))
            .collect()
    }

    #[test]
    fn secrets_round_trip_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        let first = vault(dir.path(), &keyring);

        assert_eq!(read(&first, "a"), None);
        first.write("a", "one").unwrap();
        first.write("b", &"x".repeat(10_000)).unwrap();
        assert_eq!(read(&first, "a").as_deref(), Some("one"));
        first.write("a", "two").unwrap();

        // Another run: the key comes from the credential store, the secrets from the file.
        let second = vault(dir.path(), &keyring);
        assert_eq!(read(&second, "a").as_deref(), Some("two"));
        assert_eq!(read(&second, "b").map(|b| b.len()), Some(10_000));
        second.delete("a").unwrap();
        second.delete("a").unwrap();
        assert_eq!(read(&second, "a"), None);
        assert_eq!(read(&second, "b").map(|b| b.len()), Some(10_000));

        let file = stored(dir.path());
        assert_eq!(file.format, "rim-secret-vault");
        assert_eq!(file.v, 1);
        assert_eq!(file.records.keys().collect::<Vec<_>>(), ["b"]);
        assert!(keyring.has(VAULT_KEY_NAME));
        assert!(!fs::read_to_string(dir.path().join(FILE_NAME))
            .unwrap()
            .contains("xxxx"));
    }

    #[test]
    fn the_vault_key_is_read_once_per_run() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        vault(dir.path(), &keyring).write("a", "one").unwrap();

        let vault = vault(dir.path(), &keyring);
        let before = keyring.reads(VAULT_KEY_NAME);
        for _ in 0..5 {
            assert_eq!(read(&vault, "a").as_deref(), Some("one"));
        }
        assert_eq!(keyring.reads(VAULT_KEY_NAME), before + 1);
    }

    #[test]
    fn every_write_draws_a_new_nonce() {
        let dir = tempfile::tempdir().unwrap();
        let vault = vault(dir.path(), &MemoryKeyring::default());
        vault.write("a", "same").unwrap();
        let first = stored(dir.path()).records["a"].clone();
        vault.write("a", "same").unwrap();
        let second = stored(dir.path()).records["a"].clone();
        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.sealed, second.sealed);
    }

    #[test]
    fn a_record_opens_only_under_its_own_name() {
        let key = [7u8; 32];
        let record = seal_record(&key, "a", "secret").unwrap();
        assert_eq!(open_record(&key, "a", &record).unwrap().as_str(), "secret");
        assert!(open_record(&key, "b", &record).is_err());
        assert!(open_record(&[8u8; 32], "a", &record).is_err());

        // Copied under another name in the file, it does not open, and that record is set aside.
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        vault(dir.path(), &keyring).write("a", "secret").unwrap();
        let mut file = stored(dir.path());
        let copied = file.records["a"].clone();
        file.records.insert("b".into(), copied);
        fs::write(
            dir.path().join(FILE_NAME),
            serde_json::to_vec(&file).unwrap(),
        )
        .unwrap();

        let vault = vault(dir.path(), &keyring);
        let err = vault.read("b").unwrap_err();
        assert!(matches!(err, VaultError::RecordUnreadable { .. }), "{err}");
        assert_eq!(read(&vault, "a").as_deref(), Some("secret"));
    }

    #[test]
    fn a_leftover_temp_file_is_harmless() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        let vault = vault(dir.path(), &keyring);
        vault.write("a", "one").unwrap();

        let temp = dir.path().join(TEMP_FILE_NAME);
        fs::write(&temp, b"{\"half\":").unwrap();
        assert_eq!(read(&vault, "a").as_deref(), Some("one"));
        vault.write("b", "two").unwrap();
        assert!(!temp.exists());
        assert_eq!(read(&vault, "a").as_deref(), Some("one"));
        assert_eq!(read(&vault, "b").as_deref(), Some("two"));
        assert!(set_aside_files(dir.path()).is_empty());
    }

    #[test]
    fn a_credential_store_secret_moves_into_the_vault_once() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        keyring.put("legacy", "old secret");
        let first = vault(dir.path(), &keyring);

        assert_eq!(read(&first, "legacy").as_deref(), Some("old secret"));
        assert!(!keyring.has("legacy"));
        assert!(stored(dir.path()).records.contains_key("legacy"));
        assert_eq!(read(&first, "legacy").as_deref(), Some("old secret"));
        assert_eq!(
            read(&vault(dir.path(), &keyring), "legacy").as_deref(),
            Some("old secret")
        );
        assert_eq!(keyring.reads("legacy"), 1);

        // A name the store does not hold either is asked about once per run.
        assert_eq!(read(&first, "absent"), None);
        assert_eq!(read(&first, "absent"), None);
        assert_eq!(keyring.reads("absent"), 1);
    }

    #[test]
    fn a_prefixed_delete_removes_only_the_records_it_names() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        let vault = vault(dir.path(), &keyring);
        vault
            .write("plugin-setting-v1:dev.a.b:rimp0_x:token", "one")
            .unwrap();
        vault
            .write("plugin-setting-v1:dev.a.b:rimp0_y:token", "two")
            .unwrap();
        vault
            .write("plugin-setting-v1:dev.a.bc:rimp0_x:token", "three")
            .unwrap();
        vault.write("ai-key", "four").unwrap();

        vault.delete_prefixed("plugin-setting-v1:dev.a.b:").unwrap();

        assert_eq!(
            read(&vault, "plugin-setting-v1:dev.a.b:rimp0_x:token"),
            None
        );
        assert_eq!(
            read(&vault, "plugin-setting-v1:dev.a.b:rimp0_y:token"),
            None
        );
        assert_eq!(
            read(&vault, "plugin-setting-v1:dev.a.bc:rimp0_x:token").as_deref(),
            Some("three")
        );
        assert_eq!(read(&vault, "ai-key").as_deref(), Some("four"));
        vault
            .delete_prefixed("plugin-setting-v1:dev.none:")
            .unwrap();
        assert!(vault.delete_prefixed("").is_err());
    }

    #[test]
    fn writes_go_to_the_vault_and_deletes_to_both() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        keyring.put("legacy", "old secret");
        let vault = vault(dir.path(), &keyring);

        vault.write("legacy", "new secret").unwrap();
        assert!(keyring.has("legacy"));
        assert_eq!(read(&vault, "legacy").as_deref(), Some("new secret"));

        vault.delete("legacy").unwrap();
        assert!(!keyring.has("legacy"));
        assert_eq!(read(&vault, "legacy"), None);
    }

    #[test]
    fn a_failing_store_delete_still_deletes_from_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        let vault = vault(dir.path(), &keyring);
        vault.write("a", "one").unwrap();

        keyring.fail();
        vault.delete("a").unwrap();
        assert!(!stored(dir.path()).records.contains_key("a"));
    }

    #[test]
    fn a_vault_that_does_not_parse_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        vault(dir.path(), &keyring).write("a", "one").unwrap();
        fs::write(dir.path().join(FILE_NAME), b"not json").unwrap();

        let vault = vault(dir.path(), &keyring);
        let err = vault.read("a").unwrap_err();
        assert!(matches!(err, VaultError::Unreadable { .. }), "{err}");
        assert!(err
            .to_string()
            .starts_with("the secret vault could not be opened"));
        let aside = set_aside_files(dir.path());
        assert_eq!(aside.len(), 1);
        assert_eq!(
            fs::read(dir.path().join(&aside[0])).unwrap(),
            b"not json".to_vec()
        );

        // A fresh vault takes its place.
        assert_eq!(read(&vault, "a"), None);
        vault.write("a", "again").unwrap();
        assert_eq!(read(&vault, "a").as_deref(), Some("again"));
    }

    #[test]
    fn finding_18_a_record_that_does_not_open_is_set_aside_alone() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        let first = vault(dir.path(), &keyring);
        first.write("a", "one").unwrap();
        first.write("b", "two").unwrap();
        first.write("c", "three").unwrap();
        // Damage record b alone: its ciphertext no longer opens.
        let mut file = stored(dir.path());
        let sealed = &mut file.records.get_mut("b").unwrap().sealed;
        let flipped = if sealed.starts_with('A') { "B" } else { "A" };
        sealed.replace_range(0..1, flipped);
        fs::write(
            dir.path().join(FILE_NAME),
            serde_json::to_vec(&file).unwrap(),
        )
        .unwrap();

        let vault = vault(dir.path(), &keyring);
        assert_eq!(read(&vault, "a").as_deref(), Some("one"));
        assert_eq!(read(&vault, "c").as_deref(), Some("three"));
        let err = vault.read("b").unwrap_err();
        assert!(
            matches!(&err, VaultError::RecordUnreadable { name, .. } if name == "b"),
            "{err}"
        );
        assert_eq!(
            stored(dir.path()).records.keys().collect::<Vec<_>>(),
            ["a", "c"]
        );
        let aside = set_aside_files(dir.path());
        assert_eq!(aside.len(), 1);
        assert!(aside[0].starts_with("secrets.vault.unreadable-records-"));
        let moved: VaultFile =
            serde_json::from_slice(&fs::read(dir.path().join(&aside[0])).unwrap()).unwrap();
        assert_eq!(moved.records.keys().collect::<Vec<_>>(), ["b"]);
        assert_eq!(moved.records["b"].sealed, file.records["b"].sealed);

        // A new value replaces it; another run never sees the damaged one.
        vault.write("b", "again").unwrap();
        assert_eq!(read(&vault, "b").as_deref(), Some("again"));
        let next = super::SecretVault::new(dir.path(), Box::new(keyring.clone()));
        assert_eq!(read(&next, "b").as_deref(), Some("again"));
        assert_eq!(read(&next, "a").as_deref(), Some("one"));
    }

    #[test]
    fn a_vault_under_another_key_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        vault(dir.path(), &keyring).write("a", "one").unwrap();
        keyring.put(VAULT_KEY_NAME, &URL_SAFE_NO_PAD.encode([9u8; 32]));

        let vault = vault(dir.path(), &keyring);
        assert!(matches!(
            vault.read("a"),
            Err(VaultError::Unreadable { .. })
        ));
        assert_eq!(set_aside_files(dir.path()).len(), 1);
        vault.write("a", "again").unwrap();
        assert_eq!(read(&vault, "a").as_deref(), Some("again"));
    }

    #[test]
    fn a_vault_without_its_key_is_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        vault(dir.path(), &keyring).write("a", "one").unwrap();
        keyring.remove(VAULT_KEY_NAME);

        let vault = vault(dir.path(), &keyring);
        assert!(matches!(
            vault.write("b", "two"),
            Err(VaultError::Unreadable { .. })
        ));
        assert_eq!(set_aside_files(dir.path()).len(), 1);
        assert!(!keyring.has(VAULT_KEY_NAME));

        vault.write("b", "two").unwrap();
        assert!(keyring.has(VAULT_KEY_NAME));
        assert_eq!(read(&vault, "a"), None);
        assert_eq!(read(&vault, "b").as_deref(), Some("two"));
    }

    #[test]
    fn a_credential_store_failure_leaves_the_vault_alone() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        vault(dir.path(), &keyring).write("a", "one").unwrap();
        let before = fs::read(dir.path().join(FILE_NAME)).unwrap();

        keyring.fail();
        let err = vault(dir.path(), &keyring).read("a").unwrap_err();
        assert!(matches!(err, VaultError::Store(_)), "{err}");
        assert!(err.to_string().contains("locked"), "{err}");
        assert_eq!(fs::read(dir.path().join(FILE_NAME)).unwrap(), before);
        assert!(set_aside_files(dir.path()).is_empty());
    }

    #[test]
    fn a_newer_vault_is_left_as_it_is() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        let newer = br#"{"format":"rim-secret-vault","v":2,"entries":[]}"#;
        fs::write(dir.path().join(FILE_NAME), newer).unwrap();

        let vault = vault(dir.path(), &keyring);
        assert!(matches!(vault.read("a"), Err(VaultError::Newer)));
        assert!(matches!(vault.write("a", "one"), Err(VaultError::Newer)));
        assert_eq!(
            fs::read(dir.path().join(FILE_NAME)).unwrap(),
            newer.to_vec()
        );
    }

    #[test]
    fn the_vault_key_entry_is_not_a_record() {
        let dir = tempfile::tempdir().unwrap();
        let keyring = MemoryKeyring::default();
        let vault = vault(dir.path(), &keyring);
        vault.write("a", "one").unwrap();
        assert!(vault.read(VAULT_KEY_NAME).is_err());
        assert!(vault.delete(VAULT_KEY_NAME).is_err());
        assert!(keyring.has(VAULT_KEY_NAME));
    }

    #[cfg(unix)]
    #[test]
    fn the_vault_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let vault = vault(dir.path(), &MemoryKeyring::default());
        fs::write(dir.path().join(TEMP_FILE_NAME), b"").unwrap();
        fs::set_permissions(
            dir.path().join(TEMP_FILE_NAME),
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        vault.write("a", "one").unwrap();
        vault.write("b", "two").unwrap();
        let mode = fs::metadata(dir.path().join(FILE_NAME))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
