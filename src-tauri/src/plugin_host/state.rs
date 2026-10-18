use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
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
    /// SHA-256 hex of the manifest JSON at install time. A different hash on a later
    /// install requires the user to consent again to the plugin's ai_callable commands.
    #[serde(default)]
    pub manifest_hash: String,
    /// SHA-256 hex of the entire bundle contents (all files, sorted deterministically)
    /// recorded and trusted at install. At enable time and at app start this is
    /// recomputed and compared; a mismatch surfaces a `FingerprintChanged` warning
    /// and the plugin is not spawned.
    #[serde(default)]
    pub bundle_fingerprint: String,
    /// Set to true when the bundle fingerprint has changed since the last pinned install.
    /// Cleared when the user explicitly trusts the new version via `plugin_trust_fingerprint`.
    #[serde(default)]
    pub fingerprint_changed: bool,
    pub last_error: Option<String>,
    /// Where the plugin was installed from; `None` when that is not known.
    #[serde(default)]
    pub source: Option<InstallSource>,
    /// Set while the app starts a `WebSandboxed` plugin and cleared after its
    /// handshake. Still set at the next start means the app died starting it,
    /// so it is not started again until the user enables it.
    #[serde(default)]
    pub starting: bool,
}

/// Where an installed plugin came from, as Settings shows it and updates use it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum InstallSource {
    /// Copied from a folder on this computer.
    Local,
    /// Cloned from a git repository.
    Git { url: String },
    /// A `.rimbundle` fetched from a pasted link carrying its SHA-256.
    Link { url: String, sha256: String },
    /// A signed entry of a workspace's plugin registry.
    #[serde(rename_all = "camelCase")]
    Registry {
        endpoint: String,
        server_id: String,
        plugin_id: String,
        statement_sha256: String,
        publisher_principal_id: String,
    },
}

/// Grant events kept per plugin; older ones are dropped first.
pub const MAX_GRANT_EVENTS: usize = 200;
/// Days of encrypted-read counts kept per plugin.
pub const AUDIT_DAYS: usize = 90;

/// Whether a capability was given or taken back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GrantAction {
    Granted,
    Revoked,
}

/// One capability given to or taken back from a plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GrantEvent {
    pub capability: String,
    pub action: GrantAction,
    /// RFC 3339, UTC.
    pub at: String,
}

/// What the host records about a plugin for its settings page: when each capability
/// was given and revoked, and how many encrypted messages it read each day.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginAudit {
    /// Oldest first, at most [`MAX_GRANT_EVENTS`].
    #[serde(default)]
    pub grants: Vec<GrantEvent>,
    /// Encrypted messages read per UTC day (`YYYY-MM-DD`), the last [`AUDIT_DAYS`] days.
    #[serde(default)]
    pub encrypted_reads: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginStateStore {
    pub plugins: HashMap<String, PluginRecord>,
    /// Provisional `rimp0_` principal ids this device has seen switch to a key-based id,
    /// sent to plugins in `rim.principals.remapped`. Keyed by the old id.
    #[serde(default)]
    pub principal_ids: BTreeMap<String, String>,
    /// Each plugin's grant history and encrypted reads. Kept through updates, which
    /// replace the plugin's record, and dropped on uninstall.
    #[serde(default)]
    pub audit: BTreeMap<String, PluginAudit>,
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

    /// Records that `capability` was given to or taken back from `plugin_id` at `at`.
    pub fn record_grant(
        &mut self,
        plugin_id: &str,
        capability: &str,
        action: GrantAction,
        at: chrono::DateTime<chrono::Utc>,
    ) {
        let audit = self.audit.entry(plugin_id.to_string()).or_default();
        audit.grants.push(GrantEvent {
            capability: capability.to_string(),
            action,
            at: at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        });
        let excess = audit.grants.len().saturating_sub(MAX_GRANT_EVENTS);
        audit.grants.drain(..excess);
    }

    /// Adds `count` encrypted messages read by `plugin_id` on the UTC day of `at`.
    pub fn record_encrypted_reads(
        &mut self,
        plugin_id: &str,
        count: u64,
        at: chrono::DateTime<chrono::Utc>,
    ) {
        if count == 0 {
            return;
        }
        let audit = self.audit.entry(plugin_id.to_string()).or_default();
        let day = at.format("%Y-%m-%d").to_string();
        *audit.encrypted_reads.entry(day).or_default() += count;
        while audit.encrypted_reads.len() > AUDIT_DAYS {
            audit.encrypted_reads.pop_first();
        }
    }
}

