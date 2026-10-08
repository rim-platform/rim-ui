use crate::plugin_host::command_exec::{self, PluginCommandError, PluginCommandResult};
use crate::plugin_host::git_install::{
    self, GitInstallError, PluginInstallResult, PluginUpdateResult,
};
use crate::plugin_host::lifecycle::{self, LifecycleError};
use crate::plugin_host::local_install::{self, LocalInstallError};
use crate::plugin_host::manifest::{ContextAction, KeybindSuggestion, PanelDef};
use crate::plugin_host::runtime;
use crate::plugin_host::state::{PluginRecord, PluginStatus};
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
    /// True when the bundle fingerprint on disk differs from the TOFU fingerprint
    /// recorded at install time.  The UI must surface a warning and require the
    /// user to explicitly trust the new version before spawning.
    pub fingerprint_changed: bool,
    pub context_actions: Vec<ContextAction>,
    /// Panel definitions from the manifest — used by the shell for slot layout.
    pub panels: Vec<PanelDef>,
}

#[tauri::command]
pub fn plugin_list(state: State<'_, PluginHostState>) -> Result<Vec<PluginInfo>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let manifests = state.manifests.lock().map_err(|e| e.to_string())?;

    let dirs = state.plugin_dirs.lock().map_err(|e| e.to_string())?;

    let mut plugins = Vec::new();
    for (id, record) in &store.plugins {
        let manifest = manifests.get(id);
        let ai_consent_required = manifest
            .map(|m| lifecycle::check_ai_consent_required(&store, m).is_err())
            .unwrap_or(false);

        // Recompute bundle fingerprint from disk if we have a pinned fingerprint stored.
        // A mismatch means the bundle changed since install — surface FingerprintChanged.
        let fingerprint_changed = if !record.bundle_fingerprint.is_empty() {
            if let Some(plugin_dir) = dirs.get(id) {
                match local_install::compute_bundle_fingerprint(plugin_dir) {
                    Ok(current_fp) => current_fp != record.bundle_fingerprint,
                    Err(_) => false, // IO error — don't surface spurious warnings
                }
            } else {
                record.fingerprint_changed
            }
        } else {
            // No pinned fingerprint (e.g. installed before TOFU was added) — use stored flag.
            record.fingerprint_changed
        };

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
            fingerprint_changed,
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
    // Retrieve the manifest before taking the store lock so we can pass it to
    // runtime::start_plugin without holding both locks simultaneously.
    let manifest = {
        let manifests = state
            .manifests
            .lock()
            .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
        manifests
            .get(&plugin_id)
            .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?
            .clone()
    };

    // Fingerprint check — recompute and compare against the TOFU fingerprint.
    // If a mismatch is found, update the fingerprint_changed flag in the store and
    // return a FingerprintChanged error so the frontend can surface the warning.
    {
        let plugin_dir_opt = {
            let dirs = state
                .plugin_dirs
                .lock()
                .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
            dirs.get(&plugin_id).cloned()
        };

        if let Some(plugin_dir) = plugin_dir_opt {
            let stored_fingerprint = {
                let store = state
                    .store
                    .lock()
                    .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
                store
                    .get(&plugin_id)
                    .map(|r| r.bundle_fingerprint.clone())
                    .unwrap_or_default()
            };

            if !stored_fingerprint.is_empty() {
                match local_install::compute_bundle_fingerprint(&plugin_dir) {
                    Ok(current_fp) if current_fp != stored_fingerprint => {
                        // Fingerprint mismatch — mark in store and return error so UI warns.
                        let mut store = state.store.lock().map_err(|e| {
                            LifecycleError::Io(std::io::Error::other(e.to_string()))
                        })?;
                        if let Some(record) = store.get(&plugin_id).cloned() {
                            store.upsert(PluginRecord {
                                fingerprint_changed: true,
                                ..record
                            });
                            let _ = store.save(&state.state_path);
                        }
                        log::warn!(
                            "[AUDIT] event=plugin_fingerprint_changed plugin_id={} stored={} current={}",
                            plugin_id, stored_fingerprint, current_fp
                        );
                        return Err(LifecycleError::FingerprintChanged(plugin_id));
                    }
                    Ok(_) => {} // fingerprint matches — proceed
                    Err(e) => {
                        // IO error during fingerprint check — log but do not block enable.
                        log::warn!(
                            "[plugin_host] fingerprint check failed for {}: {}",
                            plugin_id,
                            e
                        );
                    }
                }
            }
        }
    }

    {
        let mut store = state
            .store
            .lock()
            .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
        lifecycle::enable(&mut store, &plugin_id)?;
        store.save(&state.state_path)?;
    }

    // Spawn the plugin process and connect the broker loop.
    // A non-fatal error here (e.g. entrypoint missing) is logged but does not
    // roll back the Enabled status — the user can retry or uninstall.
    match runtime::start_plugin(&plugin_id, &manifest, &state) {
        Ok(()) => {}
        Err(runtime::RuntimeError::AlreadyRunning(_)) => {
            // Idempotent — broker loop is already up (e.g. double-enable call).
        }
        Err(e) => {
            log::warn!(
                "[plugin_host] plugin_enable: failed to start plugin {}: {}",
                plugin_id,
                e
            );
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn plugin_disable(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    // Stop the broker loop before updating the lifecycle status so the process
    // is gone by the time we persist the Disabled state.
    runtime::stop_plugin(&plugin_id, &state)
        .await
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;

    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    lifecycle::disable(&mut store, &plugin_id)?;
    store.save(&state.state_path)?;
    Ok(())
}

#[tauri::command]
pub async fn plugin_uninstall(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    // Stop the broker loop unconditionally (no-op if not running).
    runtime::stop_plugin(&plugin_id, &state)
        .await
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;

    {
        let mut store = state
            .store
            .lock()
            .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
        lifecycle::uninstall(&mut store, &plugin_id)?;
        store.save(&state.state_path)?;
    }

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

/// Install a plugin from a git repository.
///
/// `url`/`branch` are validated before git runs (`INVALID_GIT_URL` /
/// `INVALID_GIT_BRANCH`). If the plugin needs dependency-install steps and
/// `allow_post_install` is not `true`, nothing is installed and the command
/// fails with `POST_INSTALL_CONSENT_REQUIRED` carrying the exact steps; the UI
/// asks the user and retries with `allow_post_install: true`.
#[tauri::command]
pub async fn plugin_install_from_git(
    url: String,
    branch: Option<String>,
    allow_post_install: Option<bool>,
    state: State<'_, PluginHostState>,
) -> Result<PluginInstallResult, GitInstallError> {
    let existing_ids: Vec<String> = {
        let store = state
            .store
            .lock()
            .map_err(|e| GitInstallError::Io(std::io::Error::other(e.to_string())))?;
        store.plugins.keys().cloned().collect()
    };

    let (manifest, final_dir, result) = git_install::install_from_git(
        &url,
        branch.as_deref(),
        &existing_ids,
        allow_post_install.unwrap_or(false),
    )
    .await?;

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

/// Update a git-installed plugin. Same consent contract as
/// [`plugin_install_from_git`]: without `allow_post_install: true`, an update
/// that needs npm/pip steps fails with `POST_INSTALL_CONSENT_REQUIRED` before
/// the working tree is advanced.
#[tauri::command]
pub async fn plugin_update(
    plugin_id: String,
    allow_post_install: Option<bool>,
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

    let (new_manifest, result) = git_install::update_plugin(
        &plugin_dir,
        &old_manifest,
        allow_post_install.unwrap_or(false),
    )
    .await?;

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

/// Run a plugin command from the palette, a keybind, a context menu or a panel.
///
/// The UI splits `plugin.<plugin_id>.<command>` ids naively; the host resolves
/// the pair against installed manifests (see [`command_exec::resolve_command`]).
/// A command whose manifest marks it `dangerous` only runs when the caller passes
/// `confirmed_dangerous: true` after the user confirmed it. A plugin panel's
/// request carries `caller_plugin_id`, and may only run that plugin's commands.
///
/// # Errors
///
/// [`PluginCommandError`] serialized as `{ kind, message, data? }`, e.g.
/// `PLUGIN_NOT_RUNNING`, `CONFIRMATION_REQUIRED`, `TIMED_OUT`, or `PLUGIN_ERROR`
/// when the plugin itself answered with a JSON-RPC error.
#[tauri::command]
pub async fn plugin_execute_command(
    plugin_id: String,
    command: String,
    args: Option<serde_json::Value>,
    confirmed_dangerous: Option<bool>,
    caller_plugin_id: Option<String>,
    state: State<'_, PluginHostState>,
) -> Result<PluginCommandResult, PluginCommandError> {
    let payload = command_exec::execute(
        &state,
        &plugin_id,
        &command,
        args.unwrap_or_else(|| serde_json::json!({})),
        confirmed_dangerous.unwrap_or(false),
        caller_plugin_id.as_deref(),
    )
    .await?;
    Ok(PluginCommandResult {
        status: "ok",
        payload,
    })
}

/// Invoke a plugin AI command on behalf of the LLM agent.
///
/// This is the **server-side security boundary** — the JS-side consent filter in
/// `loader.ts` is a UX optimisation only. This command re-checks:
/// 1. The command is in `approved_ai_commands` for this plugin.
/// 2. The manifest has not drifted since consent was granted (`check_ai_consent_required`).
///
/// If either check fails the invocation is rejected with a typed `LifecycleError`
/// before any message reaches the plugin process. Past the consent gates the
/// command takes the same path as [`plugin_execute_command`]. The agent cannot
/// confirm a `dangerous` command, so those are refused with `CONFIRMATION_REQUIRED`.
/// Returns the plugin's result payload.
#[tauri::command]
pub async fn plugin_run_ai_command(
    plugin_id: String,
    command_id: String,
    input: serde_json::Value,
    state: State<'_, PluginHostState>,
) -> Result<serde_json::Value, PluginCommandError> {
    check_ai_consent(&state, &plugin_id, &command_id)?;

    log::warn!(
        "[AUDIT] event=plugin_ai_invocation plugin_id={} command_id={}",
        plugin_id,
        command_id
    );

    // Consent was checked for `plugin_id`, so the command must resolve to that
    // same plugin; the id re-split in `resolve_command` may not move it elsewhere.
    command_exec::execute(
        &state,
        &plugin_id,
        &command_id,
        input,
        false,
        Some(&plugin_id),
    )
    .await
}

/// AI consent gates for [`plugin_run_ai_command`].
fn check_ai_consent(
    state: &PluginHostState,
    plugin_id: &str,
    command_id: &str,
) -> Result<(), LifecycleError> {
    let manifests = state
        .manifests
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    let manifest = manifests
        .get(plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.to_string()))?
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
        .get(plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.to_string()))?;
    if !record.approved_ai_commands.iter().any(|c| c == command_id) {
        log::warn!(
            "[AUDIT] event=plugin_ai_invocation_denied plugin_id={} command_id={} reason=not_approved",
            plugin_id,
            command_id
        );
        return Err(LifecycleError::UnknownAiCommand(command_id.to_string()));
    }
    Ok(())
}

/// Install a plugin from a local folder on disk.
///
/// Mirrors the shape of [`plugin_install_from_git`] but copies rather than
/// cloning.  The source folder must contain a `rim-plugin.json` (or a
/// simple-mode entrypoint with a `# rim-plugin:` header).
///
/// Steps executed (see [`local_install::install_from_local`] for full detail):
/// 1. Path-traversal guard (per-segment + canonicalize prefix assertion).
/// 2. Manifest detection and structural validation.
/// 3. N1 + F2 security validation.
/// 4. Reserved-prefix check.
/// 5. Collision check against already-installed plugin IDs.
/// 6. TOFU bundle fingerprint computation.
/// 7. Recursive copy into `~/.rim/plugins/<plugin_id>/`.
/// 8. Lifecycle registration as `Installed` (user enables explicitly).
///
/// Returns a [`PluginInstallResult`] so the UI can refresh the plugin list.
///
/// # Errors
///
/// Returns [`LocalInstallError`] variants serialised as
/// `{ kind: "LOCAL_INSTALL_ERROR", message }` or
/// `{ kind: "INVALID_MANIFEST", data: { kind: … } }`.
#[tauri::command]
pub async fn plugin_install_from_local(
    path: String,
    state: State<'_, PluginHostState>,
) -> Result<PluginInstallResult, LocalInstallError> {
    let source_path = std::path::PathBuf::from(&path);

    let existing_ids: Vec<String> = {
        let store = state
            .store
            .lock()
            .map_err(|e| LocalInstallError::Io(std::io::Error::other(e.to_string())))?;
        store.plugins.keys().cloned().collect()
    };

    let (manifest, final_dir, result, bundle_fingerprint) =
        local_install::install_from_local(&source_path, &existing_ids).await?;

    // Register in manifests and plugin_dirs caches.
    {
        let mut manifests = state
            .manifests
            .lock()
            .map_err(|e| LocalInstallError::Io(std::io::Error::other(e.to_string())))?;
        manifests.insert(manifest.plugin_id.clone(), manifest.clone());
    }
    {
        let mut dirs = state
            .plugin_dirs
            .lock()
            .map_err(|e| LocalInstallError::Io(std::io::Error::other(e.to_string())))?;
        dirs.insert(manifest.plugin_id.clone(), final_dir);
    }

    // Auto-install in lifecycle (sets status to Installed) and persist TOFU fingerprint.
    {
        let mut store = state
            .store
            .lock()
            .map_err(|e| LocalInstallError::Io(std::io::Error::other(e.to_string())))?;
        lifecycle::install(&mut store, &manifest).map_err(|e| match e {
            lifecycle::LifecycleError::InvalidManifest(v) => LocalInstallError::InvalidManifest(v),
            other => LocalInstallError::LifecycleFailure(other.to_string()),
        })?;

        // Update the record to include the TOFU bundle fingerprint.
        if let Some(record) = store.get(&manifest.plugin_id).cloned() {
            store.upsert(crate::plugin_host::state::PluginRecord {
                bundle_fingerprint,
                fingerprint_changed: false,
                ..record
            });
        }
        store
            .save(&state.state_path)
            .map_err(LocalInstallError::Io)?;
    }

    Ok(result)
}

/// Accept the new bundle fingerprint for a plugin whose fingerprint has changed.
///
/// This is the "Trust new version" action in the UI.  It:
/// 1. Recomputes the current on-disk fingerprint.
/// 2. Persists it as the new TOFU baseline.
/// 3. Clears the `fingerprint_changed` flag.
///
/// The plugin is NOT automatically enabled — the user must enable it separately.
///
/// # Errors
///
/// - `LifecycleError::NotFound` — plugin is not registered.
/// - `LifecycleError::Io` — fingerprint recomputation or state persistence failed.
#[tauri::command]
pub fn plugin_trust_fingerprint(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let plugin_dir = {
        let dirs = state
            .plugin_dirs
            .lock()
            .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
        dirs.get(&plugin_id)
            .cloned()
            .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?
    };

    let new_fingerprint =
        local_install::compute_bundle_fingerprint(&plugin_dir).map_err(LifecycleError::Io)?;

    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;

    let record = store
        .get(&plugin_id)
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?
        .clone();

    log::warn!(
        "[AUDIT] event=plugin_fingerprint_trusted plugin_id={} old={} new={}",
        plugin_id,
        record.bundle_fingerprint,
        new_fingerprint
    );

    store.upsert(PluginRecord {
        bundle_fingerprint: new_fingerprint,
        fingerprint_changed: false,
        ..record
    });
    store.save(&state.state_path)?;

    Ok(())
}
