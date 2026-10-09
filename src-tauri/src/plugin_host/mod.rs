pub mod broker;
pub mod bundle;
pub mod capability;
pub mod command_exec;
pub mod commands;
pub mod discovery;
pub mod git_install;
pub mod git_source;
pub mod handshake;
pub mod host_events;
pub mod lifecycle;
pub mod local_install;
pub mod manifest;
pub mod panel_relay;
pub mod plugin_protocol;
pub mod post_install;
pub mod process;
pub mod protocol;
pub mod runtime;
pub mod simple_manifest;
pub mod state;
pub mod storage;
pub mod validation;
pub mod wire;

use commands::PendingUiEvent;
use manifest::PluginManifest;
use panel_relay::PanelRelay;
use state::{state_file_path, PluginStateStore, PluginStatus};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct PluginHostState {
    pub store: Mutex<PluginStateStore>,
    pub manifests: Mutex<HashMap<String, PluginManifest>>,
    pub state_path: PathBuf,
    pub plugin_dirs: Mutex<HashMap<String, PathBuf>>,
    /// Shutdown senders for running plugin broker loops, keyed by plugin_id.
    /// Arc so a broker task can deregister itself when its plugin exits.
    pub shutdown_txs: Arc<Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>>,
    /// Request handles for plugins whose handshake succeeded, keyed by plugin_id.
    /// Arc so the broker task can deregister its own handle when the plugin exits.
    pub clients: Arc<Mutex<HashMap<String, broker::PluginClient>>>,
    /// Arc so the broker loop tasks can hold a shared reference after `start_plugin` returns.
    pub panel_relay: Arc<PanelRelay>,
    pub pending_ui_events: Mutex<Vec<PendingUiEvent>>,
    /// The signed-in user as plugins see it; the UI sets it on sign-in and sign-out.
    /// Arc so a broker task can read it when its plugin finishes the handshake.
    pub principal: Arc<Mutex<Option<protocol::Principal>>>,
    /// Provisional principal ids and the key-based ids that replaced them, as persisted in
    /// the state store; sent to every plugin after its handshake. Arc for the broker tasks.
    pub principal_ids: Arc<Mutex<Vec<protocol::PrincipalMapping>>>,
    /// OS process ids of running plugin processes, keyed by plugin_id, so app quit
    /// can kill any process that outlives its graceful shutdown.
    pub pids: Arc<Mutex<HashMap<String, u32>>>,
    /// Plugins starting and stopping, for the UI. Arc so broker tasks can publish.
    pub events: Arc<host_events::PluginEvents>,
    /// The stores `WebSandboxed` plugins keep through `rim.storage.*`.
    pub storage: storage::PluginStorage,
    /// The signed-in account's provisional principal id, which names its plugin
    /// stores; `None` when nobody is signed in.
    pub account: Mutex<Option<String>>,
}

pub fn init(app_data_dir: &std::path::Path) -> PluginHostState {
    let state_path = state_file_path(app_data_dir);
    let store = PluginStateStore::load(&state_path);
    let principal_ids = runtime::mappings_of(&store);

    let mut manifests = HashMap::new();
    let mut plugin_dirs = HashMap::new();
    let plugins_dir = discovery::plugins_dir();
    for result in discovery::discover_plugins(&plugins_dir) {
        match result {
            Ok(discovered) => {
                plugin_dirs.insert(discovered.manifest.plugin_id.clone(), discovered.plugin_dir);
                manifests.insert(discovered.manifest.plugin_id.clone(), discovered.manifest);
            }
            Err((path, err)) => {
                eprintln!(
                    "plugin_host: failed to load plugin at {}: {}",
                    path.display(),
                    err
                );
            }
        }
    }

    let plugin_host_state = PluginHostState {
        store: Mutex::new(store),
        manifests: Mutex::new(manifests),
        state_path,
        plugin_dirs: Mutex::new(plugin_dirs),
        shutdown_txs: Arc::new(Mutex::new(HashMap::new())),
        clients: Arc::new(Mutex::new(HashMap::new())),
        panel_relay: Arc::new(PanelRelay::new()),
        pending_ui_events: Mutex::new(Vec::new()),
        principal: Arc::new(Mutex::new(None)),
        principal_ids: Arc::new(Mutex::new(principal_ids)),
        pids: Arc::new(Mutex::new(HashMap::new())),
        events: Arc::new(host_events::PluginEvents::new()),
        storage: storage::PluginStorage::new(app_data_dir),
        account: Mutex::new(None),
    };

    // Re-spawn any plugins that were Enabled on last shutdown.
    // Collect (plugin_id, manifest) pairs first to avoid holding the lock
    // across the spawn calls.
    let to_spawn: Vec<(String, PluginManifest)> = {
        let store = plugin_host_state.store.lock().expect("plugin store lock");
        let manifests = plugin_host_state
            .manifests
            .lock()
            .expect("plugin manifests lock");
        store
            .plugins
            .iter()
            .filter(|(_, record)| record.status == PluginStatus::Enabled)
            .filter_map(|(id, _)| manifests.get(id).map(|m| (id.clone(), m.clone())))
            .collect()
    };

    for (plugin_id, manifest) in to_spawn {
        match runtime::start_plugin(&plugin_id, &manifest, &plugin_host_state) {
            Ok(()) => log::info!("[plugin_host] auto-started plugin {}", plugin_id),
            Err(e) => log::warn!(
                "[plugin_host] failed to auto-start plugin {}: {}",
                plugin_id,
                e
            ),
        }
    }

    plugin_host_state
}

