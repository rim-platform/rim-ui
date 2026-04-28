use crate::plugin_host::git_install::{
    self, GitInstallError, PluginInstallResult, PluginUpdateResult,
};
use crate::plugin_host::lifecycle::{self, LifecycleError};
use crate::plugin_host::manifest::{ContextAction, KeybindSuggestion, PanelDef};
use crate::plugin_host::state::PluginStatus;
use crate::plugin_host::PluginHostState;
use serde::Serialize;
use tauri::{Emitter, State};

#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub plugin_id: String,
    /// Mirror of the manifest's `plugin_id` field — identical to `plugin_id` for
    /// well-formed plugins, exposed separately so the TS shape can reference it
    /// without re-deriving it from the runtime record.
    pub manifest_id: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    pub status: PluginStatus,
    /// Derived server-side — do NOT recompute in TypeScript.
    pub enabled: bool,
    pub capabilities: Vec<String>,
    pub approved_capabilities: Vec<String>,
    pub approved_ai_commands: Vec<String>,
    /// The subset of manifest commands that are flagged `ai_callable: true`.
    /// Populated from the manifest at list-time so JS never needs to fish into
    /// a nested manifest shape.
    pub ai_callable_commands: Vec<String>,
    /// True when the manifest changed since last consent — UI must prompt re-approval.
    pub ai_consent_required: bool,
    pub context_actions: Vec<ContextAction>,
    /// Panel definitions from the manifest — used by the shell for slot layout.
    pub panels: Vec<PanelDef>,
}

