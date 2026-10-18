//! The values a user saves in a plugin's settings form, which the plugin reads
//! as its settings.
//!
//! They belong to one plugin, account and device, as a `rim.storage` store
//! does: the account is named by its provisional principal id, which stays the
//! same when the account switches to a key-based id. Non-secret values are a
//! JSON file under the app data directory, named by a hash of that id; each
//! secret value is a secret vault record named
//! `plugin-setting-v1:<plugin id>:<account>:<key>`. Nothing is synced, and
//! uninstalling the plugin deletes both.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use zeroize::Zeroizing;

use crate::plugin_host::manifest::SettingSchema;
use crate::plugin_host::validation::setting_value_error;
use crate::plugin_host::PluginHostState;
use crate::secret_store::SecretVault;

/// The prefix of every secret vault record that holds a secret setting.
const SECRET_RECORD_PREFIX: &str = "plugin-setting-v1";

/// Where secret setting values are kept: the secret vault in the app, memory in
/// tests. Errors are the store's message.
pub(crate) trait SettingSecrets: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, String>;
    fn write(&self, name: &str, value: &str) -> Result<(), String>;
    /// Deleting what is not there is not an error.
    fn delete(&self, name: &str) -> Result<(), String>;
    /// Deletes every record whose name starts with `prefix`.
    fn delete_prefixed(&self, prefix: &str) -> Result<(), String>;
}

impl SettingSecrets for SecretVault {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, String> {
        SecretVault::read(self, name).map_err(|e| e.to_string())
    }

    fn write(&self, name: &str, value: &str) -> Result<(), String> {
        SecretVault::write(self, name, value).map_err(|e| e.to_string())
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        SecretVault::delete(self, name).map_err(|e| e.to_string())
    }

    fn delete_prefixed(&self, prefix: &str) -> Result<(), String> {
        SecretVault::delete_prefixed(self, prefix).map_err(|e| e.to_string())
    }
}

/// Why reading or saving a plugin's settings failed.
#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("nobody is signed in")]
    NotSignedIn,
    #[error("plugin not found: {0}")]
    NotFound(String),
    /// A saved value the setting `key` does not accept, or a key the plugin
    /// does not declare.
    #[error("{key} {reason}")]
    InvalidValue { key: String, reason: String },
    /// The secret vault could not be read or written, for example while the
    /// keyring is locked.
    #[error("the plugin's secret settings are not available: {0}")]
    SecretsLocked(String),
    #[error("plugin settings failed: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for SettingsError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(None)?;
        let kind = match self {
            Self::NotSignedIn => "NOT_SIGNED_IN",
            Self::NotFound(_) => "NOT_FOUND",
            Self::InvalidValue { .. } => "INVALID_SETTING_VALUE",
            Self::SecretsLocked(_) => "SECRETS_LOCKED",
            Self::Io(_) => "INTERNAL_ERROR",
        };
        map.serialize_entry("kind", kind)?;
        map.serialize_entry("message", &self.to_string())?;
        if let Self::InvalidValue { key, reason } = self {
            map.serialize_entry("data", &serde_json::json!({ "key": key, "reason": reason }))?;
        }
        map.end()
    }
}

/// Why the settings a plugin reads could not be put together.
#[derive(Debug, thiserror::Error)]
pub enum SettingsReadError {
    #[error("plugin not found: {0}")]
    NotFound(String),
    /// A saved secret could not be read, for example while the keyring is locked.
    #[error("the plugin's secret settings are not available: {0}")]
    SecretsLocked(String),
    #[error("plugin settings failed: {0}")]
    Io(String),
}

