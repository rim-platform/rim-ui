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
    /// The ids of the manifest's `runs_commands` the person granted: the built-in and
    /// app commands the plugin may ask the app to run.
    #[serde(default)]
    pub granted_commands: Vec<String>,
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
/// Command runs kept per plugin; older ones are dropped first.
pub const MAX_COMMAND_RUNS: usize = 200;
/// The outcomes a recorded command run may have.
pub const COMMAND_RUN_OUTCOMES: &[&str] = &["success", "error", "refused"];

/// Whether a capability was given or taken back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GrantAction {
    Granted,
    Revoked,
}

/// What a grant event gave or took back: a capability, or a command the plugin may run.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GrantKind {
    #[default]
    Capability,
    Command,
}

impl GrantKind {
    fn is_capability(&self) -> bool {
        *self == GrantKind::Capability
    }
}

/// One capability, or one command the plugin may run, given to or taken back from a plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GrantEvent {
    /// The capability's name, or the command's id when `kind` is `command`.
    pub capability: String,
    /// Left out for a capability, as events written before commands could be granted are.
    #[serde(default, skip_serializing_if = "GrantKind::is_capability")]
    pub kind: GrantKind,
    pub action: GrantAction,
    /// RFC 3339, UTC.
    pub at: String,
}

/// One built-in or app command a plugin asked the app to run, and how it ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandRunEvent {
    pub command_id: String,
    /// `success`, `error` or `refused`.
    pub outcome: String,
    /// Why a refused run was refused, such as `NOT_GRANTED`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// RFC 3339, UTC.
    pub at: String,
}

