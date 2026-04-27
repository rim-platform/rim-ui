pub mod backend_client;
pub mod broker;
pub mod capability;
pub mod commands;
pub mod discovery;
pub mod event_forwarder;
pub mod git_install;
pub mod handshake;
pub mod lifecycle;
pub mod manifest;
pub mod panel_registry;
pub mod panel_relay;
pub mod process;
pub mod simple_manifest;
pub mod state;
pub mod validation;
pub mod wire;

use commands::PendingUiEvent;
use manifest::PluginManifest;
use panel_registry::PanelRegistry;
use panel_relay::PanelRelay;
use state::{state_file_path, PluginStateStore};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct PluginHostState {
    pub store: Mutex<PluginStateStore>,
    pub manifests: Mutex<HashMap<String, PluginManifest>>,
    pub state_path: PathBuf,
    pub plugin_dirs: Mutex<HashMap<String, PathBuf>>,
    /// Shutdown senders for running plugin broker loops, keyed by plugin_id.
    #[allow(dead_code)]
    pub shutdown_txs: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
    pub panel_relay: PanelRelay,
    #[allow(dead_code)]
    pub panel_registry: PanelRegistry,
    pub pending_ui_events: Mutex<Vec<PendingUiEvent>>,
}

pub fn init(app_data_dir: &std::path::Path) -> PluginHostState {
    let state_path = state_file_path(app_data_dir);
    let store = PluginStateStore::load(&state_path);

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

    PluginHostState {
        store: Mutex::new(store),
        manifests: Mutex::new(manifests),
        state_path,
        plugin_dirs: Mutex::new(plugin_dirs),
        shutdown_txs: Mutex::new(HashMap::new()),
        panel_relay: PanelRelay::new(),
        panel_registry: PanelRegistry::new(),
        pending_ui_events: Mutex::new(Vec::new()),
    }
}
