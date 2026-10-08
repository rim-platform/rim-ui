//! Plugin runtime orchestration — spawn-on-enable lifecycle.
//!
//! This module is the **Tauri-aware boundary** between the plugin lifecycle and
//! the Tauri-free modules that do the actual work (`process.rs`, `broker.rs`).
//! Nothing below this layer touches `tauri::State`; everything above this
//! layer (commands, `mod.rs` init) goes through these two public functions.
//!
//! ## Lifecycle
//!
//! - `start_plugin` is called by `plugin_enable` (user action) and by the
//!   startup sweep in `mod.rs::init` (re-spawns plugins that were Enabled on
//!   last shutdown).
//! - `stop_plugin` is called by `plugin_disable` and `plugin_uninstall`.
//! - `stop_all` is called when the app exits.
//! - The broker loop runs in a `tokio::spawn`ed task.  A `watch::Sender<bool>`
//!   is stored in `PluginHostState.shutdown_txs`; sending `true` makes the loop
//!   send `rim.shutdown` and close the plugin's stdin, after which the task
//!   waits for the process, then terminates and finally kills it
//!   ([`PluginProcess::shutdown`]).  The process is also `kill_on_drop`, so if
//!   the task is dropped the OS process is cleaned up.  App exit skips
//!   destructors, which is why `stop_all` kills by pid whatever is still
//!   running when its deadline passes.

use crate::plugin_host::broker::{
    run_broker_loop, BrokerConfig, PluginBroker, PluginClient, RequestError,
};
use crate::plugin_host::capability::CapabilityGate;
use crate::plugin_host::handshake::{self, HandshakeError};
use crate::plugin_host::manifest::PluginManifest;
use crate::plugin_host::process::{self, PluginProcess};
use crate::plugin_host::protocol::{method, Principal, PrincipalChangedParams};
use crate::plugin_host::PluginHostState;
use std::path::PathBuf;
use tokio::sync::watch;
use tokio::time::{timeout, Duration, Instant};

const STOP_TIMEOUT: Duration = Duration::from_millis(500);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// How long app exit waits for plugin processes before killing them.
/// Covers the full graceful sequence in [`PluginProcess::shutdown`].
const QUIT_TIMEOUT: Duration = Duration::from_secs(4);
/// How long one plugin's full outbound queue may hold up a principal change.
const NOTIFY_TIMEOUT: Duration = Duration::from_secs(1);

/// Error type for runtime spawn / stop operations.
#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("plugin dir not found for plugin: {0}")]
    DirNotFound(String),
    #[error("plugin process error: {0}")]
    Process(#[from] crate::plugin_host::process::ProcessError),
    #[error("plugin is already running: {0}")]
    AlreadyRunning(String),
    #[error("state lock poisoned")]
    LockPoisoned,
}

