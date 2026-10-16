use crate::plugin_host::bundle::{self, BundleError};
use crate::plugin_host::command_exec::{self, PluginCommandError, PluginCommandResult};
use crate::plugin_host::git_install::{
    self, GitInstallError, PluginInstallResult, PluginUpdateResult,
};
use crate::plugin_host::lifecycle::{self, LifecycleError};
use crate::plugin_host::local_install::{self, LocalInstallError};
use crate::plugin_host::manifest::{
    CommandInfo, ContextAction, KeybindSuggestion, PanelDef, RuntimeKind,
};
use crate::plugin_host::protocol::{Initiator, Principal, PrincipalMapping};
use crate::plugin_host::registry;
use crate::plugin_host::runtime;
use crate::plugin_host::state::{InstallSource, PluginAudit, PluginRecord, PluginStatus};
use crate::plugin_host::storage::StorageError;
use crate::plugin_host::validation::validate_plugin_manifest_for_host;
use crate::plugin_host::wire::JsonRpcError;
use crate::plugin_host::PluginHostState;
use base64::{engine::general_purpose::STANDARD, Engine};
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
    /// Every manifest command, for the command palette, the keybind picker and
    /// the agent's tool definitions.
    pub commands: Vec<CommandInfo>,
    /// `running` once the plugin process finished its handshake, else `stopped`.
    /// A `WebSandboxed` plugin runs in the UI, which knows its health.
    pub health: &'static str,
    /// How the plugin runs: a local process, or sandboxed in the app's frames.
    pub runtime_kind: RuntimeKind,
    /// Origins a `WebSandboxed` plugin may reach with `network.fetch`.
    pub network_origins: Vec<String>,
    /// Where the plugin was installed from, when known.
    pub source: Option<InstallSource>,
    /// The app died while starting this `WebSandboxed` plugin, so it waits for the
    /// user to enable it again.
    pub starting: bool,
    /// When each capability was given and revoked, and the encrypted messages the
    /// plugin read per day.
    pub audit: PluginAudit,
}

#[tauri::command]
pub fn plugin_list(state: State<'_, PluginHostState>) -> Result<Vec<PluginInfo>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let manifests = state.manifests.lock().map_err(|e| e.to_string())?;

    let dirs = state.plugin_dirs.lock().map_err(|e| e.to_string())?;
    let clients = state.clients.lock().map_err(|e| e.to_string())?;

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
            commands: manifest.map(|m| m.command_infos()).unwrap_or_default(),
            health: if clients.contains_key(id) {
                "running"
            } else {
                "stopped"
            },
            runtime_kind: manifest
                .map(|m| m.runtime_kind)
                .unwrap_or(RuntimeKind::DesktopLocalProcess),
            network_origins: manifest
                .and_then(|m| m.network_origins.clone())
                .unwrap_or_default(),
            source: record.source.clone(),
            starting: record.starting,
            audit: store.audit.get(id).cloned().unwrap_or_default(),
        });
    }
    Ok(plugins)
}

/// A manifest's keybind suggestion, with the plugin it came from.
#[derive(Debug, Clone, Serialize)]
pub struct PluginKeybindSuggestion {
    pub plugin_id: String,
    #[serde(flatten)]
    pub suggestion: KeybindSuggestion,
}

