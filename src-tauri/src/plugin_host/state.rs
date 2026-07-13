use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PluginStatus {
    Installed,
    Enabled,
    Disabled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRecord {
    pub plugin_id: String,
    pub status: PluginStatus,
    pub approved_capabilities: Vec<String>,
    /// AI command IDs the user has explicitly consented to expose to the agent.
    #[serde(default)]
    pub approved_ai_commands: Vec<String>,
    /// SHA-256 hex of the manifest JSON at install time. Re-consent required when
    /// the ai_callable command set changes (Widow H3 v1→v2 drift protection).
    #[serde(default)]
    pub manifest_hash: String,
    /// SHA-256 hex of the entire bundle contents (all files, sorted deterministically)
    /// recorded at install time (TOFU fingerprint). At enable time this is recomputed
    /// and compared; a mismatch surfaces a `FingerprintChanged` warning before spawning.
    #[serde(default)]
    pub bundle_fingerprint: String,
    /// Set to true when the bundle fingerprint has changed since the last pinned install.
    /// Cleared when the user explicitly trusts the new version via `plugin_trust_fingerprint`.
    #[serde(default)]
    pub fingerprint_changed: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginStateStore {
    pub plugins: HashMap<String, PluginRecord>,
}

impl PluginStateStore {
    pub fn load(path: &Path) -> Self {
        match std::fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(store) => store,
                Err(e) => {
                    // A corrupt state file vaporizes all approved capabilities and AI
                    // consents. Log before defaulting so an operator can recover the file.
                    log::warn!(
                        "[AUDIT] event=plugin_state_corrupt path={} reason={}",
                        path.display(),
                        e
                    );
                    Self::default()
                }
            },
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), std::io::Error> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
        // Atomic write: write to a sibling temp file, then rename over the target.
        // Prevents power-loss from leaving a truncated state file that silently
        // vaporizes all approved capabilities and AI consents on next boot.
        let tmp_path = path.with_extension("json.tmp");
        std::fs::write(&tmp_path, &json)?;
        std::fs::rename(&tmp_path, path)
    }

    pub fn get(&self, plugin_id: &str) -> Option<&PluginRecord> {
        self.plugins.get(plugin_id)
    }

    pub fn upsert(&mut self, record: PluginRecord) {
        self.plugins.insert(record.plugin_id.clone(), record);
    }

    pub fn remove(&mut self, plugin_id: &str) -> Option<PluginRecord> {
        self.plugins.remove(plugin_id)
    }
}

pub fn state_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("plugin_state.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn roundtrip() {
        let mut store = PluginStateStore::default();
        store.upsert(PluginRecord {
            plugin_id: "dev.example.test".into(),
            status: PluginStatus::Enabled,
            approved_capabilities: vec!["local.process".into()],
            approved_ai_commands: vec![],
            manifest_hash: String::new(),
            bundle_fingerprint: String::new(),
            fingerprint_changed: false,
            last_error: None,
        });

        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();
        store.save(&path).unwrap();

        let loaded = PluginStateStore::load(&path);
        assert_eq!(loaded.plugins.len(), 1);
        let rec = loaded.get("dev.example.test").unwrap();
        assert_eq!(rec.status, PluginStatus::Enabled);
        assert_eq!(rec.approved_capabilities, vec!["local.process"]);
    }

    #[test]
    fn load_missing_file_returns_default() {
        let store = PluginStateStore::load(Path::new("/tmp/nonexistent_plugin_state.json"));
        assert!(store.plugins.is_empty());
    }
}