/// Spawns a plugin process and connects the broker loop, then registers the
/// shutdown sender in `state.shutdown_txs`.
///
/// Idempotent: if a shutdown sender already exists for this plugin_id the
/// call returns `Err(RuntimeError::AlreadyRunning)` without spawning a second
/// process.
///
/// # Errors
///
/// - `DirNotFound` — the plugin's directory was not found in `plugin_dirs`.
/// - `Process` — `PluginProcess::spawn` failed (e.g. entrypoint missing).
/// - `AlreadyRunning` — a broker loop is already registered for this plugin.
/// - `LockPoisoned` — a mutex was poisoned (rare, unrecoverable).
///
/// # Examples
///
/// ```rust,ignore
/// // Inside a Tauri command:
/// let manifest = { state.manifests.lock().unwrap().get(&plugin_id).cloned() };
/// if let Some(manifest) = manifest {
///     plugin_host::runtime::start_plugin(&plugin_id, &manifest, &state)?;
/// }
/// ```
pub fn start_plugin(
    plugin_id: &str,
    manifest: &PluginManifest,
    state: &PluginHostState,
) -> Result<(), RuntimeError> {
    // Idempotency guard — do not spawn a second process.
    {
        let txs = state
            .shutdown_txs
            .lock()
            .map_err(|_| RuntimeError::LockPoisoned)?;
        if txs.contains_key(plugin_id) {
            return Err(RuntimeError::AlreadyRunning(plugin_id.to_string()));
        }
    }

    let plugin_dir: PathBuf = {
        let dirs = state
            .plugin_dirs
            .lock()
            .map_err(|_| RuntimeError::LockPoisoned)?;
        dirs.get(plugin_id)
            .ok_or_else(|| RuntimeError::DirNotFound(plugin_id.to_string()))?
            .clone()
    };

    let approved_caps: Vec<String> = {
        let store = state.store.lock().map_err(|_| RuntimeError::LockPoisoned)?;
        store
            .get(plugin_id)
            .map(|r| r.approved_capabilities.clone())
            .unwrap_or_default()
    };

    let panel_ids: Vec<String> = manifest.panels.iter().map(|p| p.id.clone()).collect();

    // Tauri runs sync commands (`plugin_enable`) and the setup hook (the startup
    // sweep in `mod.rs::init`) on the main thread, outside any Tokio runtime.
    // `tokio::process` and `tokio::spawn` below both panic there, so enter
    // Tauri's runtime when the caller is not already on one.
    let tauri_runtime = tokio::runtime::Handle::try_current()
        .is_err()
        .then(tauri::async_runtime::handle);
    let _runtime_guard = tauri_runtime.as_ref().map(|rt| rt.inner().enter());

    let (mut process, pipes) = PluginProcess::spawn(plugin_id, &plugin_dir, &manifest.entrypoint)?;

    let gate = CapabilityGate::new(approved_caps.clone());
    let broker = PluginBroker::new(plugin_id.to_string(), gate, BrokerConfig::default())
        .with_panel_relay(state.panel_relay.clone(), panel_ids);

    let (client, outbound_rx) = PluginClient::channel();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let clients = state.clients.clone();
    let shutdown_txs = state.shutdown_txs.clone();
    let principal = state.principal.clone();
    let pids = state.pids.clone();
    let own_shutdown_tx = shutdown_tx.clone();
    let pid_str = plugin_id.to_string();

    // Registered before the task starts so a plugin that exits at once still
    // finds its own entry to remove below.
    {
        let mut txs = state
            .shutdown_txs
            .lock()
            .map_err(|_| RuntimeError::LockPoisoned)?;
        txs.insert(plugin_id.to_string(), shutdown_tx);
    }
    // Recorded last, so no early return can leave a pid behind for `stop_all` to kill.
    let pid = process.pid();
    if let (Some(pid), Ok(mut pids)) = (pid, state.pids.lock()) {
        pids.insert(plugin_id.to_string(), pid);
    }

    tokio::spawn(async move {
        log::info!("[plugin_host] broker loop starting for {}", pid_str);
        let broker_loop =
            run_broker_loop(broker, pipes.stdout, pipes.stdin, outbound_rx, shutdown_rx);
        tokio::pin!(broker_loop);

        // The handshake travels through the running loop, so log lines or calls the
        // plugin sends before answering are brokered rather than misread as the reply.
        let sent_principal = principal.lock().ok().and_then(|p| p.clone());
        let handshake =
            handshake_through(&client, &pid_str, &approved_caps, sent_principal.clone());
        let handshake_ok = tokio::select! {
            _ = &mut broker_loop => {
                log::warn!("[plugin_host] plugin {} exited before the handshake", pid_str);
                false
            }
            result = handshake => match result {
                Ok(()) => true,
                Err(e) => {
                    log::warn!("[plugin_host] handshake failed for {}: {}", pid_str, e);
                    false
                }
            },
        };

        if handshake_ok {
            if let Ok(mut map) = clients.lock() {
                map.insert(pid_str.clone(), client.clone());
            }
            // A sign-in or sign-out during the handshake reached every client but this one.
            let current = principal.lock().ok().and_then(|p| p.clone());
            if current != sent_principal {
                let _ = notify_principal(&client, current).await;
            }
            broker_loop.await;
            if let Ok(mut map) = clients.lock() {
                // A restart may already have registered a newer connection.
                if map
                    .get(&pid_str)
                    .is_some_and(|c| c.same_connection(&client))
                {
                    map.remove(&pid_str);
                }
            }
        }

        // Deregister so a crashed plugin (or one that failed the handshake) can be
        // started again; stop_plugin or a restart may already have replaced the entry.
        if let Ok(mut txs) = shutdown_txs.lock() {
            if txs
                .get(&pid_str)
                .is_some_and(|tx| tx.same_channel(&own_shutdown_tx))
            {
                txs.remove(&pid_str);
            }
        }

        log::info!("[plugin_host] broker loop exited for {}", pid_str);
        if let Err(e) = process.shutdown().await {
            log::warn!("[plugin_host] shutdown of {} failed: {}", pid_str, e);
        }
        if let Ok(mut pids) = pids.lock() {
            // A restart may already have registered a newer process.
            if pid.is_some() && pids.get(&pid_str) == pid.as_ref() {
                pids.remove(&pid_str);
            }
        }
    });

    log::info!("[plugin_host] plugin {} started", plugin_id);
    Ok(())
}