/// Keybind suggestions with qualified command ids, for one plugin or, without
/// `plugin_id`, for every installed plugin.
#[tauri::command]
pub fn plugin_suggested_keybinds(
    plugin_id: Option<String>,
    state: State<'_, PluginHostState>,
) -> Result<Vec<PluginKeybindSuggestion>, String> {
    let manifests = state.manifests.lock().map_err(|e| e.to_string())?;
    if let Some(id) = &plugin_id {
        if !manifests.contains_key(id) {
            return Err(format!("plugin not found: {id}"));
        }
    }
    Ok(manifests
        .values()
        .filter(|m| plugin_id.as_ref().is_none_or(|id| *id == m.plugin_id))
        .flat_map(|m| {
            m.qualified_keybind_suggestions()
                .into_iter()
                .map(|suggestion| PluginKeybindSuggestion {
                    plugin_id: m.plugin_id.clone(),
                    suggestion,
                })
        })
        .collect())
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

    if let Err(e) = state.storage.remove_plugin(&plugin_id) {
        log::warn!("[plugin_host] could not delete the storage of {plugin_id}: {e}");
    }
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
pub async fn plugin_revoke_capability(
    plugin_id: String,
    capability: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    revoke_capability_and_stop(&state, &plugin_id, &capability).await?;
    let store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    store.save(&state.state_path)?;
    Ok(())
}

/// Revoke a capability, stopping the plugin first if it is running.
///
/// Revoking disables the plugin (`lifecycle::revoke_capability`). The process
/// has to stop as well: its broker checks the plugin's own calls against the
/// capabilities approved when it started, so a process left running would keep
/// using the revoked capability until it restarted.
pub(crate) async fn revoke_capability_and_stop(
    state: &PluginHostState,
    plugin_id: &str,
    capability: &str,
) -> Result<(), LifecycleError> {
    runtime::stop_plugin(plugin_id, state)
        .await
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    lifecycle::revoke_capability(&mut store, plugin_id, capability)
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
    forbidden_origins: Option<Vec<String>>,
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
        &forbidden_origins.unwrap_or_default(),
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
        if let Some(record) = store.get(&manifest.plugin_id).cloned() {
            store.upsert(PluginRecord {
                source: Some(InstallSource::Git { url: url.clone() }),
                ..record
            });
        }
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
    let result = command_exec::execute(
        &state,
        &plugin_id,
        &command,
        args.unwrap_or_else(|| serde_json::json!({})),
        confirmed_dangerous.unwrap_or(false),
        caller_plugin_id.as_deref(),
        Initiator::User,
    )
    .await?;
    Ok(result.into())
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
    let result = command_exec::execute(
        &state,
        &plugin_id,
        &command_id,
        input,
        false,
        Some(&plugin_id),
        Initiator::Agent,
    )
    .await?;
    Ok(result.payload)
}

/// The signed-in user, as the UI reports it to the plugin host.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedInUser {
    pub user_id: String,
    pub display_name: String,
    /// The account's key-based principal id (`User.principalId`), once it enrolled a key.
    #[serde(default)]
    pub principal_id: Option<String>,
}

impl SignedInUser {
    /// The principal plugins see: the key-based id once there is one, else the provisional
    /// id derived from the account id.
    fn principal(&self) -> Principal {
        match self.key_principal_id() {
            Some(id) => Principal {
                principal_id: id.to_string(),
                display_name: self.display_name.clone(),
            },
            None => Principal::provisional(&self.user_id, &self.display_name),
        }
    }

    fn key_principal_id(&self) -> Option<&str> {
        self.principal_id
            .as_deref()
            .filter(|id| crate::plugin_host::protocol::is_key_principal_id(id))
    }
}

