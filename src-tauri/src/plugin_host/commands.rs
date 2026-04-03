use crate::plugin_host::git_install::{self, GitInstallError, PluginInstallResult, PluginUpdateResult};
use crate::plugin_host::lifecycle::{self, LifecycleError};
use crate::plugin_host::manifest::{ContextAction, KeybindSuggestion};
use crate::plugin_host::state::PluginStatus;
use crate::plugin_host::PluginHostState;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub plugin_id: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    pub status: PluginStatus,
    pub capabilities: Vec<String>,
    pub approved_capabilities: Vec<String>,
    pub context_actions: Vec<ContextAction>,
}

#[tauri::command]
pub fn plugin_list(state: State<'_, PluginHostState>) -> Result<Vec<PluginInfo>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let manifests = state.manifests.lock().map_err(|e| e.to_string())?;

    let mut plugins = Vec::new();
    for (id, record) in &store.plugins {
        let manifest = manifests.get(id);
        plugins.push(PluginInfo {
            plugin_id: id.clone(),
            display_name: manifest
                .map(|m| m.display_name.clone())
                .unwrap_or_else(|| id.clone()),
            version: manifest
                .map(|m| m.version.clone())
                .unwrap_or_else(|| "unknown".into()),
            description: manifest
                .map(|m| m.description.clone())
                .unwrap_or_default(),
            author: manifest.and_then(|m| m.author.clone()),
            status: record.status,
            capabilities: manifest
                .map(|m| m.capabilities.clone())
                .unwrap_or_default(),
            approved_capabilities: record.approved_capabilities.clone(),
            context_actions: manifest
                .map(|m| m.qualified_context_actions())
                .unwrap_or_default(),
        });
    }
    Ok(plugins)
}