/// Signals the broker loop to shut down and waits up to [`STOP_TIMEOUT`].
///
/// Falls back to a drop (kill_on_drop takes effect) if the timeout expires.
/// Always removes the shutdown sender from `state.shutdown_txs`.
///
/// # Errors
///
/// - `LockPoisoned` — a mutex was poisoned.
///
/// # Examples
///
/// ```rust,ignore
/// plugin_host::runtime::stop_plugin(&plugin_id, &state).await?;
/// ```
pub async fn stop_plugin(plugin_id: &str, state: &PluginHostState) -> Result<(), RuntimeError> {
    let maybe_tx: Option<watch::Sender<bool>> = {
        let mut txs = state
            .shutdown_txs
            .lock()
            .map_err(|_| RuntimeError::LockPoisoned)?;
        txs.remove(plugin_id)
    };

    // Commands fail fast from here on instead of queueing on a closing connection.
    if let Ok(mut clients) = state.clients.lock() {
        clients.remove(plugin_id);
    }

    if let Some(tx) = maybe_tx {
        // Signal shutdown — the broker loop will observe the watch channel.
        let _ = tx.send(true);

        // Give the broker task a moment to notice and exit cleanly.
        // `tx` being dropped here closes the channel; the receiver will see
        // `changed()` resolve.  We wait a short period then fall through —
        // kill_on_drop on the child process ensures OS-level cleanup.
        timeout(STOP_TIMEOUT, tx.closed()).await.ok();

        log::info!("[plugin_host] plugin {} stopped", plugin_id);
    } else {
        log::debug!("[plugin_host] stop_plugin: {} was not running", plugin_id);
    }

    Ok(())
}

/// Stop every running plugin, for app exit.
///
/// Each plugin gets `rim.shutdown` and a closed stdin at once, then
/// [`PluginProcess::shutdown`] terminates the stragglers. Whatever is still
/// running after [`QUIT_TIMEOUT`] is killed by pid, because the process exits
/// right after this returns and runs no destructors.
pub async fn stop_all(state: &PluginHostState) {
    stop_all_within(state, QUIT_TIMEOUT).await
}

