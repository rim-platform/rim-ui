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
//! - The broker loop runs in a `tokio::spawn`ed task.  A `watch::Sender<bool>`
//!   is stored in `PluginHostState.shutdown_txs`; sending `true` signals the
//!   loop to exit.  The process itself is `kill_on_drop`, so if the task exits
//!   for any reason the OS process is also cleaned up.

use crate::plugin_host::broker::{BrokerConfig, PluginBroker};
use crate::plugin_host::capability::CapabilityGate;
use crate::plugin_host::manifest::PluginManifest;
use crate::plugin_host::process::PluginProcess;
use crate::plugin_host::PluginHostState;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use tokio::time::{timeout, Duration};

const STOP_TIMEOUT: Duration = Duration::from_millis(500);

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
        let txs = state.shutdown_txs.lock().map_err(|_| RuntimeError::LockPoisoned)?;
        if txs.contains_key(plugin_id) {
            return Err(RuntimeError::AlreadyRunning(plugin_id.to_string()));
        }
    }

    let plugin_dir: PathBuf = {
        let dirs = state.plugin_dirs.lock().map_err(|_| RuntimeError::LockPoisoned)?;
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

    let (_process, pipes) = PluginProcess::spawn(plugin_id, &plugin_dir, &manifest.entrypoint)?;

    let gate = CapabilityGate::new(approved_caps);
    let broker = PluginBroker::new(plugin_id.to_string(), gate, BrokerConfig::default())
        .with_panel_relay(state.panel_relay.clone(), panel_ids);

    let broker_mutex = Arc::new(Mutex::new(broker));
    let reader_mutex = Arc::new(Mutex::new(pipes.stdout));
    let writer_mutex = Arc::new(Mutex::new(pipes.stdin));

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let broker_clone = broker_mutex.clone();
    let reader_clone = reader_mutex.clone();
    let writer_clone = writer_mutex.clone();
    let pid_str = plugin_id.to_string();

    tokio::spawn(async move {
        log::info!("[plugin_host] broker loop starting for {}", pid_str);
        crate::plugin_host::broker::run_broker_loop(
            &broker_clone,
            &reader_clone,
            &writer_clone,
            shutdown_rx,
        )
        .await;
        log::info!("[plugin_host] broker loop exited for {}", pid_str);
    });

    {
        let mut txs = state.shutdown_txs.lock().map_err(|_| RuntimeError::LockPoisoned)?;
        txs.insert(plugin_id.to_string(), shutdown_tx);
    }

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
        let mut txs = state.shutdown_txs.lock().map_err(|_| RuntimeError::LockPoisoned)?;
        txs.remove(plugin_id)
    };

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
            shutdown_txs: std::sync::Mutex::new(HashMap::new()),
            panel_relay: std::sync::Arc::new(PanelRelay::new()),
            panel_registry: PanelRegistry::new(),
            pending_ui_events: std::sync::Mutex::new(Vec::new()),
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
            shutdown_txs: std::sync::Mutex::new(HashMap::new()),
            panel_relay: std::sync::Arc::new(PanelRelay::new()),
            panel_registry: PanelRegistry::new(),
            pending_ui_events: std::sync::Mutex::new(Vec::new()),
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
}