#[tauri::command]
pub fn plugin_suggested_keybinds(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<Vec<KeybindSuggestion>, String> {
    let manifests = state.manifests.lock().map_err(|e| e.to_string())?;
    let manifest = manifests
        .get(&plugin_id)
        .ok_or_else(|| format!("plugin not found: {plugin_id}"))?;
    Ok(manifest.qualified_keybind_suggestions())
}

#[tauri::command]
pub fn plugin_context_actions(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<Vec<ContextAction>, String> {
    let manifests = state.manifests.lock().map_err(|e| e.to_string())?;
    let manifest = manifests
        .get(&plugin_id)
        .ok_or_else(|| format!("plugin not found: {plugin_id}"))?;
    Ok(manifest.qualified_context_actions())
}

#[tauri::command]
pub fn plugin_install(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let manifests = state.manifests.lock().map_err(|e| {
        LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;

    let manifest = manifests
        .get(&plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?
        .clone();

    drop(manifests);

    let mut store = state.store.lock().map_err(|e| {
        LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;

    lifecycle::install(&mut store, &manifest)?;
    store.save(&state.state_path)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_enable(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let mut store = state.store.lock().map_err(|e| {
        LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;
    lifecycle::enable(&mut store, &plugin_id)?;
    store.save(&state.state_path)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_disable(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let mut store = state.store.lock().map_err(|e| {
        LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;
    lifecycle::disable(&mut store, &plugin_id)?;
    store.save(&state.state_path)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_uninstall(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let mut store = state.store.lock().map_err(|e| {
        LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;
    lifecycle::uninstall(&mut store, &plugin_id)?;
    store.save(&state.state_path)?;

    // Also remove from manifests cache
    let mut manifests = state.manifests.lock().map_err(|e| {
        LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;
    manifests.remove(&plugin_id);

    Ok(())
}

#[tauri::command]
pub fn plugin_approve_capabilities(
    plugin_id: String,
    capabilities: Vec<String>,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let manifests = state.manifests.lock().map_err(|e| {
        LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;
    let manifest = manifests
        .get(&plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?
        .clone();
    drop(manifests);

    let mut store = state.store.lock().map_err(|e| {
        LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;
    lifecycle::approve_capabilities(&mut store, &manifest, &capabilities)?;
    store.save(&state.state_path)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_revoke_capability(
    plugin_id: String,
    capability: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let mut store = state.store.lock().map_err(|e| {
        LifecycleError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    })?;
    lifecycle::revoke_capability(&mut store, &plugin_id, &capability)?;
    store.save(&state.state_path)?;
    Ok(())
}

#[tauri::command]
pub async fn plugin_install_from_git(
    url: String,
    branch: Option<String>,
    state: State<'_, PluginHostState>,
) -> Result<PluginInstallResult, GitInstallError> {
    let existing_ids: Vec<String> = {
        let store = state.store.lock().map_err(|e| {
            GitInstallError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })?;
        store.plugins.keys().cloned().collect()
    };

    let (manifest, final_dir, result) =
        git_install::install_from_git(&url, branch.as_deref(), &existing_ids).await?;

    // Register in manifests and plugin_dirs caches
    {
        let mut manifests = state.manifests.lock().map_err(|e| {
            GitInstallError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })?;
        manifests.insert(manifest.plugin_id.clone(), manifest.clone());
    }
    {
        let mut dirs = state.plugin_dirs.lock().map_err(|e| {
            GitInstallError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })?;
        dirs.insert(manifest.plugin_id.clone(), final_dir);
    }

    // Auto-install in lifecycle (sets status to Installed)
    {
        let mut store = state.store.lock().map_err(|e| {
            GitInstallError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })?;
        lifecycle::install(&mut store, &manifest).map_err(|e| {
            GitInstallError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })?;
        store.save(&state.state_path).map_err(GitInstallError::Io)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn plugin_update(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<PluginUpdateResult, GitInstallError> {
    let (plugin_dir, old_manifest) = {
        let dirs = state.plugin_dirs.lock().map_err(|e| {
            GitInstallError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })?;
        let dir = dirs
            .get(&plugin_id)
            .ok_or_else(|| {
                GitInstallError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("plugin dir not found: {plugin_id}"),
                ))
            })?
            .clone();

        let manifests = state.manifests.lock().map_err(|e| {
            GitInstallError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })?;
        let manifest = manifests
            .get(&plugin_id)
            .ok_or_else(|| {
                GitInstallError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("manifest not found: {plugin_id}"),
                ))
            })?
            .clone();

        (dir, manifest)
    };

    let (new_manifest, result) =
        git_install::update_plugin(&plugin_dir, &old_manifest).await?;

    // Update manifests cache
    {
        let mut manifests = state.manifests.lock().map_err(|e| {
            GitInstallError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        })?;
        manifests.insert(plugin_id.clone(), new_manifest);
    }

    Ok(result)
}

#[tauri::command]
pub fn plugin_panel_state(
    plugin_id: String,
    panel_id: String,
    state: State<'_, PluginHostState>,
) -> Result<Option<serde_json::Value>, String> {
    state
        .panel_relay
        .get_state(&plugin_id, &panel_id)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PendingUiEvent {
    pub plugin_id: String,
    pub panel_id: String,
    pub event_type: String,
    pub data: serde_json::Value,
}

#[tauri::command]
pub fn plugin_relay_ui_event(
    plugin_id: String,
    panel_id: String,
    event_type: String,
    data: serde_json::Value,
    state: State<'_, PluginHostState>,
) -> Result<(), String> {
    // Verify plugin owns this panel
    let manifests = state.manifests.lock().map_err(|e| e.to_string())?;
    if let Some(manifest) = manifests.get(&plugin_id) {
        let panel_ids: Vec<&str> = manifest.panels.iter().map(|p| p.id.as_str()).collect();
        if !panel_ids.contains(&panel_id.as_str()) {
            return Err(format!(
                "panel '{}' is not declared in plugin '{}' manifest",
                panel_id, plugin_id
            ));
        }
    } else {
        return Err(format!("plugin not found: {plugin_id}"));
    }
    drop(manifests);

    // Queue the UI event for delivery to the plugin process
    let mut pending = state.pending_ui_events.lock().map_err(|e| e.to_string())?;
    pending.push(PendingUiEvent {
        plugin_id,
        panel_id,
        event_type,
        data,
    });

    Ok(())
}
