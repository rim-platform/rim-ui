pub mod broker;
pub mod bundle;
pub mod bundle_fetch;
pub mod capability;
pub mod chat_relay;
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
pub mod registry;
pub mod runtime;
pub mod settings;
pub mod state;
pub mod storage;
pub mod trash;
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
    /// Arc so a broker task can read its plugin's settings schema.
    pub manifests: Arc<Mutex<HashMap<String, PluginManifest>>>,
    pub state_path: PathBuf,
    pub plugin_dirs: Mutex<HashMap<String, PathBuf>>,
    /// Shutdown senders for running plugin broker loops, keyed by plugin_id.
    /// Arc so a broker task can deregister itself when its plugin exits.
    pub shutdown_txs: Arc<Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>>,
    /// Request handles for plugins whose handshake succeeded, keyed by plugin_id.
    /// Arc so the broker task can deregister its own handle when the plugin exits.
    pub clients: Arc<Mutex<HashMap<String, broker::PluginClient>>>,
    /// Panel state per plugin and panel. Arc so the broker loop tasks can hold a
    /// shared reference after `start_plugin` returns.
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
    /// The values users save in each plugin's settings form. Arc so a broker
    /// task can read its plugin's settings.
    pub settings: Arc<settings::PluginSettings>,
    /// The signed-in account's provisional principal id, which names its plugin
    /// stores and settings; `None` when nobody is signed in. Arc for the broker
    /// tasks.
    pub account: Arc<Mutex<Option<String>>>,
    /// Local-process plugins' `rim.chat.*` calls on their way to the UI's message
    /// service. Arc for the broker tasks.
    pub chat_relay: Arc<chat_relay::ChatRelay>,
}

/// The plugin host: the installed plugins discovered and loaded, their state
/// read from the app data directory, the enabled ones started, and secret
/// settings kept in `vault`.
pub(crate) fn init(
    app_data_dir: &std::path::Path,
    vault: Arc<crate::secret_store::SecretVault>,
) -> PluginHostState {
    let state_path = state_file_path(app_data_dir);
    let store = PluginStateStore::load(&state_path);
    let principal_ids = runtime::mappings_of(&store);

    let mut manifests = HashMap::new();
    let mut plugin_dirs = HashMap::new();
    let plugins_dir = discovery::plugins_dir();
    // Copies an unfinished update set aside go back before discovery; then
    // what is left in the trash goes in the background.
    trash::recover_replaced(&plugins_dir);
    let swept = plugins_dir.clone();
    tauri::async_runtime::spawn_blocking(move || trash::sweep(&swept));
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
        manifests: Arc::new(Mutex::new(manifests)),
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
        settings: Arc::new(settings::PluginSettings::new(app_data_dir, vault)),
        account: Arc::new(Mutex::new(None)),
        chat_relay: Arc::new(chat_relay::ChatRelay::default()),
    };

    start_enabled_plugins(&plugin_host_state);

    plugin_host_state
}

/// Starts the plugins that were Enabled when the app last closed, and returns
/// the ids of those it tried to start.
///
/// Each plugin's bundle fingerprint is checked first, as enabling it does. A
/// plugin whose files changed since they were trusted is marked
/// `fingerprint_changed`, logged and not started; it keeps its Enabled status,
/// so trusting the new files starts it. A plugin whose files cannot be read is
/// started. A start that fails is logged.
pub(crate) fn start_enabled_plugins(state: &PluginHostState) -> Vec<String> {
    // Collect (plugin_id, manifest) pairs first to avoid holding the locks
    // across the spawn calls.
    let enabled: Vec<(String, PluginManifest)> = {
        let store = state.store.lock().expect("plugin store lock");
        let manifests = state.manifests.lock().expect("plugin manifests lock");
        store
            .plugins
            .iter()
            .filter(|(_, record)| record.status == PluginStatus::Enabled)
            .filter_map(|(id, _)| manifests.get(id).map(|m| (id.clone(), m.clone())))
            .collect()
    };

    let mut started = Vec::new();
    for (plugin_id, manifest) in enabled {
        if let Err(e) = commands::check_bundle_fingerprint(state, &plugin_id) {
            log::warn!("[plugin_host] not starting plugin {plugin_id}: {e}");
            continue;
        }
        match runtime::start_plugin(&plugin_id, &manifest, state) {
            Ok(()) => log::info!("[plugin_host] auto-started plugin {}", plugin_id),
            Err(e) => log::warn!(
                "[plugin_host] failed to auto-start plugin {}: {}",
                plugin_id,
                e
            ),
        }
        started.push(plugin_id);
    }
    started
}

/// UI event that carries a [`panel_relay::PanelStateChange`] each time a plugin
/// updates one of its panels.
pub const PANEL_STATE_EVENT: &str = "plugin-panel-state";

