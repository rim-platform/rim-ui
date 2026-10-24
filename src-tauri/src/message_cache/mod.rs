//! Encrypted local message cache.
//!
//! Messages of the conversations a user opens are kept on this device in an SQLCipher
//! database, so the app starts with history and reads it offline. The server's
//! `messageChanges` feed keeps it current: creates, edits and deletes arrive in version order
//! with a per-conversation cursor. Real-time events are only a signal to ask the feed again.
//!
//! - One database file per account, named after a hash of (server endpoint, user id), and the
//!   account is recorded inside it, so two accounts never share a cache.
//! - One cache key per account, in the secret vault sealed under the account's data key
//!   ([`key`]): a locked account's cache does not open.
//! - Deleted messages stay as tombstones without text or attachments.
//! - An FTS5 index over the cached text, inside the same encrypted file, serves local search
//!   ([`search`]).
//! - Every change is numbered so the history archive can export incrementally, and a restore
//!   from the archive writes back through the sync's own upsert ([`archive`]).
//! - Last-known copies of the user, workspaces and sidebar lists let the app open offline
//!   ([`snapshot`]).
//!
//! The webview performs the HTTP call (it holds the session cookie) and passes the answer
//! in; see `sync.rs` for the loop and `commands.rs` for the Tauri surface.

mod archive;
pub(crate) mod commands;
pub(crate) mod feed;
mod key;
pub(crate) mod plugin_view;
mod search;
mod snapshot;
pub(crate) mod store;
pub(crate) mod sync;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::account_lock::AccountLock;
use crate::key_identity::KeyIdentityState;
use crate::secret_store::SecretVault;
use key::{KeySource, VaultKeySource};
pub(crate) use store::CacheStore;

#[derive(Debug, thiserror::Error)]
pub(crate) enum CacheError {
    #[error("cache key unavailable: {0}")]
    Key(String),
    /// The account is locked: its cache opens after the next unlock.
    #[error("this account is locked on this computer; its cache opens once it is unlocked")]
    Locked,
    #[error("cache database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("cache file is not readable with this key")]
    Unreadable,
    #[error("cache file belongs to another account")]
    AccountMismatch,
    #[error("cache schema: {0}")]
    Schema(String),
    #[error("invalid cache input: {0}")]
    Invalid(String),
    #[error("cache io error: {0}")]
    Io(String),
    #[error("cache json error: {0}")]
    Json(#[from] serde_json::Error),
    /// A plugin without `chat.read.encrypted` asked for an encrypted conversation.
    #[error("capability denied: chat.read.encrypted")]
    EncryptedDenied,
}

impl CacheError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Key(_) => "CACHE_KEY",
            Self::Locked => "LOCKED",
            Self::Db(_) | Self::Unreadable | Self::Schema(_) | Self::Io(_) | Self::Json(_) => {
                "CACHE_STORAGE"
            }
            Self::AccountMismatch => "CACHE_ACCOUNT_MISMATCH",
            Self::Invalid(_) => "INVALID_ARGS",
            Self::EncryptedDenied => "CAPABILITY_DENIED",
        }
    }
}

/// Serialized as `{ kind, message }`, the shape `safeInvoke` narrows.
impl Serialize for CacheError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("CacheError", 2)?;
        s.serialize_field("kind", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

/// Whose cache: the server the app talks to and the signed-in user on it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountId {
    pub endpoint: String,
    pub user_id: String,
}

impl AccountId {
    pub(crate) fn validate(&self) -> Result<(), CacheError> {
        if self.endpoint.trim().is_empty() || self.user_id.trim().is_empty() {
            return Err(CacheError::Invalid(
                "account needs an endpoint and a user id".into(),
            ));
        }
        Ok(())
    }

    /// The account as written into its database: endpoint without a trailing slash, then
    /// the user id.
    pub(crate) fn label(&self) -> String {
        format!(
            "{}\n{}",
            self.endpoint.trim().trim_end_matches('/'),
            self.user_id.trim()
        )
    }

    /// A name for this account's files: a hash, so no endpoint or user id is in clear on disk.
    pub(crate) fn file_stem(&self) -> String {
        let digest = Sha256::digest(self.label().as_bytes());
        hex::encode(&digest[..16])
    }

    /// The database file name.
    fn file_name(&self) -> String {
        format!("{}.db", self.file_stem())
    }
}

/// An open database and the principal whose data key sealed its key.
struct OpenStore {
    principal_id: String,
    store: Arc<Mutex<CacheStore>>,
}

