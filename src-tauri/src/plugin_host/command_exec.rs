//! Host → plugin command execution.
//!
//! Both `plugin_execute_command` (palette, keybinds, panels) and
//! `plugin_run_ai_command` (the agent, after its consent gates) end here:
//! resolve the command against the installed manifest, apply the host-side
//! gates, then send `rim.command.execute` to the running plugin process
//! through its broker loop and wait for the plugin's result.
//!
//! Nothing here touches `tauri::State`, so the gates and the dispatch are
//! testable against a plain [`PluginHostState`].

use crate::plugin_host::broker::{PluginClient, RequestError};
use crate::plugin_host::lifecycle::LifecycleError;
use crate::plugin_host::manifest::{ManifestCommand, PluginManifest};
use crate::plugin_host::protocol::{method, CommandExecuteParams, CommandResult, Initiator};
use crate::plugin_host::PluginHostState;
use std::collections::HashMap;
use std::time::Duration;

/// JSON-RPC method the host sends to run one of the plugin's manifest commands.
///
/// Params are [`CommandExecuteParams`]; the plugin answers with a
/// [`CommandResult`], or a JSON-RPC `error` that fails the command with the
/// plugin's code and message.
pub const EXECUTE_METHOD: &str = method::COMMAND_EXECUTE;

/// How long a plugin may take to answer a command before the host gives up.
pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// Typed failure of a plugin command, serialized as `{ kind, message, data? }`.
#[derive(Debug, thiserror::Error)]
pub enum PluginCommandError {
    #[error("plugin not found: {0}")]
    PluginNotFound(String),
    #[error("command `{command_id}` is not declared by plugin {plugin_id}")]
    UnknownCommand {
        plugin_id: String,
        command_id: String,
    },
    #[error("command `{0}` is marked dangerous and needs confirmation")]
    ConfirmationRequired(String),
    #[error("command `{command_id}` needs capability `{capability}`, which is not approved")]
    CapabilityDenied {
        command_id: String,
        capability: String,
    },
    #[error("plugin {caller} may not run commands of plugin {plugin_id}")]
    OutOfScope { caller: String, plugin_id: String },
    #[error("plugin process is not running: {0}")]
    PluginNotRunning(String),
    #[error("plugin {plugin_id} did not answer within {seconds}s")]
    TimedOut { plugin_id: String, seconds: u64 },
    #[error("command arguments must be a JSON object, got {0}")]
    InvalidArgs(&'static str),
    #[error("plugin {plugin_id} answered with an invalid command result: {reason}")]
    InvalidResult { plugin_id: String, reason: String },
    #[error("plugin error: {message}")]
    PluginError {
        code: i32,
        message: String,
        data: Option<serde_json::Value>,
    },
    #[error("plugin host state lock poisoned")]
    LockPoisoned,
    /// AI consent gates keep their existing `LIFECYCLE_ERROR` shape.
    #[error(transparent)]
    Lifecycle(#[from] LifecycleError),
}

impl PluginCommandError {
    fn kind(&self) -> &'static str {
        match self {
            Self::PluginNotFound(_) => "PLUGIN_NOT_FOUND",
            Self::UnknownCommand { .. } => "UNKNOWN_COMMAND",
            Self::ConfirmationRequired(_) => "CONFIRMATION_REQUIRED",
            Self::CapabilityDenied { .. } => "CAPABILITY_DENIED",
            Self::OutOfScope { .. } => "OUT_OF_SCOPE",
            Self::PluginNotRunning(_) => "PLUGIN_NOT_RUNNING",
            Self::TimedOut { .. } => "TIMED_OUT",
            Self::InvalidArgs(_) => "INVALID_ARGS",
            Self::InvalidResult { .. } => "INVALID_RESULT",
            Self::PluginError { .. } => "PLUGIN_ERROR",
            Self::LockPoisoned => "INTERNAL_ERROR",
            Self::Lifecycle(_) => "LIFECYCLE_ERROR",
        }
    }
}

impl serde::Serialize for PluginCommandError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        if let Self::Lifecycle(inner) = self {
            return inner.serialize(s);
        }
        let mut map = s.serialize_map(None)?;
        map.serialize_entry("kind", self.kind())?;
        map.serialize_entry("message", &self.to_string())?;
        if let Self::PluginError { code, data, .. } = self {
            map.serialize_entry("data", &serde_json::json!({ "code": code, "data": data }))?;
        }
        map.end()
    }
}