/// What the host records about a plugin for its settings page: when each capability
/// and command was given and revoked, how many encrypted messages it read each day, and
/// the commands it asked the app to run.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginAudit {
    /// Oldest first, at most [`MAX_GRANT_EVENTS`].
    #[serde(default)]
    pub grants: Vec<GrantEvent>,
    /// Encrypted messages read per UTC day (`YYYY-MM-DD`), the last [`AUDIT_DAYS`] days.
    #[serde(default)]
    pub encrypted_reads: BTreeMap<String, u64>,
    /// Oldest first, at most [`MAX_COMMAND_RUNS`].
    #[serde(default)]
    pub command_runs: Vec<CommandRunEvent>,
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
        self.push_grant(plugin_id, capability, GrantKind::Capability, action, at);
    }

    /// Records that running the command `command_id` was granted to or taken back from
    /// `plugin_id` at `at`.
    pub fn record_command_grant(
        &mut self,
        plugin_id: &str,
        command_id: &str,
        action: GrantAction,
        at: chrono::DateTime<chrono::Utc>,
    ) {
        self.push_grant(plugin_id, command_id, GrantKind::Command, action, at);
    }

    fn push_grant(
        &mut self,
        plugin_id: &str,
        subject: &str,
        kind: GrantKind,
        action: GrantAction,
        at: chrono::DateTime<chrono::Utc>,
    ) {
        let audit = self.audit.entry(plugin_id.to_string()).or_default();
        audit.grants.push(GrantEvent {
            capability: subject.to_string(),
            kind,
            action,
            at: at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        });
        let excess = audit.grants.len().saturating_sub(MAX_GRANT_EVENTS);
        audit.grants.drain(..excess);
    }

    /// Records that `plugin_id` asked the app to run `command_id` at `at`, and how the
    /// run ended: `outcome` is one of [`COMMAND_RUN_OUTCOMES`], with `code` saying why a
    /// refused run was refused.
    pub fn record_command_run(
        &mut self,
        plugin_id: &str,
        command_id: &str,
        outcome: &str,
        code: Option<&str>,
        at: chrono::DateTime<chrono::Utc>,
    ) {
        let audit = self.audit.entry(plugin_id.to_string()).or_default();
        audit.command_runs.push(CommandRunEvent {
            command_id: command_id.to_string(),
            outcome: outcome.to_string(),
            code: code.map(str::to_string),
            at: at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        });
        let excess = audit.command_runs.len().saturating_sub(MAX_COMMAND_RUNS);
        audit.command_runs.drain(..excess);
    }

    /// Whether `plugin_id` is on and the person granted it running `command_id`.
    pub fn command_granted(&self, plugin_id: &str, command_id: &str) -> bool {
        self.get(plugin_id).is_some_and(|record| {
            record.status == PluginStatus::Enabled
                && record.granted_commands.iter().any(|c| c == command_id)
        })
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
    fn command_grants_are_marked_and_capability_grants_keep_their_shape() {
        let mut store = PluginStateStore::default();
        store.record_grant("p", "chat.read", GrantAction::Granted, day(1));
        store.record_command_grant("p", "workspace.go_back", GrantAction::Granted, day(2));
        store.record_command_grant("p", "workspace.go_back", GrantAction::Revoked, day(3));
        let grants = &store.audit["p"].grants;
        assert_eq!(grants[0].kind, GrantKind::Capability);
        assert_eq!(grants[1].kind, GrantKind::Command);
        assert_eq!(grants[2].action, GrantAction::Revoked);
        let json = serde_json::to_value(grants).unwrap();
        assert_eq!(
            json[0],
            serde_json::json!({ "capability": "chat.read", "action": "granted", "at": "2026-10-01T12:00:00Z" })
        );
        assert_eq!(json[1]["kind"], "command");
    }

    #[test]
    fn command_runs_are_recorded_in_order_and_capped() {
        let mut store = PluginStateStore::default();
        store.record_command_run("p", "workspace.go_back", "success", None, day(1));
        store.record_command_run(
            "p",
            "chat.post_message",
            "refused",
            Some("NOT_GRANTED"),
            day(2),
        );
        let runs = &store.audit["p"].command_runs;
        assert_eq!(runs[0].outcome, "success");
        assert_eq!(runs[0].code, None);
        assert_eq!(runs[1].code.as_deref(), Some("NOT_GRANTED"));
        assert_eq!(runs[1].at, "2026-10-02T12:00:00Z");
        for _ in 0..MAX_COMMAND_RUNS {
            store.record_command_run("p", "workspace.go_forward", "error", None, day(3));
        }
        let runs = &store.audit["p"].command_runs;
        assert_eq!(runs.len(), MAX_COMMAND_RUNS);
        assert!(runs.iter().all(|r| r.command_id == "workspace.go_forward"));
    }

    #[test]
    fn a_record_from_before_command_grants_loads_with_none_granted() {
        let tmp = NamedTempFile::new().unwrap();
        std::fs::write(
            tmp.path(),
            r#"{"plugins":{"dev.example.old":{"plugin_id":"dev.example.old","status":"Enabled","approved_capabilities":["ui.panel"],"last_error":null}},"audit":{"dev.example.old":{"grants":[{"capability":"ui.panel","action":"granted","at":"2026-10-01T12:00:00Z"}]}}}"#,
        )
        .unwrap();
        let loaded = PluginStateStore::load(tmp.path());
        let record = loaded.get("dev.example.old").unwrap();
        assert!(record.granted_commands.is_empty());
        assert_eq!(record.approved_capabilities, vec!["ui.panel"]);
        let audit = &loaded.audit["dev.example.old"];
        assert_eq!(audit.grants[0].kind, GrantKind::Capability);
        assert!(audit.command_runs.is_empty());
        assert!(!loaded.command_granted("dev.example.old", "workspace.go_back"));
    }

    #[test]
    fn a_command_is_granted_only_while_the_plugin_is_on() {
        let mut store = PluginStateStore::default();
        store.upsert(PluginRecord {
            plugin_id: "p".into(),
            status: PluginStatus::Enabled,
            approved_capabilities: vec![],
            approved_ai_commands: vec![],
            manifest_hash: String::new(),
            bundle_fingerprint: String::new(),
            fingerprint_changed: false,
            last_error: None,
            source: None,
            starting: false,
            granted_commands: vec!["workspace.go_back".into()],
        });
        assert!(store.command_granted("p", "workspace.go_back"));
        assert!(!store.command_granted("p", "workspace.go_forward"));
        assert!(!store.command_granted("q", "workspace.go_back"));
        let record = store.get("p").cloned().unwrap();
        store.upsert(PluginRecord {
            status: PluginStatus::Disabled,
            ..record
        });
        assert!(!store.command_granted("p", "workspace.go_back"));
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
            granted_commands: vec![],
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