/// Tauri-managed state: the open databases, one per account, opened on first use while the
/// account is unlocked.
pub(crate) struct MessageCacheState {
    dir: PathBuf,
    key_source: Box<dyn KeySource>,
    /// Why the secret vault could not give a key, once it failed.
    key_failure: Mutex<Option<String>>,
    stores: Mutex<HashMap<String, OpenStore>>,
}

impl MessageCacheState {
    fn new(dir: PathBuf, key_source: Box<dyn KeySource>) -> Self {
        Self {
            dir,
            key_source,
            key_failure: Mutex::new(None),
            stores: Mutex::new(HashMap::new()),
        }
    }

    /// The account's database, opening (and creating) it on first use.
    ///
    /// # Errors
    ///
    /// [`CacheError::Locked`] while the account is locked: a database open since its unlock
    /// is closed instead of served.
    pub(crate) fn store(&self, account: &AccountId) -> Result<Arc<Mutex<CacheStore>>, CacheError> {
        account.validate()?;
        let file_name = account.file_name();
        let mut stores = self.stores.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(open) = stores.get(&file_name) {
            if self.key_source.is_unlocked(&open.principal_id) {
                return Ok(open.store.clone());
            }
            stores.remove(&file_name);
            return Err(CacheError::Locked);
        }

        std::fs::create_dir_all(&self.dir).map_err(|e| CacheError::Io(e.to_string()))?;
        restrict_dir_permissions(&self.dir);
        let key = self.key(account)?;
        let store = Arc::new(Mutex::new(CacheStore::open(
            &self.dir.join(&file_name),
            &key.key,
            account,
        )?));
        stores.insert(
            file_name,
            OpenStore {
                principal_id: key.principal_id,
                store: store.clone(),
            },
        );
        Ok(store)
    }

    /// Close the account's database and delete its files (`.db`, `-wal`, `-shm`). Work already
    /// running on it finishes first; files that are not there are not an error.
    ///
    /// # Errors
    ///
    /// [`CacheError::Invalid`] for an account without an endpoint or user id, and
    /// [`CacheError::Io`] when a file cannot be deleted.
    pub(crate) fn remove(&self, account: &AccountId) -> Result<(), CacheError> {
        account.validate()?;
        let file_name = account.file_name();
        // Held until the files are gone, so no call opens the database again in between.
        let mut stores = self.stores.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(open) = stores.remove(&file_name) {
            let _running = open.store.lock().unwrap_or_else(|e| e.into_inner());
        }
        store::remove_database_files(&self.dir.join(&file_name))?;
        if let Err(e) = self.key_source.forget(account) {
            log::warn!("[message_cache] could not delete a removed cache's key: {e}");
        }
        Ok(())
    }

    /// The account's key, read when its database opens. Callers hold the `stores` lock, so two
    /// first opens cannot each create a different key. A secret vault failure is kept for the
    /// run: on Linux a locked keyring answers the vault key's read with an unlock prompt, and a
    /// dismissed one must not come back on every cache call. The cache stays off until the app
    /// restarts. A locked account is not a failure: its cache opens after the unlock.
    fn key(&self, account: &AccountId) -> Result<key::AccountKey, CacheError> {
        let mut failure = self.key_failure.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(reason) = failure.as_ref() {
            return Err(CacheError::Key(reason.clone()));
        }
        match self.key_source.load_or_create(account) {
            Err(CacheError::Key(reason)) => {
                *failure = Some(reason.clone());
                Err(CacheError::Key(reason))
            }
            other => other,
        }
    }

    /// Closes every database of `principal_id`, and with them the only copies of their keys in
    /// memory: the next call opens one again, if the account is unlocked. An operation still
    /// running on one keeps its connection until it ends.
    pub(crate) fn close_principal(&self, principal_id: &str) {
        let mut stores = self.stores.lock().unwrap_or_else(|e| e.into_inner());
        stores.retain(|_, open| open.principal_id != principal_id);
    }
}

/// The cache lives in `<app data>/message-cache/`, each account's key in the secret vault
/// under that account's data key.
pub(crate) fn init(
    app_data_dir: &Path,
    vault: Arc<SecretVault>,
    account_lock: AccountLock,
    keys: KeyIdentityState,
) -> MessageCacheState {
    MessageCacheState::new(
        app_data_dir.join("message-cache"),
        Box::new(VaultKeySource {
            vault,
            account_lock,
            keys,
        }),
    )
}

#[cfg(unix)]
fn restrict_dir_permissions(dir: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Err(e) = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)) {
        log::warn!("[message_cache] could not restrict cache directory permissions: {e}");
    }
}

#[cfg(not(unix))]
fn restrict_dir_permissions(_dir: &Path) {}

#[cfg(test)]
pub(crate) mod tests;