/// Pushes what the plugin host does to the UI: every panel state change as
/// [`PANEL_STATE_EVENT`], so an open panel shows a plugin's updates as they
/// happen, plugins starting and stopping as [`host_events::PLUGIN_EVENT`], and
/// local-process plugins' chat calls as [`chat_relay::PLUGIN_CHAT_EVENT`].
/// Called once at app start; a panel that opens later asks for the stored state
/// with `plugin_panel_state`.
pub fn forward_to_ui<R: tauri::Runtime>(app: tauri::AppHandle<R>, state: &PluginHostState) {
    forward(
        app.clone(),
        state.panel_relay.subscribe(),
        PANEL_STATE_EVENT,
    );
    forward(
        app.clone(),
        state.chat_relay.subscribe(),
        chat_relay::PLUGIN_CHAT_EVENT,
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
            manifests: Arc::new(Mutex::new(
                manifests
                    .into_iter()
                    .map(|m| (m.plugin_id.clone(), m))
                    .collect(),
            )),
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
            settings: Arc::new(settings::PluginSettings::in_memory(std::path::Path::new(
                "/nonexistent",
            ))),
            account: Arc::new(Mutex::new(None)),
            chat_relay: Arc::new(chat_relay::ChatRelay::default()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::process::test_plugins_dir;
    use crate::plugin_host::state::PluginRecord;
    use tempfile::TempDir;

    const ID: &str = "dev.example.test";

    /// A host with the Enabled local-process plugin [`ID`], whose folder in
    /// `tmp` holds a copy of `exits_on_sigterm.sh` and whose fingerprint is
    /// pinned as installing it does.
    fn enabled_plugin(tmp: &TempDir) -> PluginHostState {
        let manifest: PluginManifest = serde_json::from_value(serde_json::json!({
            "manifest_version": 1,
            "plugin_id": ID,
            "display_name": "Test",
            "version": "1.0.0",
            "description": "test",
            "author": null,
            "runtime_kind": "DesktopLocalProcess",
            "entrypoint": "exits_on_sigterm.sh",
        }))
        .unwrap();
        let dir = tmp.path().join(ID);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::copy(
            test_plugins_dir().join("exits_on_sigterm.sh"),
            dir.join("exits_on_sigterm.sh"),
        )
        .unwrap();
        let fingerprint = local_install::compute_bundle_fingerprint(&dir).unwrap();

        let mut state = PluginHostState::with_installed(vec![manifest]);
        state.state_path = state_file_path(tmp.path());
        state.plugin_dirs.lock().unwrap().insert(ID.into(), dir);
        {
            let mut store = state.store.lock().unwrap();
            lifecycle::enable(&mut store, ID).unwrap();
            let record = store.get(ID).unwrap().clone();
            store.upsert(PluginRecord {
                bundle_fingerprint: fingerprint,
                ..record
            });
        }
        state
    }

    fn running(state: &PluginHostState) -> bool {
        state.shutdown_txs.lock().unwrap().contains_key(ID)
    }

    fn record(state: &PluginHostState) -> PluginRecord {
        state.store.lock().unwrap().get(ID).unwrap().clone()
    }

    #[tokio::test]
    async fn an_unchanged_plugin_starts_at_launch() {
        let tmp = TempDir::new().unwrap();
        let state = enabled_plugin(&tmp);

        assert_eq!(start_enabled_plugins(&state), vec![ID.to_string()]);

        assert!(running(&state));
        assert!(!record(&state).fingerprint_changed);
        runtime::stop_plugin(ID, &state).await.unwrap();
    }

    #[tokio::test]
    async fn a_plugin_whose_files_changed_is_marked_and_not_started_at_launch() {
        let tmp = TempDir::new().unwrap();
        let state = enabled_plugin(&tmp);
        std::fs::write(tmp.path().join(ID).join("extra.js"), b"changed").unwrap();

        assert!(start_enabled_plugins(&state).is_empty());

        assert!(!running(&state));
        let record = record(&state);
        assert!(record.fingerprint_changed);
        assert_eq!(record.status, PluginStatus::Enabled);
        let saved = PluginStateStore::load(&state.state_path);
        assert!(saved.get(ID).unwrap().fingerprint_changed);
    }

    #[tokio::test]
    async fn a_plugin_whose_folder_cannot_be_read_is_started_and_not_marked() {
        let tmp = TempDir::new().unwrap();
        let state = enabled_plugin(&tmp);
        state
            .plugin_dirs
            .lock()
            .unwrap()
            .insert(ID.into(), tmp.path().join("missing"));

        assert_eq!(start_enabled_plugins(&state), vec![ID.to_string()]);

        assert!(!record(&state).fingerprint_changed);
    }

    #[tokio::test]
    async fn trusting_a_plugin_skipped_at_launch_starts_it() {
        let tmp = TempDir::new().unwrap();
        let state = enabled_plugin(&tmp);
        std::fs::write(tmp.path().join(ID).join("extra.js"), b"changed").unwrap();
        start_enabled_plugins(&state);

        commands::trust_fingerprint(&state, ID).unwrap();

        assert!(running(&state));
        let record = record(&state);
        assert!(!record.fingerprint_changed);
        assert_eq!(record.status, PluginStatus::Enabled);
        runtime::stop_plugin(ID, &state).await.unwrap();
    }

    #[tokio::test]
    async fn trusting_a_disabled_plugin_leaves_it_stopped() {
        let tmp = TempDir::new().unwrap();
        let state = enabled_plugin(&tmp);
        lifecycle::disable(&mut state.store.lock().unwrap(), ID).unwrap();
        std::fs::write(tmp.path().join(ID).join("extra.js"), b"changed").unwrap();

        commands::trust_fingerprint(&state, ID).unwrap();

        assert!(!running(&state));
        assert!(!record(&state).fingerprint_changed);
    }
}