/// The settings the installed plugin `plugin_id` reads for `account`: each
/// declared setting's saved value, or else its default, a secret's value in
/// plain form; a setting with neither is left out. Without an account, only the
/// defaults.
///
/// # Errors
///
/// Returns [`SettingsReadError::NotFound`] for a plugin that is not installed,
/// [`SettingsReadError::SecretsLocked`] when a saved secret cannot be read, and
/// [`SettingsReadError::Io`] when the values cannot be read.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn resolved_values(
    state: &PluginHostState,
    plugin_id: &str,
    account: Option<&str>,
) -> Result<Map<String, Value>, SettingsReadError> {
    let schema = state
        .manifests
        .lock()
        .map_err(|e| SettingsReadError::Io(e.to_string()))?
        .get(plugin_id)
        .map(|m| m.settings_schema.clone())
        .ok_or_else(|| SettingsReadError::NotFound(plugin_id.to_string()))?;
    state
        .settings
        .values(plugin_id, &schema, account)
        .map_err(|e| match e {
            SettingsError::SecretsLocked(reason) => SettingsReadError::SecretsLocked(reason),
            SettingsError::NotFound(id) => SettingsReadError::NotFound(id),
            other => SettingsReadError::Io(other.to_string()),
        })
}

/// Runs after a save or a reset changed `plugin_id`'s settings for the
/// signed-in account: the one place the host learns that the values a running
/// plugin holds are out of date. It tells the plugin nothing.
pub(crate) fn on_saved(_state: &PluginHostState, _plugin_id: &str) {}

/// What the settings form shows: the saved non-secret values and which secret
/// settings are set. A secret's value is never part of it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SettingsFormState {
    /// The saved value of each declared non-secret setting that has one.
    pub values: Map<String, Value>,
    /// Whether each declared secret setting has a saved value.
    pub secrets: BTreeMap<String, bool>,
    /// Whether this host keeps secret settings at all; always true on the desktop.
    pub secrets_available: bool,
    /// Why the secret settings could not be read, in which case `secrets` is empty.
    pub secrets_error: Option<String>,
}

/// Every plugin's saved settings: the files under one directory and the secret
/// store.
pub struct PluginSettings {
    root: PathBuf,
    secrets: Arc<dyn SettingSecrets>,
    /// Held across each read-modify-write, so two saves at once keep both changes.
    writes: Mutex<()>,
}

impl PluginSettings {
    /// The settings under `<app_data_dir>/plugin_settings`, with secret values
    /// in `secrets`.
    pub(crate) fn new(app_data_dir: &Path, secrets: Arc<dyn SettingSecrets>) -> Self {
        Self {
            root: app_data_dir.join("plugin_settings"),
            secrets,
            writes: Mutex::new(()),
        }
    }

    fn file_path(&self, plugin_id: &str, account: &str) -> PathBuf {
        let name = hex::encode(Sha256::digest(account.as_bytes()));
        self.root.join(plugin_id).join(format!("{name}.json"))
    }

    fn load(&self, plugin_id: &str, account: &str) -> Result<Map<String, Value>, SettingsError> {
        match std::fs::read_to_string(self.file_path(plugin_id, account)) {
            Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
            Err(e) => Err(e.into()),
        }
    }

