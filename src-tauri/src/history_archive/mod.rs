//! History archive (master plan Stage 2): the local message cache, written as encrypted
//! per-device files to a folder the user picks, and read back on a new device.
//!
//! The format is specified in `docs/specs/history-archive-v1.md`. In short:
//!
//! - One random archive key per archive, wrapped under the user's passphrase (Argon2id) in
//!   the archive's manifest. This device keeps the unwrapped key in the OS keyring so exports
//!   run without asking; a new device needs only the folder and the passphrase.
//! - Each device appends immutable, sealed segments under its own folder and lists them in
//!   its own head file, so devices sharing a folder never write the same file.
//! - Export is incremental from the cache's change numbers ([`crate::message_cache`]'s
//!   `archive.rs`); restore merges every device's segments into the cache, highest version
//!   wins.
//!
//! [`provider`] holds the storage trait and the local folder provider, which also covers
//! folders kept in sync by Dropbox, Google Drive or Syncthing clients.

pub(crate) mod commands;

mod archive;
mod crypto;
pub(crate) mod format;
pub(crate) mod merge;
mod provider;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::message_cache::{AccountId, CacheError, CacheStore};
use archive::Archive;
use crypto::{ArchiveKey, KdfCost};
use provider::{ArchiveProvider, LocalFolderProvider};

/// Messages per export batch: a batch is read in one cache transaction and held in memory
/// while its segments are written.
const EXPORT_BATCH_MESSAGES: usize = 5_000;

#[derive(Debug, thiserror::Error)]
pub(crate) enum ArchiveError {
    #[error("archive folder unavailable: {0}")]
    Unavailable(String),
    #[error("archive io error: {0}")]
    Io(String),
    #[error("cannot write into the archive folder: {0}")]
    NotWritable(String),
    #[error("archive format: {0}")]
    Format(String),
    #[error("archive file failed authentication: wrong key, or the file was changed")]
    Unauthentic,
    #[error("wrong passphrase")]
    WrongPassphrase,
    #[error("archive crypto: {0}")]
    Crypto(String),
    #[error("this folder already holds an archive")]
    Exists,
    #[error("this folder holds no archive")]
    NoArchive,
    #[error("the folder holds a different archive than the one this device writes to")]
    Mismatch,
    #[error("no history archive is set up for this account")]
    NotConfigured,
    #[error("the history archive is locked on this device; enter its passphrase")]
    Locked,
    #[error("archive key storage: {0}")]
    Key(String),
    #[error("invalid archive input: {0}")]
    Invalid(String),
    #[error(transparent)]
    Cache(#[from] CacheError),
}

impl ArchiveError {
    fn code(&self) -> &'static str {
        match self {
            Self::Unavailable(_) => "ARCHIVE_UNAVAILABLE",
            Self::Io(_) => "ARCHIVE_IO",
            Self::NotWritable(_) => "ARCHIVE_NOT_WRITABLE",
            Self::Format(_) | Self::Unauthentic | Self::Crypto(_) => "ARCHIVE_FORMAT",
            Self::WrongPassphrase => "ARCHIVE_WRONG_PASSPHRASE",
            Self::Exists => "ARCHIVE_EXISTS",
            Self::NoArchive => "ARCHIVE_NOT_FOUND",
            Self::Mismatch => "ARCHIVE_MISMATCH",
            Self::NotConfigured => "ARCHIVE_NOT_CONFIGURED",
            Self::Locked => "ARCHIVE_LOCKED",
            Self::Key(_) => "ARCHIVE_KEY",
            Self::Invalid(_) => "INVALID_ARGS",
            Self::Cache(e) => e.code(),
        }
    }
}

