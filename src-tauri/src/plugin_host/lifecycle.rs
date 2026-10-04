use crate::plugin_host::manifest::PluginManifest;
use crate::plugin_host::state::{PluginRecord, PluginStateStore, PluginStatus};
use crate::plugin_host::validation::{validate_plugin_manifest, ValidationError};

#[derive(Debug, thiserror::Error)]
pub enum LifecycleError {
    #[error("plugin not found: {0}")]
    NotFound(String),
    #[error("plugin already installed: {0}")]
    AlreadyInstalled(String),
    #[error("invalid state transition: {0} cannot {1}")]
    InvalidTransition(String, String),
    #[error("reserved plugin_id prefix: {0}")]
    ReservedPrefix(String),
    #[error("manifest error: {0}")]
    Manifest(#[from] crate::plugin_host::manifest::ManifestError),
    #[error("invalid manifest: {0}")]
    InvalidManifest(#[from] ValidationError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("capability not requested by plugin: {0}")]
    UnknownCapability(String),
    #[error("AI command not declared by plugin: {0}")]
    UnknownAiCommand(String),
    #[error("manifest changed — re-consent required for AI commands")]
    AiConsentRequired,
    #[error("plugin process is not running: {0}")]
    PluginNotRunning(String),
    /// Bundle fingerprint changed since TOFU install — user must trust new version.
    #[error("plugin bundle fingerprint changed since install: {0}")]
    FingerprintChanged(String),
}

impl serde::Serialize for LifecycleError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(None)?;
        match self {
            // Preserve inner typed ValidationError so JS can pattern-match on
            // `{kind: "INVALID_MANIFEST", data: {kind: "INSTALL_ID_LEAK", ...}}`.
            Self::InvalidManifest(inner) => {
                map.serialize_entry("kind", "INVALID_MANIFEST")?;
                map.serialize_entry("data", inner)?;
            }
            other => {
                map.serialize_entry("kind", "LIFECYCLE_ERROR")?;
                map.serialize_entry("message", &other.to_string())?;
            }
        }
        map.end()
    }
}

pub fn install(
    store: &mut PluginStateStore,
    manifest: &PluginManifest,
) -> Result<(), LifecycleError> {
    if store.get(&manifest.plugin_id).is_some() {
        return Err(LifecycleError::AlreadyInstalled(manifest.plugin_id.clone()));
    }
    if manifest.has_reserved_prefix() {
        log::warn!(
            "[AUDIT] event=plugin_install_rejected plugin_id={} reason=reserved_prefix",
            manifest.plugin_id
        );
        return Err(LifecycleError::ReservedPrefix(manifest.plugin_id.clone()));
    }
    manifest.validate()?;
    if let Err(e) = validate_plugin_manifest(manifest) {
        log::warn!(
            "[AUDIT] event=plugin_install_rejected plugin_id={} reason={}",
            manifest.plugin_id,
            e
        );
        return Err(LifecycleError::InvalidManifest(e));
    }

    store.upsert(PluginRecord {
        plugin_id: manifest.plugin_id.clone(),
        status: PluginStatus::Installed,
        approved_capabilities: vec![],
        approved_ai_commands: vec![],
        manifest_hash: manifest.content_hash(),
        bundle_fingerprint: String::new(),
        fingerprint_changed: false,
        last_error: None,
    });
    Ok(())
}

/// Returns Err(AiConsentRequired) if the manifest's ai_callable set changed since last install.
pub fn check_ai_consent_required(
    store: &PluginStateStore,
    manifest: &PluginManifest,
) -> Result<(), LifecycleError> {
    let Some(record) = store.get(&manifest.plugin_id) else {
        return Ok(());
    };
    if record.manifest_hash != manifest.content_hash() {
        // Hash changed — verify whether the ai_callable set specifically changed.
        let ai_ids = manifest.ai_callable_command_ids();
        let current_ai: std::collections::HashSet<&str> =
            ai_ids.iter().map(|s| s.as_str()).collect();
        // We can't recover the old set from just the hash, but hash change + any ai_callable
        // commands means we must require re-consent (conservative: Widow H3).
        if !current_ai.is_empty() || !record.approved_ai_commands.is_empty() {
            return Err(LifecycleError::AiConsentRequired);
        }
    }
    Ok(())
}

