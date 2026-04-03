use crate::plugin_host::manifest::PluginManifest;
use crate::plugin_host::state::{PluginRecord, PluginStateStore, PluginStatus};

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
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("capability not requested by plugin: {0}")]
    UnknownCapability(String),
}

impl serde::Serialize for LifecycleError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub fn install(
    store: &mut PluginStateStore,
    manifest: &PluginManifest,
) -> Result<(), LifecycleError> {
    if store.get(&manifest.plugin_id).is_some() {
        return Err(LifecycleError::AlreadyInstalled(
            manifest.plugin_id.clone(),
        ));
    }
    if manifest.has_reserved_prefix() {
        return Err(LifecycleError::ReservedPrefix(manifest.plugin_id.clone()));
    }
    manifest.validate()?;

    store.upsert(PluginRecord {
        plugin_id: manifest.plugin_id.clone(),
        status: PluginStatus::Installed,
        approved_capabilities: vec![],
        last_error: None,
    });
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
    use crate::plugin_host::manifest::RuntimeKind;

    fn test_manifest(plugin_id: &str) -> PluginManifest {
        PluginManifest {
            manifest_version: 1,
            plugin_id: plugin_id.into(),
            display_name: "Test".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "main.js".into(),
            capabilities: vec!["local.process".into(), "network".into()],
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

        approve_capabilities(&mut store, &manifest, &["local.process".into()]).unwrap();
        assert_eq!(
            store.get("dev.example.test").unwrap().approved_capabilities,
            vec!["local.process"]
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
        approve_capabilities(&mut store, &manifest, &["local.process".into()]).unwrap();
        enable(&mut store, "dev.example.test").unwrap();
        revoke_capability(&mut store, "dev.example.test", "local.process").unwrap();
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
}