/// UI event that carries a [`panel_relay::PanelStateChange`] each time a plugin
/// updates one of its panels.
pub const PANEL_STATE_EVENT: &str = "plugin-panel-state";

/// Push what the plugin host does to the UI: every panel state change as
/// [`PANEL_STATE_EVENT`], so an open panel shows a plugin's updates as they
/// happen, and plugins starting and stopping as [`host_events::PLUGIN_EVENT`].
/// Called once at app start; a panel that opens later asks for the stored state
/// with `plugin_panel_state`.
pub fn forward_to_ui<R: tauri::Runtime>(app: tauri::AppHandle<R>, state: &PluginHostState) {
    forward(
        app.clone(),
        state.panel_relay.subscribe(),
        PANEL_STATE_EVENT,
    );
    forward(app, state.events.subscribe(), host_events::PLUGIN_EVENT);
}

fn forward<R, T>(
    app: tauri::AppHandle<R>,
    mut rx: tokio::sync::broadcast::Receiver<T>,
    event: &'static str,
) where
    R: tauri::Runtime,
    T: serde::Serialize + Clone + Send + 'static,
{
    use tauri::Emitter;
    use tokio::sync::broadcast::error::RecvError;

    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(payload) => {
                    if let Err(e) = app.emit(event, &payload) {
                        log::warn!("[plugin_host] could not push {event}: {e}");
                    }
                }
                // A skipped panel state is older than the next one received; a
                // skipped start or stop only delays the UI's next list refresh.
                Err(RecvError::Lagged(skipped)) => {
                    log::debug!("[plugin_host] {event} forwarder skipped {skipped} events");
                }
                Err(RecvError::Closed) => break,
            }
        }
    });
}

#[cfg(test)]
impl PluginHostState {
    /// Empty host state with the given manifests installed, for tests.
    pub(crate) fn with_installed(manifests: Vec<PluginManifest>) -> Self {
        let mut store = PluginStateStore::default();
        for manifest in &manifests {
            lifecycle::install(&mut store, manifest).expect("install test manifest");
        }
        Self {
            store: Mutex::new(store),
            manifests: Mutex::new(
                manifests
                    .into_iter()
                    .map(|m| (m.plugin_id.clone(), m))
                    .collect(),
            ),
            state_path: PathBuf::from("/nonexistent/plugins.json"),
            plugin_dirs: Mutex::new(HashMap::new()),
            shutdown_txs: Arc::new(Mutex::new(HashMap::new())),
            clients: Arc::new(Mutex::new(HashMap::new())),
            panel_relay: Arc::new(PanelRelay::new()),
            pending_ui_events: Mutex::new(Vec::new()),
            principal: Arc::new(Mutex::new(None)),
            principal_ids: Arc::new(Mutex::new(Vec::new())),
            pids: Arc::new(Mutex::new(HashMap::new())),
            events: Arc::new(host_events::PluginEvents::new()),
            storage: storage::PluginStorage::new(std::path::Path::new("/nonexistent")),
            account: Mutex::new(None),
        }
    }
}