/// Tell the plugin host who is signed in (`None` after sign-out).
///
/// The account id never leaves the host: plugins get the derived
/// [`Principal`] in the handshake, in every `rim.command.execute`, and in a
/// `rim.principal.changed` notification sent to each running plugin whenever
/// the principal changes.
///
/// When the account has a key-based id, the host records once that its provisional id
/// became that id, and tells every plugin with `rim.principals.remapped` (after the
/// `rim.principal.changed` carrying the new id).
#[tauri::command]
pub async fn plugin_set_principal(
    user: Option<SignedInUser>,
    state: State<'_, PluginHostState>,
) -> Result<(), String> {
    let switched = user.as_ref().is_some_and(|u| {
        u.key_principal_id().is_some_and(|to| {
            let from = Principal::provisional(&u.user_id, &u.display_name).principal_id;
            runtime::record_principal_switch(&state, &from, to)
        })
    });
    if let Ok(mut account) = state.account.lock() {
        *account = user
            .as_ref()
            .map(|u| Principal::provisional(&u.user_id, &u.display_name).principal_id);
    }
    runtime::set_principal(&state, user.as_ref().map(SignedInUser::principal)).await;
    if switched {
        runtime::announce_remapped(&state).await;
    }
    Ok(())
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
    forbidden_origins: Option<Vec<String>>,
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

    let (manifest, final_dir, result, bundle_fingerprint) = local_install::install_from_local(
        &source_path,
        &existing_ids,
        &forbidden_origins.unwrap_or_default(),
    )
    .await?;

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
                source: Some(InstallSource::Local),
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

/// Install a `.rimbundle` the UI fetched (from a pasted link, or a registry
/// entry it verified): check its hash, read it, validate its manifest for this
/// host, then unpack it into the plugins directory and record its fingerprint.
///
/// `bundle` is the file's bytes in standard base64 and `sha256` the hash the
/// link or entry names; `manifest`, when given, is the signed manifest the
/// bundle's `rim-plugin.json` must equal byte for byte. With `replace`, an
/// installed plugin of the same id is stopped and replaced by a fresh install
/// that the user approves again, unless `keep_approvals` carries its approvals
/// and running state over (an update that asks for nothing new).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn plugin_install_bundle(
    bundle: String,
    sha256: String,
    source: InstallSource,
    replace: Option<bool>,
    manifest: Option<String>,
    keep_approvals: Option<bool>,
    forbidden_origins: Option<Vec<String>>,
    state: State<'_, PluginHostState>,
) -> Result<PluginInstallResult, LocalInstallError> {
    let io = |e: String| LocalInstallError::Io(std::io::Error::other(e));
    match &source {
        InstallSource::Link { url, sha256: named } => {
            if !url.starts_with("https://") || named != &sha256 {
                return Err(io(
                    "a link install needs an https:// link naming this hash".into()
                ));
            }
        }
        InstallSource::Registry { .. } => {}
        InstallSource::Local | InstallSource::Git { .. } => {
            return Err(io("local and git installs do not come as bundles".into()));
        }
    }
    let bytes = STANDARD
        .decode(bundle.as_bytes())
        .map_err(|e| io(format!("bundle is not base64: {e}")))?;
    let actual = bundle::bundle_sha256(&bytes);
    if actual != sha256 {
        return Err(BundleError::HashMismatch {
            expected: sha256,
            actual,
        }
        .into());
    }
    let read = bundle::read_bundle(&bytes)?;
    if manifest.is_some_and(|signed| signed != read.manifest_text) {
        return Err(io(
            "the bundle's rim-plugin.json is not the signed manifest".into(),
        ));
    }
    let manifest = read.manifest.clone();
    if manifest.has_reserved_prefix() {
        return Err(io(format!(
            "reserved plugin_id prefix: {}",
            manifest.plugin_id
        )));
    }
    validate_plugin_manifest_for_host(&manifest, &forbidden_origins.unwrap_or_default())?;

    let previous = state
        .store
        .lock()
        .map_err(|e| io(e.to_string()))?
        .get(&manifest.plugin_id)
        .cloned();
    if previous.is_some() {
        if replace != Some(true) {
            return Err(LocalInstallError::AlreadyExists(manifest.plugin_id.clone()));
        }
        runtime::stop_plugin(&manifest.plugin_id, &state)
            .await
            .map_err(|e| io(e.to_string()))?;
    }

    let final_dir = bundle::unpack(&read, &crate::plugin_host::discovery::plugins_dir(), true)?;
    let fingerprint = local_install::compute_bundle_fingerprint(&final_dir)?;
    let previous = previous.filter(|_| keep_approvals == Some(true));
    registry::record_install(
        &state,
        &manifest,
        final_dir.clone(),
        source,
        fingerprint,
        previous.as_ref(),
    )
    .map_err(|e| io(e.to_string()))?;
    log::warn!(
        "[AUDIT] event=plugin_bundle_installed plugin_id={} sha256={}",
        manifest.plugin_id,
        bundle::bundle_sha256(&bytes)
    );
    Ok(PluginInstallResult {
        plugin_id: manifest.plugin_id.clone(),
        display_name: manifest.display_name.clone(),
        version: manifest.version.clone(),
        capabilities: manifest.capabilities.clone(),
        install_path: final_dir.display().to_string(),
    })
}

/// A `WebSandboxed` plugin's files, for the UI to hand to its frames.
#[derive(Debug, Clone, Serialize)]
pub struct WebPluginFiles {
    /// The exact text of `rim-plugin.json`.
    pub manifest: String,
    pub files: Vec<WebPluginFile>,
}

/// One file of [`WebPluginFiles`]: its bundle path and its bytes in base64.
#[derive(Debug, Clone, Serialize)]
pub struct WebPluginFile {
    pub path: String,
    pub base64: String,
}