async fn stop_all_within(state: &PluginHostState, wait: Duration) {
    let txs: Vec<(String, watch::Sender<bool>)> = match state.shutdown_txs.lock() {
        Ok(mut txs) => txs.drain().collect(),
        Err(_) => Vec::new(),
    };
    if let Ok(mut clients) = state.clients.lock() {
        clients.clear();
    }
    for (plugin_id, tx) in &txs {
        log::info!("[plugin_host] stopping plugin {} for app exit", plugin_id);
        let _ = tx.send(true);
    }

    let deadline = Instant::now() + wait;
    loop {
        let running = state.pids.lock().map(|p| p.len()).unwrap_or(0);
        if running == 0 || Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let stragglers: Vec<(String, u32)> = match state.pids.lock() {
        Ok(mut pids) => pids.drain().collect(),
        Err(_) => Vec::new(),
    };
    for (plugin_id, pid) in stragglers {
        log::warn!(
            "[plugin_host] plugin {} (pid {}) outlived app exit, killing it",
            plugin_id,
            pid
        );
        process::force_kill(pid);
    }
}

/// Record who is signed in and tell every running plugin when that changes.
pub async fn set_principal(state: &PluginHostState, principal: Option<Principal>) {
    let changed = match state.principal.lock() {
        Ok(mut current) => {
            let changed = *current != principal;
            *current = principal.clone();
            changed
        }
        Err(_) => false,
    };
    if !changed {
        return;
    }
    let clients: Vec<PluginClient> = match state.clients.lock() {
        Ok(clients) => clients.values().cloned().collect(),
        Err(_) => Vec::new(),
    };
    for client in clients {
        // A plugin that just exited has nothing left to tell.
        let _ = notify_principal(&client, principal.clone()).await;
    }
}

/// Send `rim.principal.changed` to one plugin.
async fn notify_principal(
    client: &PluginClient,
    principal: Option<Principal>,
) -> Result<(), RequestError> {
    let params = serde_json::to_value(PrincipalChangedParams { principal })
        .unwrap_or(serde_json::Value::Null);
    timeout(
        NOTIFY_TIMEOUT,
        client.notify(method::PRINCIPAL_CHANGED, Some(params)),
    )
    .await
    .unwrap_or(Err(RequestError::TimedOut(NOTIFY_TIMEOUT)))
}

/// Send `rim.handshake` through the broker loop and validate the plugin's answer.
async fn handshake_through(
    client: &PluginClient,
    plugin_id: &str,
    granted_capabilities: &[String],
    principal: Option<Principal>,
) -> Result<(), HandshakeError> {
    let params = handshake::handshake_params(plugin_id, granted_capabilities, principal)?;
    let result = client
        .request(handshake::HANDSHAKE_METHOD, Some(params), HANDSHAKE_TIMEOUT)
        .await
        .map_err(|e| HandshakeError::Rejected(e.to_string()))?;
    handshake::validate_handshake_result(result, plugin_id)?;
    Ok(())
}

// ─── Spawner trait for testability ───────────────────────────────────────────

/// Abstracts over `PluginProcess::spawn` so tests can inject a fake.
///
/// In production the `RealSpawner` impl delegates directly to `PluginProcess::spawn`.
/// Test code can implement `Spawner` with a fake that succeeds without touching
/// the filesystem.
// The trait and its production impl are not yet threaded through `start_plugin`.
// Wiring deferred to a future phase — leave the dead-code allowance rather than
// plumbing it through before it has callers.
#[allow(dead_code)]
pub trait Spawner: Send + Sync {
    /// Spawn the plugin and return its IO pipes.
    fn spawn(
        &self,
        plugin_id: &str,
        plugin_dir: &std::path::Path,
        entrypoint: &str,
    ) -> Result<crate::plugin_host::process::PluginPipes, crate::plugin_host::process::ProcessError>;
}

/// Production spawner: thin wrapper over `PluginProcess::spawn`.
#[allow(dead_code)]
pub struct RealSpawner;

impl Spawner for RealSpawner {
    fn spawn(
        &self,
        plugin_id: &str,
        plugin_dir: &std::path::Path,
        entrypoint: &str,
    ) -> Result<crate::plugin_host::process::PluginPipes, crate::plugin_host::process::ProcessError>
    {
        PluginProcess::spawn(plugin_id, plugin_dir, entrypoint).map(|(_proc, pipes)| pipes)
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::manifest::{PluginManifest, RuntimeKind};
    use crate::plugin_host::panel_registry::PanelRegistry;
    use crate::plugin_host::panel_relay::PanelRelay;
    use crate::plugin_host::state::{state_file_path, PluginStateStore};
    use crate::plugin_host::PluginHostState;
    use std::collections::HashMap;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    fn test_manifest(plugin_id: &str, entrypoint: &str) -> PluginManifest {
        PluginManifest {
            manifest_version: 1,
            plugin_id: plugin_id.into(),
            display_name: "Test".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: entrypoint.into(),
            capabilities: vec![],
            commands: vec![],
            keybind_suggestions: vec![],
            context_actions: vec![],
            panels: vec![],
            settings_schema: vec![],
        }
    }

    fn make_state(tmp: &TempDir, plugin_id: &str, plugin_dir: &std::path::Path) -> PluginHostState {
        let state_path = state_file_path(tmp.path());
        let mut dirs = HashMap::new();
        dirs.insert(plugin_id.to_string(), plugin_dir.to_path_buf());
        PluginHostState {
            store: std::sync::Mutex::new(PluginStateStore::default()),
            manifests: std::sync::Mutex::new(HashMap::new()),
            state_path,
            plugin_dirs: std::sync::Mutex::new(dirs),
            shutdown_txs: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
            clients: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
            panel_relay: std::sync::Arc::new(PanelRelay::new()),
            panel_registry: PanelRegistry::new(),
            pending_ui_events: std::sync::Mutex::new(Vec::new()),
            principal: std::sync::Arc::new(std::sync::Mutex::new(None)),
            pids: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    fn write_script(dir: &std::path::Path, name: &str, content: &str) {
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[tokio::test]
    async fn start_plugin_registers_shutdown_tx() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        // A long-running plugin script that speaks a stub broker protocol
        write_script(
            &plugin_dir,
            "main.sh",
            "#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 1; done\n",
        );

        let state = make_state(&tmp, "dev.example.test", &plugin_dir);
        let manifest = test_manifest("dev.example.test", "main.sh");

        start_plugin("dev.example.test", &manifest, &state).unwrap();

        let txs = state.shutdown_txs.lock().unwrap();
        assert!(
            txs.contains_key("dev.example.test"),
            "shutdown_tx must be registered after start_plugin"
        );
    }

    #[tokio::test]
    async fn start_plugin_idempotent_returns_error_on_double_call() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        write_script(
            &plugin_dir,
            "main.sh",
            "#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 1; done\n",
        );

        let state = make_state(&tmp, "dev.example.test", &plugin_dir);
        let manifest = test_manifest("dev.example.test", "main.sh");

        start_plugin("dev.example.test", &manifest, &state).unwrap();
        let err = start_plugin("dev.example.test", &manifest, &state).unwrap_err();
        assert!(
            matches!(err, RuntimeError::AlreadyRunning(_)),
            "double start must be AlreadyRunning, got: {err:?}"
        );
    }

    #[tokio::test]
    async fn stop_plugin_removes_shutdown_tx() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        write_script(
            &plugin_dir,
            "main.sh",
            "#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 1; done\n",
        );

        let state = make_state(&tmp, "dev.example.test", &plugin_dir);
        let manifest = test_manifest("dev.example.test", "main.sh");

        start_plugin("dev.example.test", &manifest, &state).unwrap();
        stop_plugin("dev.example.test", &state).await.unwrap();

        let txs = state.shutdown_txs.lock().unwrap();
        assert!(
            !txs.contains_key("dev.example.test"),
            "shutdown_tx must be removed after stop_plugin"
        );
    }

    #[tokio::test]
    async fn stop_plugin_no_op_for_not_running() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();

        let state = make_state(&tmp, "dev.example.test", &plugin_dir);

        // No start_plugin called — stop must succeed silently.
        stop_plugin("dev.example.test", &state).await.unwrap();
    }

    #[tokio::test]
    async fn start_plugin_dir_not_found_returns_error() {
        let tmp = TempDir::new().unwrap();
        // plugin_dirs is empty — no entry for "dev.example.test"
        let state_path = state_file_path(tmp.path());
        let state = PluginHostState {
            store: std::sync::Mutex::new(PluginStateStore::default()),
            manifests: std::sync::Mutex::new(HashMap::new()),
            state_path,
            plugin_dirs: std::sync::Mutex::new(HashMap::new()),
            shutdown_txs: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
            clients: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
            panel_relay: std::sync::Arc::new(PanelRelay::new()),
            panel_registry: PanelRegistry::new(),
            pending_ui_events: std::sync::Mutex::new(Vec::new()),
            principal: std::sync::Arc::new(std::sync::Mutex::new(None)),
            pids: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
        };
        let manifest = test_manifest("dev.example.test", "main.sh");
        let err = start_plugin("dev.example.test", &manifest, &state).unwrap_err();
        assert!(
            matches!(err, RuntimeError::DirNotFound(_)),
            "missing dir must be DirNotFound: {err:?}"
        );
    }

    #[tokio::test]
    async fn start_plugin_entrypoint_not_found_returns_process_error() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        // No "main.sh" written — entrypoint is missing.

        let state = make_state(&tmp, "dev.example.test", &plugin_dir);
        let manifest = test_manifest("dev.example.test", "main.sh");

        let err = start_plugin("dev.example.test", &manifest, &state).unwrap_err();
        assert!(
            matches!(err, RuntimeError::Process(_)),
            "missing entrypoint must yield Process error: {err:?}"
        );
    }

    async fn wait_for_client(state: &PluginHostState, plugin_id: &str) -> bool {
        for _ in 0..250 {
            if state.clients.lock().unwrap().contains_key(plugin_id) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }

    #[tokio::test]
    async fn hello_world_greet_runs_end_to_end() {
        if std::process::Command::new("python3")
            .arg("--version")
            .output()
            .is_err()
        {
            eprintln!("skipping: python3 is not installed");
            return;
        }
        let plugin_dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins/hello-world");
        let manifest = PluginManifest::load(&plugin_dir.join("rim-plugin.json")).unwrap();
        let plugin_id = manifest.plugin_id.clone();

        let tmp = TempDir::new().unwrap();
        let state = make_state(&tmp, &plugin_id, &plugin_dir);
        crate::plugin_host::lifecycle::install(&mut state.store.lock().unwrap(), &manifest)
            .unwrap();
        state
            .manifests
            .lock()
            .unwrap()
            .insert(plugin_id.clone(), manifest.clone());

        start_plugin(&plugin_id, &manifest, &state).unwrap();
        assert!(
            wait_for_client(&state, &plugin_id).await,
            "hello-world must complete the handshake and stay running"
        );

        // The palette's naive split of `plugin.dev.example.hello-world.greet`.
        let result = crate::plugin_host::command_exec::execute(
            &state,
            "dev",
            "example.hello-world.greet",
            serde_json::json!({"name": "RIM"}),
            false,
            None,
            crate::plugin_host::protocol::Initiator::User,
        )
        .await
        .unwrap();
        assert_eq!(result.payload, serde_json::json!("Hello, RIM!"));

        stop_plugin(&plugin_id, &state).await.unwrap();
        assert!(!state.clients.lock().unwrap().contains_key(&plugin_id));
    }

    #[tokio::test]
    async fn stop_all_stops_running_plugins_for_app_exit() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        // Exits once its stdin closes, as a v1 plugin must.
        write_script(&plugin_dir, "main.sh", "#!/bin/sh\ncat >/dev/null\n");

        let state = make_state(&tmp, "dev.example.test", &plugin_dir);
        let manifest = test_manifest("dev.example.test", "main.sh");
        start_plugin("dev.example.test", &manifest, &state).unwrap();
        assert!(state.pids.lock().unwrap().contains_key("dev.example.test"));

        stop_all(&state).await;
        assert!(state.pids.lock().unwrap().is_empty());
        assert!(state.shutdown_txs.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn stop_all_kills_a_plugin_that_outlives_the_deadline() {
        let tmp = TempDir::new().unwrap();
        let state = make_state(&tmp, "dev.example.test", tmp.path());
        // A process no broker task will stop: only the pid fallback can.
        let mut stubborn = std::process::Command::new("sh")
            .args(["-c", "trap '' TERM; while true; do sleep 1; done"])
            .spawn()
            .unwrap();
        state
            .pids
            .lock()
            .unwrap()
            .insert("dev.example.test".into(), stubborn.id());

        stop_all_within(&state, Duration::from_millis(50)).await;
        let status = stubborn.wait().unwrap();
        assert!(!status.success(), "killed, not exited: {status:?}");
        assert!(state.pids.lock().unwrap().is_empty());
    }

    /// `plugin_enable` is a sync Tauri command and the startup sweep runs in the
    /// setup hook: both call `start_plugin` on the main thread, with no Tokio
    /// runtime entered.
    #[test]
    fn start_plugin_works_outside_a_tokio_runtime() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        write_script(&plugin_dir, "main.sh", "#!/bin/sh\nexit 0\n");

        let state = make_state(&tmp, "dev.example.test", &plugin_dir);
        let manifest = test_manifest("dev.example.test", "main.sh");
        start_plugin("dev.example.test", &manifest, &state).unwrap();
    }

    #[tokio::test]
    async fn plugin_without_handshake_never_accepts_commands() {
        let tmp = TempDir::new().unwrap();
        let plugin_dir = tmp.path().join("dev.example.test");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        write_script(&plugin_dir, "main.sh", "#!/bin/sh\nexit 0\n");

        let state = make_state(&tmp, "dev.example.test", &plugin_dir);
        let manifest = test_manifest("dev.example.test", "main.sh");
        start_plugin("dev.example.test", &manifest, &state).unwrap();

        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!state
            .clients
            .lock()
            .unwrap()
            .contains_key("dev.example.test"));
    }
}