    fn store(
        &self,
        plugin_id: &str,
        account: &str,
        values: &Map<String, Value>,
    ) -> Result<(), SettingsError> {
        let path = self.file_path(plugin_id, account);
        if values.is_empty() {
            return remove_file(&path);
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(values).unwrap_or_default())?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

    /// The form state of `plugin_id`'s settings for `account`.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::NotSignedIn`] without an account and
    /// [`SettingsError::Io`] when the values cannot be read. A secret store that
    /// cannot be read is reported in [`SettingsFormState::secrets_error`].
    pub fn form_state(
        &self,
        plugin_id: &str,
        schema: &[SettingSchema],
        account: Option<&str>,
    ) -> Result<SettingsFormState, SettingsError> {
        let account = account.ok_or(SettingsError::NotSignedIn)?;
        let saved = self.load(plugin_id, account)?;
        let values = schema
            .iter()
            .filter(|s| !s.is_secret)
            .filter_map(|s| saved.get(&s.key).map(|v| (s.key.clone(), v.clone())))
            .collect();
        let mut secrets = BTreeMap::new();
        let mut secrets_error = None;
        for setting in schema.iter().filter(|s| s.is_secret) {
            match self.read_secret(plugin_id, account, &setting.key) {
                Ok(stored) => {
                    secrets.insert(setting.key.clone(), stored.is_some());
                }
                Err(e) => {
                    secrets.clear();
                    secrets_error = Some(e.to_string());
                    break;
                }
            }
        }
        Ok(SettingsFormState {
            values,
            secrets,
            secrets_available: true,
            secrets_error,
        })
    }

    /// Saves `changes` to `plugin_id`'s settings for `account`: each key a
    /// declared setting, each value one the setting accepts, `null` clearing the
    /// saved value. Keys left out keep their values. Every change is checked
    /// before any is written.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::NotSignedIn`] without an account,
    /// [`SettingsError::InvalidValue`] naming the first wrong key,
    /// [`SettingsError::SecretsLocked`] when a secret cannot be written, and
    /// [`SettingsError::Io`] when the values cannot be read or written.
    pub fn save(
        &self,
        plugin_id: &str,
        schema: &[SettingSchema],
        account: Option<&str>,
        changes: &Map<String, Value>,
    ) -> Result<(), SettingsError> {
        let account = account.ok_or(SettingsError::NotSignedIn)?;
        let _writes = self.writes.lock().unwrap_or_else(|e| e.into_inner());
        let mut checked = Vec::with_capacity(changes.len());
        for (key, value) in changes {
            let invalid = |reason: &str| SettingsError::InvalidValue {
                key: key.clone(),
                reason: reason.to_string(),
            };
            let setting = schema
                .iter()
                .find(|s| &s.key == key)
                .ok_or_else(|| invalid("is not a setting of this plugin"))?;
            if !value.is_null() {
                if let Some(reason) = setting_value_error(setting, value) {
                    return Err(invalid(&reason));
                }
            }
            checked.push((setting, value));
        }

        for (setting, value) in checked.iter().filter(|(s, _)| s.is_secret) {
            let name = secret_name(plugin_id, account, &setting.key);
            let written = match value.as_str() {
                Some(secret) => self.secrets.write(&name, secret),
                None => self.secrets.delete(&name),
            };
            written.map_err(SettingsError::SecretsLocked)?;
        }

        if checked.iter().any(|(s, _)| !s.is_secret) {
            let mut saved = self.load(plugin_id, account)?;
            for (setting, value) in checked.iter().filter(|(s, _)| !s.is_secret) {
                if value.is_null() {
                    saved.remove(&setting.key);
                } else {
                    saved.insert(setting.key.clone(), (*value).clone());
                }
            }
            self.store(plugin_id, account, &saved)?;
        }
        Ok(())
    }

    /// Clears every saved value of `plugin_id` for `account`, so each setting
    /// falls back to its default or has none. The secret store is touched only
    /// when the schema declares a secret setting.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::NotSignedIn`] without an account,
    /// [`SettingsError::SecretsLocked`] when the secrets cannot be deleted, and
    /// [`SettingsError::Io`] when the values cannot be removed.
    pub fn reset(
        &self,
        plugin_id: &str,
        schema: &[SettingSchema],
        account: Option<&str>,
    ) -> Result<(), SettingsError> {
        let account = account.ok_or(SettingsError::NotSignedIn)?;
        let _writes = self.writes.lock().unwrap_or_else(|e| e.into_inner());
        if schema.iter().any(|s| s.is_secret) {
            self.secrets
                .delete_prefixed(&format!("{SECRET_RECORD_PREFIX}:{plugin_id}:{account}:"))
                .map_err(SettingsError::SecretsLocked)?;
        }
        remove_file(&self.file_path(plugin_id, account))
    }

    /// The settings `plugin_id` reads: for each declared setting the saved value,
    /// or else its default, a secret's value in plain form; a setting with
    /// neither is left out. Without an account, only the defaults.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::SecretsLocked`] when a saved secret cannot be
    /// read, never leaving it out as if it were unset, and [`SettingsError::Io`]
    /// when the values cannot be read.
    pub fn values(
        &self,
        plugin_id: &str,
        schema: &[SettingSchema],
        account: Option<&str>,
    ) -> Result<Map<String, Value>, SettingsError> {
        let saved = match account {
            Some(account) => self.load(plugin_id, account)?,
            None => Map::new(),
        };
        let mut values = Map::new();
        for setting in schema {
            let value = match (setting.is_secret, account) {
                (true, Some(account)) => self
                    .read_secret(plugin_id, account, &setting.key)?
                    .map(|secret| Value::String(secret.to_string())),
                (true, None) => None,
                (false, _) => saved.get(&setting.key).cloned(),
            };
            if let Some(value) = value.or_else(|| setting.default.clone()) {
                values.insert(setting.key.clone(), value);
            }
        }
        Ok(values)
    }

    /// Deletes every saved setting of `plugin_id`, for every account, on
    /// uninstall. Its secret records go too when `has_secrets` says its
    /// manifest declares a secret setting; otherwise the secret store is not
    /// opened.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::Io`] when the values cannot be removed and
    /// [`SettingsError::SecretsLocked`] when the secrets cannot be deleted; the
    /// values are removed first either way.
    pub fn remove_plugin(&self, plugin_id: &str, has_secrets: bool) -> Result<(), SettingsError> {
        let _writes = self.writes.lock().unwrap_or_else(|e| e.into_inner());
        let removed = match std::fs::remove_dir_all(self.root.join(plugin_id)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        };
        if has_secrets {
            self.secrets
                .delete_prefixed(&format!("{SECRET_RECORD_PREFIX}:{plugin_id}:"))
                .map_err(SettingsError::SecretsLocked)?;
        }
        removed
    }

    fn read_secret(
        &self,
        plugin_id: &str,
        account: &str,
        key: &str,
    ) -> Result<Option<Zeroizing<String>>, SettingsError> {
        self.secrets
            .read(&secret_name(plugin_id, account, key))
            .map_err(SettingsError::SecretsLocked)
    }
}

/// The secret vault record of one secret setting. A plugin id has no `:`, so a
/// record of one plugin never starts with another's prefix.
fn secret_name(plugin_id: &str, account: &str, key: &str) -> String {
    format!("{SECRET_RECORD_PREFIX}:{plugin_id}:{account}:{key}")
}

fn remove_file(path: &Path) -> Result<(), SettingsError> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
impl PluginSettings {
    /// Settings under `app_data_dir` with secrets in memory, for tests.
    pub(crate) fn in_memory(app_data_dir: &Path) -> Self {
        Self::new(app_data_dir, Arc::new(MemorySecrets::default()))
    }
}

/// Secret settings in memory, for tests; [`MemorySecrets::lock`] makes every
/// call fail as a locked keyring does.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct MemorySecrets {
    records: std::sync::Mutex<BTreeMap<String, String>>,
    locked: std::sync::atomic::AtomicBool,
}