pub fn state_file_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("plugin_state.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use tempfile::NamedTempFile;

    fn day(d: u32) -> chrono::DateTime<chrono::Utc> {
        chrono::Utc.with_ymd_and_hms(2026, 10, d, 12, 0, 0).unwrap()
    }

    #[test]
    fn grants_are_recorded_in_order_and_capped() {
        let mut store = PluginStateStore::default();
        store.record_grant("p", "chat.read", GrantAction::Granted, day(1));
        store.record_grant("p", "chat.read", GrantAction::Revoked, day(2));
        let grants = &store.audit["p"].grants;
        assert_eq!(grants[0].action, GrantAction::Granted);
        assert_eq!(grants[0].at, "2026-10-01T12:00:00Z");
        assert_eq!(grants[1].action, GrantAction::Revoked);

        for _ in 0..MAX_GRANT_EVENTS {
            store.record_grant("p", "ui.panel", GrantAction::Granted, day(3));
        }
        let grants = &store.audit["p"].grants;
        assert_eq!(grants.len(), MAX_GRANT_EVENTS);
        assert!(grants.iter().all(|g| g.capability == "ui.panel"));
    }

    #[test]
    fn encrypted_reads_are_counted_per_day_for_ninety_days() {
        let mut store = PluginStateStore::default();
        store.record_encrypted_reads("p", 3, day(1));
        store.record_encrypted_reads("p", 2, day(1));
        store.record_encrypted_reads("p", 0, day(2));
        store.record_encrypted_reads("p", 1, day(3));
        let reads = &store.audit["p"].encrypted_reads;
        assert_eq!(reads.get("2026-10-01"), Some(&5));
        assert_eq!(reads.get("2026-10-02"), None);
        assert_eq!(reads.get("2026-10-03"), Some(&1));

        let start = chrono::Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        for i in 0..(AUDIT_DAYS as i64 + 5) {
            store.record_encrypted_reads("q", 1, start + chrono::Duration::days(i));
        }
        let reads = &store.audit["q"].encrypted_reads;
        assert_eq!(reads.len(), AUDIT_DAYS);
        assert!(!reads.contains_key("2026-01-01"));
    }

    #[test]
    fn a_store_without_audit_still_loads() {
        let tmp = NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), r#"{"plugins":{}}"#).unwrap();
        let loaded = PluginStateStore::load(tmp.path());
        assert!(loaded.audit.is_empty());
    }

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
            source: None,
            starting: false,
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
    fn install_sources_are_tagged_by_kind() {
        let link = InstallSource::Link {
            url: "https://example.com/p.rimbundle".into(),
            sha256: "ab".into(),
        };
        assert_eq!(
            serde_json::to_value(&link).unwrap(),
            serde_json::json!({ "kind": "link", "url": "https://example.com/p.rimbundle", "sha256": "ab" })
        );
        let registry: InstallSource = serde_json::from_value(serde_json::json!({
            "kind": "registry", "endpoint": "https://rim.example/api", "serverId": "s",
            "pluginId": "dev.example.p", "statementSha256": "cd", "publisherPrincipalId": "rimp1_x"
        }))
        .unwrap();
        assert!(matches!(registry, InstallSource::Registry { .. }));
        assert_eq!(
            serde_json::to_value(InstallSource::Local).unwrap(),
            serde_json::json!({ "kind": "local" })
        );
    }

    #[test]
    fn load_missing_file_returns_default() {
        let store = PluginStateStore::load(Path::new("/tmp/nonexistent_plugin_state.json"));
        assert!(store.plugins.is_empty());
    }
}