/// Successful result returned to the UI (`PluginCommandResult` in `types.ts`).
#[derive(Debug, Clone, serde::Serialize)]
pub struct PluginCommandResult {
    pub status: &'static str,
    pub payload: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl From<CommandResult> for PluginCommandResult {
    fn from(result: CommandResult) -> Self {
        Self {
            status: "ok",
            payload: result.payload,
            message: result.message,
        }
    }
}

/// A command resolved against an installed manifest.
#[derive(Debug, Clone)]
pub struct ResolvedCommand {
    pub plugin_id: String,
    pub command: ManifestCommand,
}

/// Find the manifest command for `(plugin_id, command_id)`.
///
/// The UI builds ids as `plugin.<plugin_id>.<command_id>` and splits them on the
/// first dot after `plugin.`, but plugin ids are reverse-domain and contain dots
/// themselves. When the pair does not name a declared command, the joined string
/// is matched against the installed plugin ids instead, so
/// `("dev", "example.hello.greet")` resolves to plugin `dev.example.hello`,
/// command `greet`.
pub fn resolve_command(
    manifests: &HashMap<String, PluginManifest>,
    plugin_id: &str,
    command_id: &str,
) -> Result<ResolvedCommand, PluginCommandError> {
    let declared = |manifest: &PluginManifest, id: &str| {
        manifest.commands.iter().find(|c| c.id == id).cloned()
    };

    if let Some(manifest) = manifests.get(plugin_id) {
        if let Some(command) = declared(manifest, command_id) {
            return Ok(ResolvedCommand {
                plugin_id: plugin_id.to_string(),
                command,
            });
        }
    }

    let joined = format!("{plugin_id}.{command_id}");
    let resplit = manifests
        .iter()
        .filter_map(|(id, manifest)| {
            let rest = joined.strip_prefix(id.as_str())?.strip_prefix('.')?;
            declared(manifest, rest).map(|command| ResolvedCommand {
                plugin_id: id.clone(),
                command,
            })
        })
        // Prefer the longest plugin id if two installed ids nest.
        .max_by_key(|resolved| resolved.plugin_id.len());
    if let Some(resolved) = resplit {
        return Ok(resolved);
    }

    if manifests.contains_key(plugin_id) {
        Err(PluginCommandError::UnknownCommand {
            plugin_id: plugin_id.to_string(),
            command_id: command_id.to_string(),
        })
    } else {
        Err(PluginCommandError::PluginNotFound(plugin_id.to_string()))
    }
}

/// Host-side gates every plugin command passes before it reaches the process.
///
/// - A `dangerous` command runs only with `confirmed_dangerous`, which the caller
///   sets after the user confirmed. The agent path never sets it.
/// - Every capability in the command's `required_capabilities` must be approved.
pub fn check_gates(
    command: &ManifestCommand,
    approved_capabilities: &[String],
    confirmed_dangerous: bool,
) -> Result<(), PluginCommandError> {
    if command.dangerous && !confirmed_dangerous {
        return Err(PluginCommandError::ConfirmationRequired(command.id.clone()));
    }
    if let Some(missing) = command
        .required_capabilities
        .iter()
        .find(|cap| !approved_capabilities.contains(cap))
    {
        return Err(PluginCommandError::CapabilityDenied {
            command_id: command.id.clone(),
            capability: missing.clone(),
        });
    }
    Ok(())
}

/// Resolve and gate a command, then return the client of its running plugin.
///
/// `caller_plugin_id` is set when a plugin's own panel asked to run the command;
/// the command must then belong to that same plugin. The UI's prefix check alone
/// cannot guarantee this, because plugin ids nest (`dev.example` is a prefix of
/// `dev.example.hello`).
pub fn prepare(
    state: &PluginHostState,
    plugin_id: &str,
    command_id: &str,
    confirmed_dangerous: bool,
    caller_plugin_id: Option<&str>,
) -> Result<(ResolvedCommand, PluginClient), PluginCommandError> {
    let resolved = {
        let manifests = state
            .manifests
            .lock()
            .map_err(|_| PluginCommandError::LockPoisoned)?;
        resolve_command(&manifests, plugin_id, command_id)?
    };
    if let Some(caller) = caller_plugin_id {
        if caller != resolved.plugin_id {
            return Err(PluginCommandError::OutOfScope {
                caller: caller.to_string(),
                plugin_id: resolved.plugin_id,
            });
        }
    }

    let approved_capabilities = {
        let store = state
            .store
            .lock()
            .map_err(|_| PluginCommandError::LockPoisoned)?;
        store
            .get(&resolved.plugin_id)
            .ok_or_else(|| PluginCommandError::PluginNotFound(resolved.plugin_id.clone()))?
            .approved_capabilities
            .clone()
    };
    check_gates(
        &resolved.command,
        &approved_capabilities,
        confirmed_dangerous,
    )?;

    let client = state
        .clients
        .lock()
        .map_err(|_| PluginCommandError::LockPoisoned)?
        .get(&resolved.plugin_id)
        .cloned()
        .ok_or_else(|| PluginCommandError::PluginNotRunning(resolved.plugin_id.clone()))?;

    Ok((resolved, client))
}

/// Send `rim.command.execute` to the plugin and wait for its result.
pub async fn dispatch(
    client: &PluginClient,
    resolved: &ResolvedCommand,
    params: &CommandExecuteParams,
    wait: Duration,
) -> Result<CommandResult, PluginCommandError> {
    let params = serde_json::to_value(params).map_err(|e| PluginCommandError::InvalidResult {
        plugin_id: resolved.plugin_id.clone(),
        reason: e.to_string(),
    })?;
    let result = client
        .request(EXECUTE_METHOD, Some(params), wait)
        .await
        .map_err(|e| match e {
            RequestError::Closed => {
                PluginCommandError::PluginNotRunning(resolved.plugin_id.clone())
            }
            RequestError::TimedOut(wait) => PluginCommandError::TimedOut {
                plugin_id: resolved.plugin_id.clone(),
                seconds: wait.as_secs(),
            },
            RequestError::Plugin(error) => PluginCommandError::PluginError {
                code: error.code,
                message: error.message,
                data: error.data,
            },
        })?;
    if !result.is_object() {
        return Err(PluginCommandError::InvalidResult {
            plugin_id: resolved.plugin_id.clone(),
            reason: "expected an object with a `payload` field".into(),
        });
    }
    serde_json::from_value(result).map_err(|e| PluginCommandError::InvalidResult {
        plugin_id: resolved.plugin_id.clone(),
        reason: e.to_string(),
    })
}

/// Command arguments as v1 sends them: an object, with `null` meaning none.
fn normalize_args(args: serde_json::Value) -> Result<serde_json::Value, PluginCommandError> {
    match args {
        serde_json::Value::Null => Ok(serde_json::json!({})),
        serde_json::Value::Object(_) => Ok(args),
        serde_json::Value::Bool(_) => Err(PluginCommandError::InvalidArgs("a boolean")),
        serde_json::Value::Number(_) => Err(PluginCommandError::InvalidArgs("a number")),
        serde_json::Value::String(_) => Err(PluginCommandError::InvalidArgs("a string")),
        serde_json::Value::Array(_) => Err(PluginCommandError::InvalidArgs("an array")),
    }
}

/// Run a plugin command end to end: resolve, gate, dispatch, audit.
pub async fn execute(
    state: &PluginHostState,
    plugin_id: &str,
    command_id: &str,
    args: serde_json::Value,
    confirmed_dangerous: bool,
    caller_plugin_id: Option<&str>,
    initiator: Initiator,
) -> Result<CommandResult, PluginCommandError> {
    // Only a person confirms a dangerous run: whatever the caller says, the
    // agent's runs count as unconfirmed, so the gate in `prepare` refuses them.
    let confirmed_dangerous = confirmed_dangerous && initiator != Initiator::Agent;
    let prepared = normalize_args(args).and_then(|args| {
        prepare(
            state,
            plugin_id,
            command_id,
            confirmed_dangerous,
            caller_plugin_id,
        )
        .map(|(resolved, client)| (resolved, client, args))
    });
    let (resolved, client, args) = match prepared {
        Ok(prepared) => prepared,
        Err(e) => {
            log::warn!(
                "[AUDIT] event=plugin_command_denied plugin_id={} command_id={} reason={}",
                plugin_id,
                command_id,
                e.kind()
            );
            return Err(e);
        }
    };

    let invoker = state
        .principal
        .lock()
        .map_err(|_| PluginCommandError::LockPoisoned)?
        .clone();
    let params = CommandExecuteParams {
        command_id: resolved.command.id.clone(),
        args,
        invoker,
        initiator,
        // `prepare` refused an unconfirmed dangerous command, so this is the confirmation.
        confirmed: resolved.command.dangerous && confirmed_dangerous,
    };
    let result = dispatch(&client, &resolved, &params, COMMAND_TIMEOUT).await;
    log::warn!(
        "[AUDIT] event=plugin_command_invocation plugin_id={} command_id={} initiator={:?} dangerous={} outcome={}",
        resolved.plugin_id,
        resolved.command.id,
        initiator,
        resolved.command.dangerous,
        match &result {
            Ok(_) => "ok",
            Err(e) => e.kind(),
        }
    );
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::broker::{run_broker_loop, BrokerConfig, PluginBroker};
    use crate::plugin_host::capability::CapabilityGate;
    use crate::plugin_host::lifecycle;
    use crate::plugin_host::manifest::RuntimeKind;
    use crate::plugin_host::panel_relay::PanelRelay;
    use crate::plugin_host::protocol::Principal;
    use crate::plugin_host::state::PluginStateStore;
    use crate::plugin_host::wire::{self, JsonRpcResponse};
    use std::sync::{Arc, Mutex};

    const PLUGIN: &str = "dev.example.tool";
    const USER_ID: &str = "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b";

    fn command(id: &str) -> ManifestCommand {
        ManifestCommand {
            id: id.into(),
            title: id.into(),
            description: String::new(),
            keybind_capable: false,
            dangerous: false,
            required_context: vec![],
            required_capabilities: vec![],
            arguments: vec![],
            ai_callable: false,
            output_schema: None,
        }
    }

    fn manifest(plugin_id: &str, commands: Vec<ManifestCommand>) -> PluginManifest {
        PluginManifest {
            manifest_version: 1,
            plugin_id: plugin_id.into(),
            display_name: "Tool".into(),
            version: "1.0.0".into(),
            description: "test".into(),
            author: None,
            runtime_kind: RuntimeKind::DesktopLocalProcess,
            entrypoint: "main.sh".into(),
            capabilities: vec![],
            network_origins: None,
            commands,
            keybind_suggestions: vec![],
            context_actions: vec![],
            panels: vec![],
            settings_schema: vec![],
        }
    }

    fn manifests(list: Vec<PluginManifest>) -> HashMap<String, PluginManifest> {
        list.into_iter().map(|m| (m.plugin_id.clone(), m)).collect()
    }

    fn installed_state(manifest: PluginManifest) -> PluginHostState {
        let mut store = PluginStateStore::default();
        lifecycle::install(&mut store, &manifest).unwrap();
        PluginHostState {
            store: Mutex::new(store),
            manifests: Mutex::new(manifests(vec![manifest])),
            state_path: std::path::PathBuf::from("/nonexistent/plugins.json"),
            plugin_dirs: Mutex::new(HashMap::new()),
            shutdown_txs: Arc::new(Mutex::new(HashMap::new())),
            clients: Arc::new(Mutex::new(HashMap::new())),
            panel_relay: Arc::new(PanelRelay::new()),
            pending_ui_events: Mutex::new(Vec::new()),
            principal: Arc::new(Mutex::new(None)),
            principal_ids: Arc::new(Mutex::new(Vec::new())),
            pids: Arc::new(Mutex::new(HashMap::new())),
            events: Arc::new(crate::plugin_host::host_events::PluginEvents::new()),
            storage: crate::plugin_host::storage::PluginStorage::new(std::path::Path::new(
                "/nonexistent",
            )),
            account: std::sync::Mutex::new(None),
        }
    }

    /// Register a running connection for PLUGIN whose fake process answers one request.
    fn connect_fake_plugin(
        state: &PluginHostState,
        answer: impl FnOnce(serde_json::Value) -> JsonRpcResponse + Send + 'static,
    ) -> tokio::task::JoinHandle<()> {
        let (host_end, mut plugin_end) = tokio::io::duplex(64 * 1024);
        let (reader, writer) = tokio::io::split(host_end);
        let (client, outbound_rx) = PluginClient::channel();
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        let broker = PluginBroker::new(
            PLUGIN.into(),
            CapabilityGate::new(vec![]),
            BrokerConfig::default(),
        );
        tokio::spawn(async move {
            run_broker_loop(broker, reader, writer, outbound_rx, shutdown_rx).await;
            drop(shutdown_tx);
        });
        state.clients.lock().unwrap().insert(PLUGIN.into(), client);
        tokio::spawn(async move {
            let request = wire::read_raw_frame(&mut plugin_end).await.unwrap();
            wire::write_frame(&mut plugin_end, &answer(request))
                .await
                .unwrap();
            // Keep the pipe open until the host has read the answer.
            tokio::time::sleep(Duration::from_millis(200)).await;
        })
    }

    // ── resolve_command ──

    #[test]
    fn resolves_exact_pair() {
        let m = manifests(vec![manifest(PLUGIN, vec![command("greet")])]);
        let resolved = resolve_command(&m, PLUGIN, "greet").unwrap();
        assert_eq!(resolved.plugin_id, PLUGIN);
        assert_eq!(resolved.command.id, "greet");
    }

    #[test]
    fn resolves_pair_split_inside_dotted_plugin_id() {
        // parsePluginCommandId("plugin.dev.example.tool.greet") → ("dev", "example.tool.greet")
        let m = manifests(vec![manifest(PLUGIN, vec![command("greet")])]);
        let resolved = resolve_command(&m, "dev", "example.tool.greet").unwrap();
        assert_eq!(resolved.plugin_id, PLUGIN);
        assert_eq!(resolved.command.id, "greet");
    }

    #[test]
    fn resolves_dotted_command_id() {
        let m = manifests(vec![manifest(PLUGIN, vec![command("pods.restart")])]);
        let resolved = resolve_command(&m, "dev", "example.tool.pods.restart").unwrap();
        assert_eq!(resolved.plugin_id, PLUGIN);
        assert_eq!(resolved.command.id, "pods.restart");
    }

    #[test]
    fn undeclared_command_is_rejected() {
        let m = manifests(vec![manifest(PLUGIN, vec![command("greet")])]);
        let err = resolve_command(&m, PLUGIN, "rm_rf").unwrap_err();
        assert!(
            matches!(err, PluginCommandError::UnknownCommand { .. }),
            "{err:?}"
        );
    }

    #[test]
    fn unknown_plugin_is_rejected() {
        let m = manifests(vec![manifest(PLUGIN, vec![command("greet")])]);
        let err = resolve_command(&m, "dev.example.other", "greet").unwrap_err();
        assert!(
            matches!(err, PluginCommandError::PluginNotFound(_)),
            "{err:?}"
        );
    }

    // ── check_gates ──

    #[test]
    fn dangerous_command_needs_confirmation() {
        let mut cmd = command("restart_pod");
        cmd.dangerous = true;
        let err = check_gates(&cmd, &[], false).unwrap_err();
        assert!(
            matches!(err, PluginCommandError::ConfirmationRequired(_)),
            "{err:?}"
        );
        check_gates(&cmd, &[], true).expect("confirmed dangerous command passes");
    }

    #[test]
    fn required_capability_must_be_approved() {
        let mut cmd = command("read");
        cmd.required_capabilities = vec!["plugin.dev.example.tool.read".into()];
        let err = check_gates(&cmd, &[], false).unwrap_err();
        assert!(
            matches!(err, PluginCommandError::CapabilityDenied { .. }),
            "{err:?}"
        );
        check_gates(&cmd, &["plugin.dev.example.tool.read".into()], false)
            .expect("approved capability passes");
    }

    // ── prepare / execute ──

    #[test]
    fn installed_but_not_running_plugin_is_reported() {
        let state = installed_state(manifest(PLUGIN, vec![command("greet")]));
        let err = prepare(&state, PLUGIN, "greet", false, None).unwrap_err();
        assert!(
            matches!(err, PluginCommandError::PluginNotRunning(_)),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn execute_sends_command_to_plugin_and_returns_its_result() {
        let state = installed_state(manifest(PLUGIN, vec![command("greet")]));
        let fake = connect_fake_plugin(&state, |request| {
            assert_eq!(request["method"], EXECUTE_METHOD);
            assert_eq!(request["params"]["commandId"], "greet");
            assert_eq!(request["params"]["initiator"], "user");
            assert_eq!(request["params"]["confirmed"], false);
            assert_eq!(
                request["params"]["invoker"]["displayName"], "Jakub",
                "the signed-in principal rides along: {request}"
            );
            let name = request["params"]["args"]["name"].as_str().unwrap_or("?");
            JsonRpcResponse::success(
                request["id"].clone(),
                serde_json::json!({"payload": format!("Hello, {name}!"), "message": "greeted"}),
            )
        });
        *state.principal.lock().unwrap() = Some(Principal::provisional(USER_ID, "Jakub"));

        let result = execute(
            &state,
            "dev",
            "example.tool.greet",
            serde_json::json!({"name": "Jakub"}),
            false,
            None,
            Initiator::User,
        )
        .await
        .unwrap();
        assert_eq!(result.payload, serde_json::json!("Hello, Jakub!"));
        assert_eq!(result.message.as_deref(), Some("greeted"));
        fake.await.unwrap();
    }

    #[tokio::test]
    async fn confirmed_dangerous_command_carries_the_confirmation() {
        let mut cmd = command("restart_pod");
        cmd.dangerous = true;
        let state = installed_state(manifest(PLUGIN, vec![cmd]));
        let fake = connect_fake_plugin(&state, |request| {
            assert_eq!(request["params"]["confirmed"], true);
            assert_eq!(request["params"]["invoker"], serde_json::Value::Null);
            JsonRpcResponse::success(request["id"].clone(), serde_json::json!({"payload": null}))
        });

        let result = execute(
            &state,
            PLUGIN,
            "restart_pod",
            serde_json::Value::Null,
            true,
            None,
            Initiator::User,
        )
        .await
        .unwrap();
        assert_eq!(result.payload, serde_json::Value::Null);
        fake.await.unwrap();
    }

    #[tokio::test]
    async fn non_object_result_is_rejected() {
        let state = installed_state(manifest(PLUGIN, vec![command("greet")]));
        let fake = connect_fake_plugin(&state, |request| {
            JsonRpcResponse::success(request["id"].clone(), serde_json::json!("bare string"))
        });

        let err = execute(
            &state,
            PLUGIN,
            "greet",
            serde_json::json!({}),
            false,
            None,
            Initiator::User,
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, PluginCommandError::InvalidResult { .. }),
            "{err:?}"
        );
        fake.await.unwrap();
    }

    #[tokio::test]
    async fn non_object_args_never_reach_the_plugin() {
        let state = installed_state(manifest(PLUGIN, vec![command("greet")]));
        let (client, mut outbound_rx) = PluginClient::channel();
        state.clients.lock().unwrap().insert(PLUGIN.into(), client);

        let err = execute(
            &state,
            PLUGIN,
            "greet",
            serde_json::json!("free text"),
            false,
            None,
            Initiator::Agent,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, PluginCommandError::InvalidArgs(_)), "{err:?}");
        assert!(outbound_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn plugin_error_is_returned_typed() {
        let state = installed_state(manifest(PLUGIN, vec![command("greet")]));
        let fake = connect_fake_plugin(&state, |request| {
            JsonRpcResponse::error(request["id"].clone(), wire::PLUGIN_ERROR, "boom")
        });

        let err = execute(
            &state,
            PLUGIN,
            "greet",
            serde_json::json!({}),
            false,
            None,
            Initiator::User,
        )
        .await
        .unwrap_err();
        match &err {
            PluginCommandError::PluginError { code, message, .. } => {
                assert_eq!(*code, wire::PLUGIN_ERROR);
                assert_eq!(message, "boom");
            }
            other => panic!("expected PluginError, got {other:?}"),
        }
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "PLUGIN_ERROR");
        assert_eq!(json["data"]["code"], wire::PLUGIN_ERROR);
        fake.await.unwrap();
    }

    #[tokio::test]
    async fn unconfirmed_dangerous_command_never_reaches_plugin() {
        let mut cmd = command("restart_pod");
        cmd.dangerous = true;
        let state = installed_state(manifest(PLUGIN, vec![cmd]));
        // A running plugin that would fail the test if it received anything.
        let (client, mut outbound_rx) = PluginClient::channel();
        state.clients.lock().unwrap().insert(PLUGIN.into(), client);

        let err = execute(
            &state,
            PLUGIN,
            "restart_pod",
            serde_json::json!({}),
            false,
            None,
            Initiator::User,
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, PluginCommandError::ConfirmationRequired(_)),
            "{err:?}"
        );
        assert!(
            outbound_rx.try_recv().is_err(),
            "nothing may be sent to the plugin"
        );
    }

    #[test]
    fn panel_cannot_run_a_nested_plugins_command() {
        // `dev.example` passes the UI's prefix check for `plugin.dev.example.tool.greet`.
        let mut state = installed_state(manifest(PLUGIN, vec![command("greet")]));
        let parent = manifest("dev.example", vec![]);
        state
            .manifests
            .get_mut()
            .unwrap()
            .insert(parent.plugin_id.clone(), parent);

        let err = prepare(
            &state,
            "dev",
            "example.tool.greet",
            false,
            Some("dev.example"),
        )
        .unwrap_err();
        assert!(
            matches!(err, PluginCommandError::OutOfScope { .. }),
            "{err:?}"
        );

        // The owning plugin's own panel is in scope (and then only lacks a running process).
        let err = prepare(&state, "dev", "example.tool.greet", false, Some(PLUGIN)).unwrap_err();
        assert!(
            matches!(err, PluginCommandError::PluginNotRunning(_)),
            "{err:?}"
        );
    }

    #[test]
    fn errors_serialize_with_kind_and_message() {
        let json =
            serde_json::to_value(PluginCommandError::PluginNotRunning(PLUGIN.into())).unwrap();
        assert_eq!(json["kind"], "PLUGIN_NOT_RUNNING");
        assert!(json["message"].as_str().unwrap().contains(PLUGIN));

        let json = serde_json::to_value(PluginCommandError::Lifecycle(
            LifecycleError::AiConsentRequired,
        ))
        .unwrap();
        assert_eq!(json["kind"], "LIFECYCLE_ERROR");
    }
}