#[tauri::command]
pub fn plugin_list(state: State<'_, PluginHostState>) -> Result<Vec<PluginInfo>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let manifests = state.manifests.lock().map_err(|e| e.to_string())?;

    let mut plugins = Vec::new();
    for (id, record) in &store.plugins {
        let manifest = manifests.get(id);
        let ai_consent_required = manifest
            .map(|m| lifecycle::check_ai_consent_required(&store, m).is_err())
            .unwrap_or(false);
        plugins.push(PluginInfo {
            plugin_id: id.clone(),
            manifest_id: id.clone(),
            display_name: manifest
                .map(|m| m.display_name.clone())
                .unwrap_or_else(|| id.clone()),
            version: manifest
                .map(|m| m.version.clone())
                .unwrap_or_else(|| "unknown".into()),
            description: manifest.map(|m| m.description.clone()).unwrap_or_default(),
            author: manifest.and_then(|m| m.author.clone()),
            status: record.status,
            enabled: matches!(record.status, PluginStatus::Enabled),
            capabilities: manifest.map(|m| m.capabilities.clone()).unwrap_or_default(),
            approved_capabilities: record.approved_capabilities.clone(),
            approved_ai_commands: record.approved_ai_commands.clone(),
            ai_callable_commands: manifest
                .map(|m| m.ai_callable_command_ids())
                .unwrap_or_default(),
            ai_consent_required,
            context_actions: manifest
                .map(|m| m.qualified_context_actions())
                .unwrap_or_default(),
            panels: manifest.map(|m| m.panels.clone()).unwrap_or_default(),
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
    let manifests = state
        .manifests
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;

    let manifest = manifests
        .get(&plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?
        .clone();

    drop(manifests);

    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;

    lifecycle::install(&mut store, &manifest)?;
    store.save(&state.state_path)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_enable(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    lifecycle::enable(&mut store, &plugin_id)?;
    store.save(&state.state_path)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_disable(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    lifecycle::disable(&mut store, &plugin_id)?;
    store.save(&state.state_path)?;
    Ok(())
}

#[tauri::command]
pub fn plugin_uninstall(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    lifecycle::uninstall(&mut store, &plugin_id)?;
    store.save(&state.state_path)?;

    // Also remove from manifests cache
    let mut manifests = state
        .manifests
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    manifests.remove(&plugin_id);

    Ok(())
}

#[tauri::command]
pub fn plugin_approve_capabilities(
    plugin_id: String,
    capabilities: Vec<String>,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let manifests = state
        .manifests
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    let manifest = manifests
        .get(&plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?
        .clone();
    drop(manifests);

    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
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
    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
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
        let store = state
            .store
            .lock()
            .map_err(|e| GitInstallError::Io(std::io::Error::other(e.to_string())))?;
        store.plugins.keys().cloned().collect()
    };

    let (manifest, final_dir, result) =
        git_install::install_from_git(&url, branch.as_deref(), &existing_ids).await?;

    // Register in manifests and plugin_dirs caches
    {
        let mut manifests = state
            .manifests
            .lock()
            .map_err(|e| GitInstallError::Io(std::io::Error::other(e.to_string())))?;
        manifests.insert(manifest.plugin_id.clone(), manifest.clone());
    }
    {
        let mut dirs = state
            .plugin_dirs
            .lock()
            .map_err(|e| GitInstallError::Io(std::io::Error::other(e.to_string())))?;
        dirs.insert(manifest.plugin_id.clone(), final_dir);
    }

    // Auto-install in lifecycle (sets status to Installed)
    {
        let mut store = state
            .store
            .lock()
            .map_err(|e| GitInstallError::Io(std::io::Error::other(e.to_string())))?;
        lifecycle::install(&mut store, &manifest).map_err(|e| match e {
            // Surface InvalidManifest typed so JS can distinguish N1/F2 rejection
            // from a generic lifecycle or IO failure.
            lifecycle::LifecycleError::InvalidManifest(v) => GitInstallError::InvalidManifest(v),
            other => GitInstallError::LifecycleFailure(other.to_string()),
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
        let dirs = state
            .plugin_dirs
            .lock()
            .map_err(|e| GitInstallError::Io(std::io::Error::other(e.to_string())))?;
        let dir = dirs
            .get(&plugin_id)
            .ok_or_else(|| {
                GitInstallError::Io(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("plugin dir not found: {plugin_id}"),
                ))
            })?
            .clone();

        let manifests = state
            .manifests
            .lock()
            .map_err(|e| GitInstallError::Io(std::io::Error::other(e.to_string())))?;
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

    let (new_manifest, result) = git_install::update_plugin(&plugin_dir, &old_manifest).await?;

    // Update manifests cache
    {
        let mut manifests = state
            .manifests
            .lock()
            .map_err(|e| GitInstallError::Io(std::io::Error::other(e.to_string())))?;
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

#[derive(Debug, Clone, Serialize)]
struct AiConsentChangedPayload {
    plugin_id: String,
    action: String,
}

#[tauri::command]
pub fn plugin_approve_ai_commands(
    plugin_id: String,
    command_ids: Vec<String>,
    state: State<'_, PluginHostState>,
    app: tauri::AppHandle,
) -> Result<(), LifecycleError> {
    let manifests = state
        .manifests
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    let manifest = manifests
        .get(&plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?
        .clone();
    drop(manifests);

    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    lifecycle::approve_ai_commands(&mut store, &manifest, &command_ids)?;
    store.save(&state.state_path)?;
    drop(store);

    let _ = app.emit(
        "plugin-ai-consent-changed",
        &AiConsentChangedPayload {
            plugin_id: plugin_id.clone(),
            action: "granted".into(),
        },
    );
    Ok(())
}

#[tauri::command]
pub fn plugin_revoke_ai_consent(
    plugin_id: String,
    command_id: String,
    state: State<'_, PluginHostState>,
    app: tauri::AppHandle,
) -> Result<(), LifecycleError> {
    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    lifecycle::revoke_ai_command(&mut store, &plugin_id, &command_id)?;
    log::warn!(
        "[AUDIT] event=plugin_ai_consent_revoked plugin_id={} command_id={}",
        plugin_id,
        command_id
    );
    store.save(&state.state_path)?;
    drop(store);

    let _ = app.emit(
        "plugin-ai-consent-changed",
        &AiConsentChangedPayload {
            plugin_id: plugin_id.clone(),
            action: "revoked".into(),
        },
    );
    Ok(())
}

/// Invoke a plugin AI command on behalf of the LLM agent.
///
/// This is the **server-side security boundary** — the JS-side consent filter in
/// `loader.ts` is a UX optimisation only. This command re-checks:
/// 1. The command is in `approved_ai_commands` for this plugin.
/// 2. The manifest has not drifted since consent was granted (`check_ai_consent_required`).
///
/// If either check fails the invocation is rejected with a typed `LifecycleError`
/// before any message reaches the plugin process.
///
/// NOTE: actual IPC dispatch to the plugin process is not yet implemented — the
/// plugin process broker loop wiring is tracked separately. Until that lands this
/// command passes the consent gate and returns a `PluginNotRunning` error so the
/// agent can surface a human-readable failure rather than a generic "command not found".
#[tauri::command]
pub fn plugin_run_ai_command(
    plugin_id: String,
    command_id: String,
    _input: serde_json::Value,
    state: State<'_, PluginHostState>,
) -> Result<serde_json::Value, LifecycleError> {
    let manifests = state
        .manifests
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    let manifest = manifests
        .get(&plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?
        .clone();
    drop(manifests);

    let store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;

    // Gate 1: manifest must not have drifted since consent was granted.
    lifecycle::check_ai_consent_required(&store, &manifest)?;

    // Gate 2: the specific command must be in the approved set.
    let record = store
        .get(&plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?;
    if !record.approved_ai_commands.contains(&command_id) {
        log::warn!(
            "[AUDIT] event=plugin_ai_invocation_denied plugin_id={} command_id={} reason=not_approved",
            plugin_id,
            command_id
        );
        return Err(LifecycleError::UnknownAiCommand(command_id));
    }
    drop(store);

    log::warn!(
        "[AUDIT] event=plugin_ai_invocation plugin_id={} command_id={}",
        plugin_id,
        command_id
    );

    // Plugin process IPC dispatch is not yet wired — broker loop integration is
    // tracked separately. Return a typed error so the agent runtime surfaces a
    // clear message instead of "command not found".
    Err(LifecycleError::PluginNotRunning(plugin_id))
}