pub fn approve_ai_commands(
    store: &mut PluginStateStore,
    manifest: &PluginManifest,
    command_ids: &[String],
) -> Result<(), LifecycleError> {
    let record = store
        .get(&manifest.plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(manifest.plugin_id.clone()))?
        .clone();

    let declared_ids = manifest.ai_callable_command_ids();
    let declared: std::collections::HashSet<&str> =
        declared_ids.iter().map(|s| s.as_str()).collect();

    for id in command_ids {
        if !declared.contains(id.as_str()) {
            log::warn!(
                "[AUDIT] event=plugin_ai_consent_denied plugin_id={} command_id={} reason=not_declared",
                manifest.plugin_id,
                id
            );
            return Err(LifecycleError::UnknownAiCommand(id.clone()));
        }
    }

    let mut approved = record.approved_ai_commands.clone();
    for id in command_ids {
        if !approved.contains(id) {
            approved.push(id.clone());
        }
    }

    store.upsert(PluginRecord {
        approved_ai_commands: approved,
        manifest_hash: manifest.content_hash(),
        ..record
    });
    log::warn!(
        "[AUDIT] event=plugin_ai_consent_granted plugin_id={} commands={:?}",
        manifest.plugin_id,
        command_ids
    );
    Ok(())
}

pub fn revoke_ai_command(
    store: &mut PluginStateStore,
    plugin_id: &str,
    command_id: &str,
) -> Result<(), LifecycleError> {
    let record = store
        .get(plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.into()))?
        .clone();

    let mut approved = record.approved_ai_commands.clone();
    approved.retain(|id| id != command_id);

    store.upsert(PluginRecord {
        approved_ai_commands: approved,
        ..record
    });
    log::warn!(
        "[AUDIT] event=plugin_ai_consent_revoked plugin_id={} command_id={}",
        plugin_id,
        command_id
    );
    Ok(())
}

pub fn approve_capabilities(
    store: &mut PluginStateStore,
    manifest: &PluginManifest,
    capabilities: &[String],
) -> Result<(), LifecycleError> {
    let record = store
        .get(&manifest.plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(manifest.plugin_id.clone()))?
        .clone();

    // Verify all requested capabilities are declared in the manifest
    for cap in capabilities {
        if !manifest.capabilities.contains(cap) {
            return Err(LifecycleError::UnknownCapability(cap.clone()));
        }
    }

    let mut approved = record.approved_capabilities.clone();
    for cap in capabilities {
        if !approved.contains(cap) {
            approved.push(cap.clone());
        }
    }

    store.upsert(PluginRecord {
        approved_capabilities: approved,
        ..record
    });
    Ok(())
}

pub fn revoke_capability(
    store: &mut PluginStateStore,
    plugin_id: &str,
    capability: &str,
) -> Result<(), LifecycleError> {
    let record = store
        .get(plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.into()))?
        .clone();

    let mut approved = record.approved_capabilities.clone();
    approved.retain(|c| c != capability);

    // If we revoked a capability while plugin is enabled, disable it
    let new_status = if record.status == PluginStatus::Enabled {
        PluginStatus::Disabled
    } else {
        record.status
    };

    store.upsert(PluginRecord {
        approved_capabilities: approved,
        status: new_status,
        ..record
    });
    Ok(())
}

pub fn enable(store: &mut PluginStateStore, plugin_id: &str) -> Result<(), LifecycleError> {
    let record = store
        .get(plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.into()))?
        .clone();

    match record.status {
        PluginStatus::Installed | PluginStatus::Disabled => {}
        PluginStatus::Enabled => {
            return Err(LifecycleError::InvalidTransition(
                plugin_id.into(),
                "enable (already enabled)".into(),
            ));
        }
        PluginStatus::Error => {}
    }

    store.upsert(PluginRecord {
        status: PluginStatus::Enabled,
        last_error: None,
        ..record
    });
    Ok(())
}

pub fn disable(store: &mut PluginStateStore, plugin_id: &str) -> Result<(), LifecycleError> {
    let record = store
        .get(plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.into()))?
        .clone();

    if record.status != PluginStatus::Enabled {
        return Err(LifecycleError::InvalidTransition(
            plugin_id.into(),
            "disable (not enabled)".into(),
        ));
    }

    store.upsert(PluginRecord {
        status: PluginStatus::Disabled,
        ..record
    });
    Ok(())
}