/// Serialized as `{ kind, message }`, the shape `safeInvoke` narrows.
impl Serialize for ArchiveError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("ArchiveError", 2)?;
        s.serialize_field("kind", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

// ─── Key storage ────────────────────────────────────────────────────────────

/// Where this device keeps unwrapped archive keys. The OS keyring in the app; memory in tests.
pub(crate) trait KeyStore: Send + Sync {
    fn get(&self, archive_id: &str) -> Result<Option<ArchiveKey>, ArchiveError>;
    fn set(&self, archive_id: &str, key: &ArchiveKey) -> Result<(), ArchiveError>;
    fn delete(&self, archive_id: &str) -> Result<(), ArchiveError>;
}

struct KeyringKeyStore;

impl KeyringKeyStore {
    fn entry(archive_id: &str) -> Result<keyring::Entry, ArchiveError> {
        keyring::Entry::new(
            crate::agent_proxy::KEYRING_SERVICE,
            &format!("history-archive-key-v1:{archive_id}"),
        )
        .map_err(|e| ArchiveError::Key(format!("keyring init failed: {e}")))
    }
}

impl KeyStore for KeyringKeyStore {
    fn get(&self, archive_id: &str) -> Result<Option<ArchiveKey>, ArchiveError> {
        match Self::entry(archive_id)?.get_password() {
            Ok(stored) => {
                let bytes = Zeroizing::new(
                    URL_SAFE_NO_PAD
                        .decode(stored)
                        .map_err(|_| ArchiveError::Key("stored key is not base64".into()))?,
                );
                let key = ArchiveKey::from_slice(&bytes)
                    .ok_or_else(|| ArchiveError::Key("stored key has the wrong length".into()))?;
                Ok(Some(key))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(ArchiveError::Key(format!("keyring read failed: {e}"))),
        }
    }

    fn set(&self, archive_id: &str, key: &ArchiveKey) -> Result<(), ArchiveError> {
        let encoded = Zeroizing::new(URL_SAFE_NO_PAD.encode(key.as_bytes()));
        Self::entry(archive_id)?
            .set_password(&encoded)
            .map_err(|e| ArchiveError::Key(format!("keyring store failed: {e}")))
    }

    fn delete(&self, archive_id: &str) -> Result<(), ArchiveError> {
        match Self::entry(archive_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(ArchiveError::Key(format!("keyring delete failed: {e}"))),
        }
    }
}

// ─── Per-account settings ───────────────────────────────────────────────────

/// Where an account's archive is. One file per account in `<app data>/history-archive/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountConfig {
    provider: ProviderConfig,
    archive_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ProviderConfig {
    #[serde(rename_all = "camelCase")]
    LocalFolder { path: String },
}

impl ProviderConfig {
    fn open(&self) -> Result<Box<dyn ArchiveProvider>, ArchiveError> {
        match self {
            Self::LocalFolder { path } => Ok(Box::new(LocalFolderProvider::new(path)?)),
        }
    }

    fn location(&self) -> String {
        match self {
            Self::LocalFolder { path } => path.clone(),
        }
    }
}

// ─── Results ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveStatus {
    pub configured: bool,
    pub folder: Option<String>,
    pub archive_id: Option<String>,
    pub device_id: String,
    /// This device has the archive key and can export without the passphrase.
    pub unlocked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderInfo {
    pub has_archive: bool,
    pub version: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectOutcome {
    pub status: ArchiveStatus,
    /// A new archive was started in the folder (it had none).
    pub created: bool,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportReport {
    pub segments: usize,
    pub messages: usize,
    pub conversations: usize,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreReport {
    pub devices: usize,
    pub segments_read: usize,
    /// Listed but not in the folder yet (a sync client still downloading); a later restore
    /// picks them up.
    pub segments_missing: usize,
    pub segments_damaged: usize,
    pub messages: usize,
    pub conversations: usize,
}

// ─── State ──────────────────────────────────────────────────────────────────

/// Tauri-managed state of the history archive. Clones share everything, so a command can
/// move one into a blocking task.
#[derive(Clone)]
pub(crate) struct HistoryArchiveState {
    dir: PathBuf,
    keys: Arc<dyn KeyStore>,
    cost: KdfCost,
    /// One archive operation at a time: two exports must not both append segment `n`.
    op: Arc<Mutex<()>>,
}

impl HistoryArchiveState {
    fn new(dir: PathBuf, keys: Arc<dyn KeyStore>, cost: KdfCost) -> Self {
        Self {
            dir,
            keys,
            cost,
            op: Arc::new(Mutex::new(())),
        }
    }

    fn config_path(&self, account: &AccountId) -> PathBuf {
        self.dir.join(format!("{}.json", account.file_stem()))
    }

    fn config(&self, account: &AccountId) -> Result<Option<AccountConfig>, ArchiveError> {
        match std::fs::read(self.config_path(account)) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|e| ArchiveError::Format(format!("archive settings: {e}"))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(ArchiveError::Io(e.to_string())),
        }
    }

    fn save_config(&self, account: &AccountId, config: &AccountConfig) -> Result<(), ArchiveError> {
        std::fs::create_dir_all(&self.dir).map_err(|e| ArchiveError::Io(e.to_string()))?;
        let bytes =
            serde_json::to_vec_pretty(config).map_err(|e| ArchiveError::Format(e.to_string()))?;
        let path = self.config_path(account);
        let temp = path.with_extension("json.tmp");
        std::fs::write(&temp, bytes).map_err(|e| ArchiveError::Io(e.to_string()))?;
        std::fs::rename(&temp, &path).map_err(|e| ArchiveError::Io(e.to_string()))
    }

    /// This installation's device id, created on first use. Every account and archive on
    /// this installation writes under it.
    pub(crate) fn device_id(&self) -> Result<String, ArchiveError> {
        let path = self.dir.join("device-id");
        match std::fs::read_to_string(&path) {
            Ok(id) if format::check_id(id.trim()).is_ok() => return Ok(id.trim().to_string()),
            Ok(_) => log::warn!("[history_archive] replacing an unreadable device id"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(ArchiveError::Io(e.to_string())),
        }
        std::fs::create_dir_all(&self.dir).map_err(|e| ArchiveError::Io(e.to_string()))?;
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::write(&path, &id).map_err(|e| ArchiveError::Io(e.to_string()))?;
        Ok(id)
    }

    pub(crate) fn status(&self, account: &AccountId) -> Result<ArchiveStatus, ArchiveError> {
        account.validate()?;
        let device_id = self.device_id()?;
        let Some(config) = self.config(account)? else {
            return Ok(ArchiveStatus {
                configured: false,
                folder: None,
                archive_id: None,
                device_id,
                unlocked: false,
            });
        };
        let unlocked = self.keys.get(&config.archive_id)?.is_some();
        Ok(ArchiveStatus {
            configured: true,
            folder: Some(config.provider.location()),
            archive_id: Some(config.archive_id),
            device_id,
            unlocked,
        })
    }

    /// Whether a folder already holds an archive, so the UI can ask for a new passphrase or
    /// for the existing one. A folder this device cannot write into is refused here, before
    /// the user types a passphrase for it.
    pub(crate) fn inspect_folder(folder: &str) -> Result<FolderInfo, ArchiveError> {
        let provider = LocalFolderProvider::new(folder)?;
        provider.check_writable()?;
        let manifest = Archive::inspect(&provider)?;
        Ok(FolderInfo {
            has_archive: manifest.is_some(),
            version: manifest.map(|m| m.version),
        })
    }

    /// Use `folder` for the account's archive: unlock the archive in it with `passphrase`, or
    /// start one there if it has none.
    pub(crate) fn connect(
        &self,
        account: &AccountId,
        folder: &str,
        passphrase: &str,
    ) -> Result<ConnectOutcome, ArchiveError> {
        account.validate()?;
        let _op = self.op.lock().unwrap_or_else(|e| e.into_inner());
        let provider_config = ProviderConfig::LocalFolder {
            path: folder.to_string(),
        };
        let provider = provider_config.open()?;
        provider.check_writable()?;
        let (archive, created) = if Archive::inspect(provider.as_ref())?.is_some() {
            (Archive::unlock(provider, passphrase)?, false)
        } else {
            match Archive::create(provider, passphrase, self.cost, chrono::Utc::now()) {
                Ok(archive) => (archive, true),
                // Another device created one in the meantime: join it instead.
                Err(ArchiveError::Exists) => {
                    (Archive::unlock(provider_config.open()?, passphrase)?, false)
                }
                Err(e) => return Err(e),
            }
        };
        if let Some(previous) = self.config(account)? {
            if previous.archive_id != archive.id() {
                self.forget_key(account, &previous.archive_id)?;
            }
        }
        self.keys.set(archive.id(), archive.key())?;
        self.save_config(
            account,
            &AccountConfig {
                provider: provider_config,
                archive_id: archive.id().to_string(),
            },
        )?;
        Ok(ConnectOutcome {
            status: self.status(account)?,
            created,
        })
    }

    /// Put the archive key back on this device (the keyring lost it) with the passphrase.
    pub(crate) fn unlock(
        &self,
        account: &AccountId,
        passphrase: &str,
    ) -> Result<ArchiveStatus, ArchiveError> {
        account.validate()?;
        let config = self.config(account)?.ok_or(ArchiveError::NotConfigured)?;
        let archive = Archive::unlock(config.provider.open()?, passphrase)?;
        if archive.id() != config.archive_id {
            return Err(ArchiveError::Mismatch);
        }
        self.keys.set(archive.id(), archive.key())?;
        self.status(account)
    }

    /// Stop archiving this account on this device. The archive's files stay where they are.
    pub(crate) fn disconnect(&self, account: &AccountId) -> Result<(), ArchiveError> {
        let _op = self.op.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(config) = self.config(account)? {
            self.forget_key(account, &config.archive_id)?;
        }
        match std::fs::remove_file(self.config_path(account)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(ArchiveError::Io(e.to_string())),
        }
    }

    /// Remove an archive key from this device unless another account here still uses it.
    fn forget_key(&self, account: &AccountId, archive_id: &str) -> Result<(), ArchiveError> {
        let own = self.config_path(account);
        let entries = match std::fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(e) => return Err(ArchiveError::Io(e.to_string())),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path == own || path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            let other: Option<AccountConfig> = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok());
            if other.is_some_and(|c| c.archive_id == archive_id) {
                return Ok(());
            }
        }
        self.keys.delete(archive_id)
    }

    fn open_archive(&self, account: &AccountId) -> Result<Archive, ArchiveError> {
        account.validate()?;
        let config = self.config(account)?.ok_or(ArchiveError::NotConfigured)?;
        let key = self
            .keys
            .get(&config.archive_id)?
            .ok_or(ArchiveError::Locked)?;
        Archive::open(config.provider.open()?, &config.archive_id, key)
    }

    /// Write everything the account's cache (`store`) changed since this device's last
    /// export.
    pub(crate) fn export(
        &self,
        store: &Mutex<CacheStore>,
        account: &AccountId,
    ) -> Result<ExportReport, ArchiveError> {
        self.export_batched(store, account, EXPORT_BATCH_MESSAGES)
    }

    fn export_batched(
        &self,
        store: &Mutex<CacheStore>,
        account: &AccountId,
        batch_messages: usize,
    ) -> Result<ExportReport, ArchiveError> {
        let _op = self.op.lock().unwrap_or_else(|e| e.into_inner());
        let archive = self.open_archive(account)?;
        let device_id = self.device_id()?;
        let account_archive = archive.account(&account.label());

        let mut report = ExportReport::default();
        loop {
            // The cache is locked only while a batch is read, not while files are written.
            let batch = {
                let mut store = store.lock().unwrap_or_else(|e| e.into_inner());
                store.archive_batch(archive.id(), &device_id, batch_messages)?
            };
            let Some(batch) = batch else { break };
            let now_ms = chrono::Utc::now().timestamp_millis();
            report.segments += account_archive.append(&device_id, &batch.events, now_ms)?;
            report.messages += batch.messages;
            report.conversations += batch.conversations;
            store
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .mark_archived(archive.id(), &device_id, &batch)?;
        }
        Ok(report)
    }

    /// Read every device's segments and merge them into the account's cache (`store`).
    pub(crate) fn restore(
        &self,
        store: &Mutex<CacheStore>,
        account: &AccountId,
    ) -> Result<RestoreReport, ArchiveError> {
        let _op = self.op.lock().unwrap_or_else(|e| e.into_inner());
        let archive = self.open_archive(account)?;
        let contents = archive.account(&account.label()).read_all()?;
        let plan = merge::plan_restore(&contents);
        let counts = store
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .restore_archive(archive.id(), &plan)?;
        Ok(RestoreReport {
            devices: contents.devices,
            segments_read: contents.segments.len(),
            segments_missing: contents.missing.len(),
            segments_damaged: contents.damaged.len(),
            messages: counts.messages,
            conversations: counts.conversations,
        })
    }
}

/// The archive's settings live in `<app data>/history-archive/`.
pub(crate) fn init(app_data_dir: &Path) -> HistoryArchiveState {
    HistoryArchiveState::new(
        app_data_dir.join("history-archive"),
        Arc::new(KeyringKeyStore),
        KdfCost::DEFAULT,
    )
}

#[cfg(test)]
mod tests;
