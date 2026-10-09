//! The small key-value store a `WebSandboxed` plugin reaches with
//! `rim.storage.get` and `rim.storage.set`, since its opaque origin has no
//! storage of its own.
//!
//! One store per plugin, account and device: a JSON file under the app data
//! directory, named by a hash of the account's provisional principal id, which
//! stays the same when the account switches to a key-based id. It is not
//! encrypted and not synced, and it is deleted when the plugin is uninstalled.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Largest store: key lengths plus the values' JSON text, in bytes.
pub const MAX_STORE_BYTES: usize = 1024 * 1024;
/// Longest key, in characters.
pub const MAX_KEY_LEN: usize = 128;

/// Why a storage call failed; every variant is `INVALID_PARAMS` on the wire
/// except [`StorageError::Io`].
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("nobody is signed in")]
    NotSignedIn,
    #[error("key must be 1 to {MAX_KEY_LEN} characters of A-Z a-z 0-9 . _ -")]
    InvalidKey,
    #[error("the plugin's store would exceed {MAX_STORE_BYTES} bytes")]
    Quota,
    #[error("plugin storage failed: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for StorageError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(None)?;
        let kind = match self {
            Self::Io(_) => "INTERNAL_ERROR",
            _ => "INVALID_PARAMS",
        };
        map.serialize_entry("kind", kind)?;
        map.serialize_entry("message", &self.to_string())?;
        if let Self::Quota = self {
            map.serialize_entry("data", &serde_json::json!({ "reason": "quota" }))?;
        }
        map.end()
    }
}

/// Whether `key` is a storage key: 1 to 128 characters of `A-Z a-z 0-9 . _ -`.
pub fn is_storage_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// Every plugin's stores, under one directory.
#[derive(Debug, Clone)]
pub struct PluginStorage {
    root: PathBuf,
}

impl PluginStorage {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            root: app_data_dir.join("plugin_storage"),
        }
    }

    fn store_path(&self, plugin_id: &str, account: &str) -> PathBuf {
        let name = hex::encode(Sha256::digest(account.as_bytes()));
        self.root.join(plugin_id).join(format!("{name}.json"))
    }

    fn load(&self, path: &Path) -> Result<Map<String, Value>, StorageError> {
        match std::fs::read_to_string(path) {
            Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
            Err(e) => Err(e.into()),
        }
    }

    /// The stored value of `key`, or `null`.
    pub fn get(
        &self,
        plugin_id: &str,
        account: Option<&str>,
        key: &str,
    ) -> Result<Value, StorageError> {
        let account = account.ok_or(StorageError::NotSignedIn)?;
        if !is_storage_key(key) {
            return Err(StorageError::InvalidKey);
        }
        let store = self.load(&self.store_path(plugin_id, account))?;
        Ok(store.get(key).cloned().unwrap_or(Value::Null))
    }

    /// Store `value` under `key`; `null` deletes the key.
    pub fn set(
        &self,
        plugin_id: &str,
        account: Option<&str>,
        key: &str,
        value: Value,
    ) -> Result<(), StorageError> {
        let account = account.ok_or(StorageError::NotSignedIn)?;
        if !is_storage_key(key) {
            return Err(StorageError::InvalidKey);
        }
        let path = self.store_path(plugin_id, account);
        let mut store = self.load(&path)?;
        if value.is_null() {
            store.remove(key);
        } else {
            store.insert(key.to_string(), value);
        }
        if store_size(&store) > MAX_STORE_BYTES {
            return Err(StorageError::Quota);
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(&store).unwrap_or_default())?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

    /// Delete every store of `plugin_id`, on uninstall.
    pub fn remove_plugin(&self, plugin_id: &str) -> Result<(), StorageError> {
        match std::fs::remove_dir_all(self.root.join(plugin_id)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }
}

/// Key lengths plus the values' JSON text.
fn store_size(store: &Map<String, Value>) -> usize {
    store
        .iter()
        .map(|(k, v)| k.len() + serde_json::to_string(v).map(|s| s.len()).unwrap_or(0))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    const PLUGIN: &str = "chat.rim.github-prs";

    #[test]
    fn stores_per_plugin_and_account() {
        let dir = TempDir::new().unwrap();
        let storage = PluginStorage::new(dir.path());
        storage
            .set(PLUGIN, Some("rimp0_a"), "repos", json!(["rust-lang/rust"]))
            .unwrap();
        assert_eq!(
            storage.get(PLUGIN, Some("rimp0_a"), "repos").unwrap(),
            json!(["rust-lang/rust"])
        );
        assert_eq!(
            storage.get(PLUGIN, Some("rimp0_b"), "repos").unwrap(),
            Value::Null
        );
        assert_eq!(
            storage
                .get("dev.example.other", Some("rimp0_a"), "repos")
                .unwrap(),
            Value::Null
        );
        storage
            .set(PLUGIN, Some("rimp0_a"), "repos", Value::Null)
            .unwrap();
        assert_eq!(
            storage.get(PLUGIN, Some("rimp0_a"), "repos").unwrap(),
            Value::Null
        );
    }

    #[test]
    fn refuses_bad_keys_signed_out_calls_and_a_full_store() {
        let dir = TempDir::new().unwrap();
        let storage = PluginStorage::new(dir.path());
        assert!(matches!(
            storage.get(PLUGIN, None, "repos"),
            Err(StorageError::NotSignedIn)
        ));
        for key in ["", "a/b", "ü", &"k".repeat(129)] {
            assert!(matches!(
                storage.set(PLUGIN, Some("rimp0_a"), key, json!(1)),
                Err(StorageError::InvalidKey)
            ));
        }
        let big = "x".repeat(MAX_STORE_BYTES - 10);
        storage
            .set(PLUGIN, Some("rimp0_a"), "a", json!(big))
            .unwrap();
        let err = storage
            .set(PLUGIN, Some("rimp0_a"), "b", json!("0123456789"))
            .unwrap_err();
        assert!(matches!(err, StorageError::Quota));
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            json!({ "kind": "INVALID_PARAMS", "message": err.to_string(), "data": { "reason": "quota" } })
        );
        storage.remove_plugin(PLUGIN).unwrap();
        assert_eq!(
            storage.get(PLUGIN, Some("rimp0_a"), "a").unwrap(),
            Value::Null
        );
    }
}