#[cfg(test)]
impl MemorySecrets {
    pub(crate) fn lock(&self) {
        self.locked.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub(crate) fn names(&self) -> Vec<String> {
        self.records.lock().unwrap().keys().cloned().collect()
    }

    fn check(&self) -> Result<(), String> {
        if self.locked.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("the keyring is locked".into());
        }
        Ok(())
    }
}

#[cfg(test)]
impl SettingSecrets for MemorySecrets {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, String> {
        self.check()?;
        Ok(self
            .records
            .lock()
            .unwrap()
            .get(name)
            .cloned()
            .map(Zeroizing::new))
    }

    fn write(&self, name: &str, value: &str) -> Result<(), String> {
        self.check()?;
        self.records
            .lock()
            .unwrap()
            .insert(name.into(), value.into());
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        self.check()?;
        self.records.lock().unwrap().remove(name);
        Ok(())
    }

    fn delete_prefixed(&self, prefix: &str) -> Result<(), String> {
        self.check()?;
        self.records
            .lock()
            .unwrap()
            .retain(|name, _| !name.starts_with(prefix));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    const PLUGIN: &str = "dev.example.pods";
    const A: Option<&str> = Some("rimp0_a");
    const B: Option<&str> = Some("rimp0_b");

    /// The settings of the protocol's example plugin.
    fn schema() -> Vec<SettingSchema> {
        serde_json::from_value(json!([
            { "key": "context", "title": "Kubernetes context", "value_type": "string", "placeholder": "prod-eu" },
            { "key": "namespace", "title": "Default namespace", "value_type": "string", "default": "default" },
            { "key": "refresh_seconds", "title": "Refresh", "value_type": "integer", "default": 30, "min": 5, "max": 3600 },
            { "key": "output", "title": "Output", "value_type": "enum", "options": ["table", "json"], "default": "table" },
            { "key": "watch", "title": "Watch", "value_type": "boolean" },
            { "key": "api_token", "title": "API server token", "value_type": "string", "is_secret": true }
        ]))
        .unwrap()
    }

    fn settings(dir: &TempDir) -> (PluginSettings, Arc<MemorySecrets>) {
        let secrets = Arc::new(MemorySecrets::default());
        (PluginSettings::new(dir.path(), secrets.clone()), secrets)
    }

    fn changes(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn values_merge_saved_values_with_defaults_and_leave_out_unset_settings() {
        let dir = TempDir::new().unwrap();
        let (settings, _) = settings(&dir);
        assert_eq!(
            settings.values(PLUGIN, &schema(), A).unwrap(),
            changes(json!({ "namespace": "default", "refresh_seconds": 30, "output": "table" }))
        );
        settings
            .save(
                PLUGIN,
                &schema(),
                A,
                &changes(json!({ "namespace": "prod", "watch": false, "api_token": "eyJ" })),
            )
            .unwrap();
        assert_eq!(
            settings.values(PLUGIN, &schema(), A).unwrap(),
            changes(json!({
                "namespace": "prod",
                "refresh_seconds": 30,
                "output": "table",
                "watch": false,
                "api_token": "eyJ"
            }))
        );
    }

    #[test]
    fn values_are_scoped_to_plugin_and_account_and_defaults_only_signed_out() {
        let dir = TempDir::new().unwrap();
        let (settings, secrets) = settings(&dir);
        settings
            .save(
                PLUGIN,
                &schema(),
                A,
                &changes(json!({ "context": "prod-eu", "api_token": "secret-a" })),
            )
            .unwrap();
        let defaults =
            changes(json!({ "namespace": "default", "refresh_seconds": 30, "output": "table" }));
        assert_eq!(settings.values(PLUGIN, &schema(), B).unwrap(), defaults);
        assert_eq!(
            settings.values("dev.example.other", &schema(), A).unwrap(),
            defaults
        );
        assert_eq!(settings.values(PLUGIN, &schema(), None).unwrap(), defaults);
        assert_eq!(
            secrets.names(),
            vec!["plugin-setting-v1:dev.example.pods:rimp0_a:api_token".to_string()]
        );
    }

    #[test]
    fn the_form_state_holds_saved_values_and_secret_flags_never_a_secret() {
        let dir = TempDir::new().unwrap();
        let (settings, _) = settings(&dir);
        settings
            .save(
                PLUGIN,
                &schema(),
                A,
                &changes(json!({ "refresh_seconds": 60, "api_token": "top-secret" })),
            )
            .unwrap();
        let state = settings.form_state(PLUGIN, &schema(), A).unwrap();
        assert_eq!(state.values, changes(json!({ "refresh_seconds": 60 })));
        assert_eq!(
            state.secrets,
            BTreeMap::from([("api_token".to_string(), true)])
        );
        assert!(state.secrets_available);
        assert_eq!(state.secrets_error, None);
        let wire = serde_json::to_string(&state).unwrap();
        assert!(!wire.contains("top-secret"), "{wire}");

        let other = settings.form_state(PLUGIN, &schema(), B).unwrap();
        assert_eq!(
            other.secrets,
            BTreeMap::from([("api_token".to_string(), false)])
        );
        assert!(matches!(
            settings.form_state(PLUGIN, &schema(), None),
            Err(SettingsError::NotSignedIn)
        ));
    }

    #[test]
    fn a_locked_vault_shows_in_the_form_state_and_fails_the_full_values() {
        let dir = TempDir::new().unwrap();
        let (settings, secrets) = settings(&dir);
        settings
            .save(
                PLUGIN,
                &schema(),
                A,
                &changes(json!({ "context": "c", "api_token": "t" })),
            )
            .unwrap();
        secrets.lock();
        let state = settings.form_state(PLUGIN, &schema(), A).unwrap();
        assert_eq!(state.values, changes(json!({ "context": "c" })));
        assert!(state.secrets.is_empty());
        assert!(state.secrets_error.unwrap().contains("locked"));
        assert!(matches!(
            settings.values(PLUGIN, &schema(), A),
            Err(SettingsError::SecretsLocked(_))
        ));
        assert!(matches!(
            settings.save(PLUGIN, &schema(), A, &changes(json!({ "api_token": "u" }))),
            Err(SettingsError::SecretsLocked(_))
        ));
        // Signed out there are no secrets to read.
        assert!(settings.values(PLUGIN, &schema(), None).is_ok());
    }

    #[test]
    fn a_save_is_checked_against_the_schema_and_refused_whole() {
        let dir = TempDir::new().unwrap();
        let (settings, _) = settings(&dir);
        let refused = [
            (
                json!({ "refresh_seconds": 4 }),
                "refresh_seconds",
                "must be at least 5",
            ),
            (
                json!({ "refresh_seconds": 3601 }),
                "refresh_seconds",
                "must be at most 3600",
            ),
            (
                json!({ "refresh_seconds": "30" }),
                "refresh_seconds",
                "must be an integer",
            ),
            (
                json!({ "refresh_seconds": 2.5 }),
                "refresh_seconds",
                "must be an integer",
            ),
            (
                json!({ "output": "yaml" }),
                "output",
                "must be one of: table, json",
            ),
            (json!({ "watch": "yes" }), "watch", "must be true or false"),
            (json!({ "api_token": 5 }), "api_token", "must be a string"),
            (
                json!({ "unknown": 1 }),
                "unknown",
                "is not a setting of this plugin",
            ),
        ];
        for (change, key, reason) in refused {
            let mut all = changes(json!({ "context": "kept-out" }));
            all.extend(changes(change));
            match settings.save(PLUGIN, &schema(), A, &all) {
                Err(SettingsError::InvalidValue { key: k, reason: r }) => {
                    assert_eq!((k.as_str(), r.as_str()), (key, reason));
                }
                other => panic!("{key}: {other:?}"),
            }
        }
        assert_eq!(
            settings.form_state(PLUGIN, &schema(), A).unwrap().values,
            Map::new()
        );
        let error = SettingsError::InvalidValue {
            key: "output".into(),
            reason: "must be one of: table, json".into(),
        };
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            json!({
                "kind": "INVALID_SETTING_VALUE",
                "message": "output must be one of: table, json",
                "data": { "key": "output", "reason": "must be one of: table, json" }
            })
        );
        assert!(matches!(
            settings.save(PLUGIN, &schema(), None, &changes(json!({ "context": "c" }))),
            Err(SettingsError::NotSignedIn)
        ));
    }

    #[test]
    fn null_clears_a_value_and_keys_left_out_are_kept() {
        let dir = TempDir::new().unwrap();
        let (settings, secrets) = settings(&dir);
        settings
            .save(
                PLUGIN,
                &schema(),
                A,
                &changes(json!({ "namespace": "prod", "context": "c", "api_token": "t" })),
            )
            .unwrap();
        settings
            .save(
                PLUGIN,
                &schema(),
                A,
                &changes(json!({ "namespace": null, "api_token": null })),
            )
            .unwrap();
        assert_eq!(
            settings.values(PLUGIN, &schema(), A).unwrap(),
            changes(json!({
                "context": "c",
                "namespace": "default",
                "refresh_seconds": 30,
                "output": "table"
            }))
        );
        assert!(secrets.names().is_empty());
    }

    #[test]
    fn a_reset_clears_every_value_of_the_account_only() {
        let dir = TempDir::new().unwrap();
        let (settings, secrets) = settings(&dir);
        for account in [A, B] {
            settings
                .save(
                    PLUGIN,
                    &schema(),
                    account,
                    &changes(json!({ "context": "c", "api_token": "t" })),
                )
                .unwrap();
        }
        settings.reset(PLUGIN, &schema(), A).unwrap();
        let state = settings.form_state(PLUGIN, &schema(), A).unwrap();
        assert_eq!(state.values, Map::new());
        assert_eq!(
            state.secrets,
            BTreeMap::from([("api_token".to_string(), false)])
        );
        assert_eq!(
            settings.form_state(PLUGIN, &schema(), B).unwrap().values,
            changes(json!({ "context": "c" }))
        );
        assert_eq!(secrets.names().len(), 1);
    }

    #[test]
    fn removing_a_plugin_deletes_its_values_and_secrets_for_every_account() {
        let dir = TempDir::new().unwrap();
        let (settings, secrets) = settings(&dir);
        for account in [A, B] {
            settings
                .save(
                    PLUGIN,
                    &schema(),
                    account,
                    &changes(json!({ "context": "c", "api_token": "t" })),
                )
                .unwrap();
        }
        settings
            .save(
                "dev.example.podsx",
                &schema(),
                A,
                &changes(json!({ "api_token": "kept" })),
            )
            .unwrap();

        settings.remove_plugin(PLUGIN, true).unwrap();

        assert!(!dir.path().join("plugin_settings").join(PLUGIN).exists());
        assert_eq!(
            secrets.names(),
            vec!["plugin-setting-v1:dev.example.podsx:rimp0_a:api_token".to_string()]
        );
        settings.remove_plugin(PLUGIN, true).unwrap();
    }

    #[test]
    fn a_plugin_without_secret_settings_never_opens_the_secret_store() {
        let dir = TempDir::new().unwrap();
        let (settings, secrets) = settings(&dir);
        let plain: Vec<SettingSchema> = schema().into_iter().filter(|s| !s.is_secret).collect();
        secrets.lock();
        settings
            .save(PLUGIN, &plain, A, &changes(json!({ "context": "c" })))
            .unwrap();
        assert_eq!(
            settings
                .form_state(PLUGIN, &plain, A)
                .unwrap()
                .secrets_error,
            None
        );
        assert!(settings.values(PLUGIN, &plain, A).is_ok());
        settings.reset(PLUGIN, &plain, A).unwrap();
        settings.remove_plugin(PLUGIN, false).unwrap();
        assert!(matches!(
            settings.remove_plugin(PLUGIN, true),
            Err(SettingsError::SecretsLocked(_))
        ));
    }

    #[test]
    fn resolved_values_read_the_installed_schema_and_name_a_locked_vault() {
        let manifest: crate::plugin_host::manifest::PluginManifest =
            serde_json::from_value(json!({
                "manifest_version": 1,
                "plugin_id": PLUGIN,
                "display_name": "Pods",
                "version": "1.0.0",
                "description": "test",
                "runtime_kind": "DesktopLocalProcess",
                "entrypoint": "main",
                "settings_schema": schema(),
            }))
            .unwrap();
        let dir = TempDir::new().unwrap();
        let secrets = Arc::new(MemorySecrets::default());
        let mut state = PluginHostState::with_installed(vec![manifest]);
        state.settings = PluginSettings::new(dir.path(), secrets.clone());
        state
            .settings
            .save(PLUGIN, &schema(), A, &changes(json!({ "api_token": "t" })))
            .unwrap();
        on_saved(&state, PLUGIN);

        let values = resolved_values(&state, PLUGIN, A).unwrap();
        assert_eq!(values["api_token"], json!("t"));
        assert_eq!(values["refresh_seconds"], json!(30));
        assert!(!resolved_values(&state, PLUGIN, None)
            .unwrap()
            .contains_key("api_token"));
        assert!(matches!(
            resolved_values(&state, "dev.example.missing", A),
            Err(SettingsReadError::NotFound(_))
        ));
        secrets.lock();
        assert!(matches!(
            resolved_values(&state, PLUGIN, A),
            Err(SettingsReadError::SecretsLocked(_))
        ));
    }

    #[test]
    fn values_saved_under_an_older_schema_are_returned_as_saved() {
        let dir = TempDir::new().unwrap();
        let (settings, _) = settings(&dir);
        settings
            .save(
                PLUGIN,
                &schema(),
                A,
                &changes(json!({ "refresh_seconds": 10 })),
            )
            .unwrap();
        let mut newer = schema();
        newer[2].min = Some(20);
        newer.retain(|s| s.key != "context");
        let values = settings.values(PLUGIN, &newer, A).unwrap();
        assert_eq!(values["refresh_seconds"], json!(10));
        assert!(!values.contains_key("context"));
    }
}
