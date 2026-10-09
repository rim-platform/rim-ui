//! Encrypted local message cache (master plan Stage 2, PR 9).
//!
//! Messages of the conversations a user opens are kept on this device in an SQLCipher
//! database, so the app starts with history and reads it offline. The server's
//! `messageChanges` feed (rim-server `docs/message-change-feed.md`) keeps it current: creates,
//! edits and deletes arrive in version order with a per-conversation cursor. Real-time events
//! are only a signal to ask the feed again.
//!
//! - One database file per account, named after a hash of (server endpoint, user id), and the
//!   account is recorded inside it, so two accounts never share a cache.
//! - One cache key per installation, in the OS keyring ([`key`]).
//! - Deleted messages stay as tombstones without text or attachments.
//! - An FTS5 index over the cached text, inside the same encrypted file, serves local search
//!   ([`search`], PR 10).
//! - Every change is numbered so the history archive can export incrementally, and a restore
//!   from the archive writes back through the sync's own upsert ([`archive`]).
//! - Last-known copies of the user, workspaces and sidebar lists let the app open offline
//!   ([`snapshot`]).
//!
//! The webview performs the HTTP call (it holds the session cookie) and passes the answer
//! in; see `sync.rs` for the loop and `commands.rs` for the Tauri surface.

mod archive;
pub(crate) mod commands;
mod feed;
mod key;
mod search;
mod snapshot;
mod store;
mod sync;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use key::{CacheKey, KeySource, KeyringKeySource};
pub(crate) use store::CacheStore;

#[derive(Debug, thiserror::Error)]
pub(crate) enum CacheError {
    #[error("cache key unavailable: {0}")]
    Key(String),
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
}

impl CacheError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Key(_) => "CACHE_KEY",
            Self::Db(_) | Self::Unreadable | Self::Schema(_) | Self::Io(_) | Self::Json(_) => {
                "CACHE_STORAGE"
            }
            Self::AccountMismatch => "CACHE_ACCOUNT_MISMATCH",
            Self::Invalid(_) => "INVALID_ARGS",
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

/// Tauri-managed state: the open databases, one per account, opened on first use.
pub(crate) struct MessageCacheState {
    dir: PathBuf,
    key_source: Box<dyn KeySource>,
    key: Mutex<Option<CacheKey>>,
    stores: Mutex<HashMap<String, Arc<Mutex<CacheStore>>>>,
}

impl MessageCacheState {
    fn new(dir: PathBuf, key_source: Box<dyn KeySource>) -> Self {
        Self {
            dir,
            key_source,
            key: Mutex::new(None),
            stores: Mutex::new(HashMap::new()),
        }
    }

    /// The account's database, opening (and creating) it on first use.
    pub(crate) fn store(&self, account: &AccountId) -> Result<Arc<Mutex<CacheStore>>, CacheError> {
        account.validate()?;
        let file_name = account.file_name();
        let mut stores = self.stores.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(store) = stores.get(&file_name) {
            return Ok(store.clone());
        }

        std::fs::create_dir_all(&self.dir).map_err(|e| CacheError::Io(e.to_string()))?;
        restrict_dir_permissions(&self.dir);
        let key = self.key()?;
        let store = Arc::new(Mutex::new(CacheStore::open(
            &self.dir.join(&file_name),
            &key,
            account,
        )?));
        stores.insert(file_name, store.clone());
        Ok(store)
    }

    /// The key is read from the keyring once per run. Callers hold the `stores` lock, so two
    /// first opens cannot each create a different key.
    fn key(&self) -> Result<CacheKey, CacheError> {
        let mut key = self.key.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(key) = key.as_ref() {
            return Ok(key.clone());
        }
        let loaded = self.key_source.load_or_create()?;
        *key = Some(loaded.clone());
        Ok(loaded)
    }
}

/// The cache lives in `<app data>/message-cache/`.
pub(crate) fn init(app_data_dir: &Path) -> MessageCacheState {
    MessageCacheState::new(
        app_data_dir.join("message-cache"),
        Box::new(KeyringKeySource),
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