/// Read an installed `WebSandboxed` plugin's bundle files (the manifest, the
/// entrypoint and `panels/`, nothing else of its folder) after checking its
/// fingerprint against the one recorded at install, as enabling a process does,
/// and the bundle rules.
#[tauri::command]
pub fn plugin_web_files(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<WebPluginFiles, LifecycleError> {
    let lock = |e: String| LifecycleError::Io(std::io::Error::other(e));
    let manifest = state
        .manifests
        .lock()
        .map_err(|e| lock(e.to_string()))?
        .get(&plugin_id)
        .cloned()
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?;
    if manifest.runtime_kind != RuntimeKind::WebSandboxed {
        return Err(LifecycleError::Bundle(format!(
            "{plugin_id} is not a WebSandboxed plugin"
        )));
    }
    let dir = state
        .plugin_dirs
        .lock()
        .map_err(|e| lock(e.to_string()))?
        .get(&plugin_id)
        .cloned()
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?;
    let stored = state
        .store
        .lock()
        .map_err(|e| lock(e.to_string()))?
        .get(&plugin_id)
        .map(|r| r.bundle_fingerprint.clone())
        .unwrap_or_default();
    if !stored.is_empty() && local_install::compute_bundle_fingerprint(&dir)? != stored {
        let mut store = state.store.lock().map_err(|e| lock(e.to_string()))?;
        if let Some(record) = store.get(&plugin_id).cloned() {
            store.upsert(PluginRecord {
                fingerprint_changed: true,
                ..record
            });
            let _ = store.save(&state.state_path);
        }
        log::warn!("[AUDIT] event=plugin_fingerprint_changed plugin_id={plugin_id}");
        return Err(LifecycleError::FingerprintChanged(plugin_id));
    }
    let read = bundle::check_dir(&dir).map_err(|e| LifecycleError::Bundle(e.to_string()))?;
    if read.manifest.plugin_id != plugin_id {
        return Err(LifecycleError::Bundle(format!(
            "the folder of {plugin_id} holds {}",
            read.manifest.plugin_id
        )));
    }
    Ok(WebPluginFiles {
        manifest: read.manifest_text,
        files: read
            .files
            .into_iter()
            .map(|f| WebPluginFile {
                path: f.path,
                base64: STANDARD.encode(&f.bytes),
            })
            .collect(),
    })
}

/// Set or clear the marker the UI keeps while it starts a `WebSandboxed` plugin.
#[tauri::command]
pub fn plugin_set_starting(
    plugin_id: String,
    starting: bool,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    let record = store
        .get(&plugin_id)
        .cloned()
        .ok_or_else(|| LifecycleError::NotFound(plugin_id.clone()))?;
    store.upsert(PluginRecord { starting, ..record });
    store.save(&state.state_path)?;
    Ok(())
}

/// The installed plugin `plugin_id`, or `INVALID_PARAMS` for a storage call.
fn storage_plugin(state: &PluginHostState, plugin_id: &str) -> Result<(), StorageError> {
    let known = state
        .store
        .lock()
        .map(|store| store.get(plugin_id).is_some())
        .unwrap_or(false);
    if known {
        Ok(())
    } else {
        Err(StorageError::Io(std::io::Error::other(format!(
            "plugin not found: {plugin_id}"
        ))))
    }
}

fn signed_in_account(state: &PluginHostState) -> Option<String> {
    state.account.lock().ok().and_then(|a| a.clone())
}

/// `rim.storage.get` for a `WebSandboxed` plugin: the value stored under `key`
/// for the signed-in account, or `null`.
#[tauri::command]
pub fn plugin_storage_get(
    plugin_id: String,
    key: String,
    state: State<'_, PluginHostState>,
) -> Result<serde_json::Value, StorageError> {
    storage_plugin(&state, &plugin_id)?;
    state
        .storage
        .get(&plugin_id, signed_in_account(&state).as_deref(), &key)
}

/// `rim.storage.set` for a `WebSandboxed` plugin; `value: null` deletes the key.
#[tauri::command]
pub fn plugin_storage_set(
    plugin_id: String,
    key: String,
    value: serde_json::Value,
    state: State<'_, PluginHostState>,
) -> Result<(), StorageError> {
    storage_plugin(&state, &plugin_id)?;
    state.storage.set(
        &plugin_id,
        signed_in_account(&state).as_deref(),
        &key,
        value,
    )
}

/// Every provisional principal id this device has seen switch to a key-based id,
/// for the plugins the UI runs.
#[tauri::command]
pub fn plugin_principal_mappings(
    state: State<'_, PluginHostState>,
) -> Result<Vec<PrincipalMapping>, String> {
    state
        .principal_ids
        .lock()
        .map(|ids| ids.clone())
        .map_err(|e| e.to_string())
}

/// The AI consent gates of [`plugin_run_ai_command`], for a `WebSandboxed`
/// plugin's command, which the UI then runs itself.
#[tauri::command]
pub fn plugin_check_ai_consent(
    plugin_id: String,
    command_id: String,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    check_ai_consent(&state, &plugin_id, &command_id)
}

/// The UI's message service answers a local-process plugin's `rim.chat.*` call:
/// `result`, or the JSON-RPC `error` the plugin gets. False when the call no
/// longer waits (it timed out).
#[tauri::command]
pub fn plugin_chat_respond(
    request_id: u64,
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
    state: State<'_, PluginHostState>,
) -> bool {
    let reply = match error {
        Some(error) => Err(error),
        None => Ok(result.unwrap_or(serde_json::Value::Null)),
    };
    state.chat_relay.respond(request_id, reply)
}

/// Count `count` encrypted messages the message service gave `plugin_id` today.
#[tauri::command]
pub fn plugin_record_encrypted_reads(
    plugin_id: String,
    count: u64,
    state: State<'_, PluginHostState>,
) -> Result<(), LifecycleError> {
    let mut store = state
        .store
        .lock()
        .map_err(|e| LifecycleError::Io(std::io::Error::other(e.to_string())))?;
    if store.get(&plugin_id).is_none() {
        return Err(LifecycleError::NotFound(plugin_id));
    }
    store.record_encrypted_reads(&plugin_id, count, chrono::Utc::now());
    store.save(&state.state_path)?;
    Ok(())
}