pub fn uninstall(store: &mut PluginStateStore, plugin_id: &str) -> Result<(), LifecycleError> {
    let record = store
        .get(plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.into()))?
        .clone();

    if record.status == PluginStatus::Enabled {
        return Err(LifecycleError::InvalidTransition(
            plugin_id.into(),
            "uninstall (must disable first)".into(),
        ));
    }

    store.remove(plugin_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::manifest::{ManifestCommand, RuntimeKind};

    fn test_manifest(plugin_id: &str) -> PluginManifest {
        let cap1 = format!("plugin.{plugin_id}.run_process");
        let cap2 = format!("plugin.{plugin_id}.fetch_data");
        PluginManifest {
            manifest_version: 1,
            plugin_id: plugin_id.into(),
            display_name: "Test".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "main.js".into(),
            capabilities: vec![cap1, cap2],
            commands: vec![],
            keybind_suggestions: vec![],
            context_actions: vec![],
            panels: vec![],
            settings_schema: vec![],
        }
    }

    #[test]
    fn full_lifecycle() {
        let mut store = PluginStateStore::default();
        let manifest = test_manifest("dev.example.test");

        install(&mut store, &manifest).unwrap();
        assert_eq!(
            store.get("dev.example.test").unwrap().status,
            PluginStatus::Installed
        );

        approve_capabilities(
            &mut store,
            &manifest,
            &["plugin.dev.example.test.run_process".into()],
        )
        .unwrap();
        assert_eq!(
            store.get("dev.example.test").unwrap().approved_capabilities,
            vec!["plugin.dev.example.test.run_process"]
        );

        enable(&mut store, "dev.example.test").unwrap();
        assert_eq!(
            store.get("dev.example.test").unwrap().status,
            PluginStatus::Enabled
        );

        disable(&mut store, "dev.example.test").unwrap();
        assert_eq!(
            store.get("dev.example.test").unwrap().status,
            PluginStatus::Disabled
        );

        uninstall(&mut store, "dev.example.test").unwrap();
        assert!(store.get("dev.example.test").is_none());
    }

    #[test]
    fn reserved_prefix_rejected() {
        let mut store = PluginStateStore::default();
        let manifest = test_manifest("dev.rim.core");
        let err = install(&mut store, &manifest).unwrap_err();
        assert!(matches!(err, LifecycleError::ReservedPrefix(_)));
    }

    #[test]
    fn double_install_rejected() {
        let mut store = PluginStateStore::default();
        let manifest = test_manifest("dev.example.test");
        install(&mut store, &manifest).unwrap();
        let err = install(&mut store, &manifest).unwrap_err();
        assert!(matches!(err, LifecycleError::AlreadyInstalled(_)));
    }

    #[test]
    fn cannot_uninstall_enabled() {
        let mut store = PluginStateStore::default();
        let manifest = test_manifest("dev.example.test");
        install(&mut store, &manifest).unwrap();
        enable(&mut store, "dev.example.test").unwrap();
        let err = uninstall(&mut store, "dev.example.test").unwrap_err();
        assert!(matches!(err, LifecycleError::InvalidTransition(_, _)));
    }

    #[test]
    fn revoke_disables_enabled_plugin() {
        let mut store = PluginStateStore::default();
        let manifest = test_manifest("dev.example.test");
        install(&mut store, &manifest).unwrap();
        approve_capabilities(
            &mut store,
            &manifest,
            &["plugin.dev.example.test.run_process".into()],
        )
        .unwrap();
        enable(&mut store, "dev.example.test").unwrap();
        revoke_capability(
            &mut store,
            "dev.example.test",
            "plugin.dev.example.test.run_process",
        )
        .unwrap();
        assert_eq!(
            store.get("dev.example.test").unwrap().status,
            PluginStatus::Disabled
        );
    }

    #[test]
    fn unknown_capability_rejected() {
        let mut store = PluginStateStore::default();
        let manifest = test_manifest("dev.example.test");
        install(&mut store, &manifest).unwrap();
        let err =
            approve_capabilities(&mut store, &manifest, &["nonexistent.cap".into()]).unwrap_err();
        assert!(matches!(err, LifecycleError::UnknownCapability(_)));
    }

    // ── Phase 1 regression: install path is actually gated ──

    #[test]
    fn install_rejects_invalid_capability_key_and_leaves_no_record() {
        let mut store = PluginStateStore::default();
        // N1: capability key that does not match plugin.<id>. prefix
        let manifest = PluginManifest {
            manifest_version: 1,
            plugin_id: "dev.example.test".into(),
            display_name: "Test".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "main.js".into(),
            capabilities: vec!["system.evil".into()],
            commands: vec![],
            keybind_suggestions: vec![],
            context_actions: vec![],
            panels: vec![],
            settings_schema: vec![],
        };

        let err = install(&mut store, &manifest).unwrap_err();
        assert!(
            matches!(err, LifecycleError::InvalidManifest(_)),
            "expected InvalidManifest, got {err:?}"
        );
        // The store must NOT have a record for this plugin — it was rejected.
        assert!(
            store.get("dev.example.test").is_none(),
            "rejected plugin must not be persisted in the store"
        );
    }

    #[test]
    fn install_rejects_ai_callable_with_install_id_leak_and_leaves_no_record() {
        let mut store = PluginStateStore::default();
        let cap = "plugin.dev.example.test.do_thing".to_string();
        let leaky_schema = serde_json::json!({
            "type": "object",
            "properties": { "plugin_install_id": { "type": "string" } }
        });
        // F2: ai_callable command whose output_schema leaks install-ID
        let manifest = PluginManifest {
            manifest_version: 1,
            plugin_id: "dev.example.test".into(),
            display_name: "Test".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "main.js".into(),
            capabilities: vec![cap],
            commands: vec![ManifestCommand {
                id: "expose_id".into(),
                title: "Expose".into(),
                description: "leaks install id".into(),
                keybind_capable: false,
                dangerous: false,
                required_context: vec![],
                required_capabilities: vec![],
                arguments: vec![],
                ai_callable: true,
                output_schema: Some(leaky_schema),
            }],
            keybind_suggestions: vec![],
            context_actions: vec![],
            panels: vec![],
            settings_schema: vec![],
        };

        let err = install(&mut store, &manifest).unwrap_err();
        assert!(
            matches!(err, LifecycleError::InvalidManifest(_)),
            "expected InvalidManifest, got {err:?}"
        );
        assert!(
            store.get("dev.example.test").is_none(),
            "rejected plugin must not be persisted in the store"
        );
    }

    // ── AI consent: approve / revoke / drift detection ──

    fn ai_manifest(plugin_id: &str) -> PluginManifest {
        let cap = format!("plugin.{plugin_id}.do_thing");
        let clean_schema = serde_json::json!({
            "type": "object",
            "properties": { "summary": { "type": "string" } }
        });
        PluginManifest {
            manifest_version: 1,
            plugin_id: plugin_id.into(),
            display_name: "AI Test".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "main.js".into(),
            capabilities: vec![cap],
            commands: vec![ManifestCommand {
                id: "search".into(),
                title: "Search".into(),
                description: "search things".into(),
                keybind_capable: false,
                dangerous: false,
                required_context: vec![],
                required_capabilities: vec![],
                arguments: vec![],
                ai_callable: true,
                output_schema: Some(clean_schema),
            }],
            keybind_suggestions: vec![],
            context_actions: vec![],
            panels: vec![],
            settings_schema: vec![],
        }
    }

    #[test]
    fn approve_ai_commands_grants_consent_and_stores_hash() {
        let mut store = PluginStateStore::default();
        let manifest = ai_manifest("dev.example.test");
        install(&mut store, &manifest).unwrap();

        approve_ai_commands(&mut store, &manifest, &["search".into()]).unwrap();

        let record = store.get("dev.example.test").unwrap();
        assert_eq!(record.approved_ai_commands, vec!["search"]);
        assert_eq!(record.manifest_hash, manifest.content_hash());
    }

    #[test]
    fn approve_ai_commands_rejects_undeclared_command() {
        let mut store = PluginStateStore::default();
        let manifest = ai_manifest("dev.example.test");
        install(&mut store, &manifest).unwrap();

        let err = approve_ai_commands(&mut store, &manifest, &["nonexistent".into()]).unwrap_err();
        assert!(matches!(err, LifecycleError::UnknownAiCommand(_)));
    }

    #[test]
    fn revoke_ai_command_removes_from_approved_set() {
        let mut store = PluginStateStore::default();
        let manifest = ai_manifest("dev.example.test");
        install(&mut store, &manifest).unwrap();
        approve_ai_commands(&mut store, &manifest, &["search".into()]).unwrap();

        revoke_ai_command(&mut store, "dev.example.test", "search").unwrap();

        let record = store.get("dev.example.test").unwrap();
        assert!(record.approved_ai_commands.is_empty());
    }

    #[test]
    fn check_ai_consent_required_passes_when_hash_unchanged() {
        let mut store = PluginStateStore::default();
        let manifest = ai_manifest("dev.example.test");
        install(&mut store, &manifest).unwrap();
        approve_ai_commands(&mut store, &manifest, &["search".into()]).unwrap();

        // Same manifest — no drift.
        assert!(check_ai_consent_required(&store, &manifest).is_ok());
    }

    #[test]
    fn check_ai_consent_required_fails_when_manifest_drifted() {
        let mut store = PluginStateStore::default();
        let manifest_v1 = ai_manifest("dev.example.test");
        install(&mut store, &manifest_v1).unwrap();
        approve_ai_commands(&mut store, &manifest_v1, &["search".into()]).unwrap();

        // Simulate manifest v2: version bump changes the hash.
        let mut manifest_v2 = manifest_v1.clone();
        manifest_v2.version = "2.0.0".into();

        let err = check_ai_consent_required(&store, &manifest_v2).unwrap_err();
        assert!(
            matches!(err, LifecycleError::AiConsentRequired),
            "drift must require re-consent: {err:?}"
        );
    }

    // ── plugin_run_ai_command gate logic e2e ──
    //
    // The Tauri command itself cannot be invoked in unit tests (requires an AppHandle),
    // but the two security gates it enforces are exercised directly here:
    //   Gate 1: check_ai_consent_required — manifest must not have drifted.
    //   Gate 2: approved_ai_commands set — specific command must be approved.
    //
    // This mirrors the exact sequence in commands::plugin_run_ai_command.

    #[test]
    fn plugin_run_ai_command_gate_happy_path() {
        // Register a fake plugin with one ai_callable command.
        let mut store = PluginStateStore::default();
        let manifest = ai_manifest("dev.example.test");

        install(&mut store, &manifest).unwrap();
        approve_ai_commands(&mut store, &manifest, &["search".into()]).unwrap();

        let command_id = "search";

        // Gate 1: consent must not be required (manifest unchanged).
        check_ai_consent_required(&store, &manifest)
            .expect("gate 1 should pass when manifest is unchanged");

        // Gate 2: the specific command must be in the approved set.
        let record = store.get("dev.example.test").unwrap();
        assert!(
            record
                .approved_ai_commands
                .contains(&command_id.to_string()),
            "gate 2 should pass when command is in approved_ai_commands"
        );
    }

    #[test]
    fn plugin_run_ai_command_gate_blocks_unapproved_command() {
        let mut store = PluginStateStore::default();
        let manifest = ai_manifest("dev.example.test");

        install(&mut store, &manifest).unwrap();
        // No approval granted — approved_ai_commands is empty.

        // Gate 1 passes (no consent required when nothing is approved and manifest is fresh).
        check_ai_consent_required(&store, &manifest).expect("gate 1 should pass for fresh install");

        // Gate 2: unapproved command must NOT be in the set.
        let record = store.get("dev.example.test").unwrap();
        assert!(
            !record.approved_ai_commands.contains(&"search".to_string()),
            "gate 2 should block unapproved command"
        );
    }

    #[test]
    fn plugin_run_ai_command_gate_blocks_drifted_manifest() {
        let mut store = PluginStateStore::default();
        let manifest_v1 = ai_manifest("dev.example.test");

        install(&mut store, &manifest_v1).unwrap();
        approve_ai_commands(&mut store, &manifest_v1, &["search".into()]).unwrap();

        // Simulate manifest drift.
        let mut manifest_v2 = manifest_v1.clone();
        manifest_v2.version = "2.0.0".into();

        // Gate 1 must fail — re-consent is required.
        let err = check_ai_consent_required(&store, &manifest_v2).unwrap_err();
        assert!(
            matches!(err, LifecycleError::AiConsentRequired),
            "gate 1 must block drifted manifest: {err:?}"
        );
    }

    #[test]
    fn plugin_run_ai_command_gate_blocks_revoked_consent() {
        let mut store = PluginStateStore::default();
        let manifest = ai_manifest("dev.example.test");

        install(&mut store, &manifest).unwrap();
        approve_ai_commands(&mut store, &manifest, &["search".into()]).unwrap();
        revoke_ai_command(&mut store, "dev.example.test", "search").unwrap();

        // Gate 1 passes (manifest unchanged).
        check_ai_consent_required(&store, &manifest)
            .expect("gate 1 should pass when manifest is unchanged");

        // Gate 2: revoked command must no longer be in the approved set.
        let record = store.get("dev.example.test").unwrap();
        assert!(
            !record.approved_ai_commands.contains(&"search".to_string()),
            "gate 2 must block revoked command"
        );
    }
}
