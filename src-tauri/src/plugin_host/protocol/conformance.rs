//! Conformance tests for plugin protocol v1.
//!
//! They hold the host to `protocol/plugin-protocol-v1.schema.json`:
//! - every example in the schema is valid against its own definition;
//! - the frames the host builds through its real code paths equal the frozen
//!   examples, so changing a shape means changing the schema on purpose;
//! - no host frame carries anything shaped like a UUID, so a raw account id
//!   cannot reach a plugin;
//! - the in-tree hello-world plugin answers every host request with a valid frame
//!   and exits on `rim.shutdown`;
//! - so does the TypeScript template plugin built on `sdk/plugin-sdk`, which
//!   also refuses an unconfirmed dangerous command on its own, and runs through
//!   the host's real start-up and command path;
//! - a test plugin's panel state reaches the host's panel store and its live
//!   updates, whole and patched, and is cleared when the plugin stops;
//! - the settings the host reads reach a plugin in `rim.settings.get` answers and
//!   in `rim.settings.changed` after a save or a principal change.

use super::{method, Initiator, Principal};
use crate::plugin_host::broker::{run_broker_loop, BrokerConfig, PluginBroker, PluginClient};
use crate::plugin_host::capability::CapabilityGate;
use crate::plugin_host::host_events::PluginEventKind;
use crate::plugin_host::manifest::PluginManifest;
use crate::plugin_host::process::PluginProcess;
use crate::plugin_host::settings::{self, test_manifest, SettingsFixture, SettingsReader};
use crate::plugin_host::validation::validate_plugin_manifest;
use crate::plugin_host::wire::{self, JsonRpcRequest, JsonRpcResponse};
use crate::plugin_host::{command_exec, handshake, runtime, PluginHostState};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;
use tokio::io::DuplexStream;

const SCHEMA_JSON: &str = include_str!("../../../../protocol/plugin-protocol-v1.schema.json");

/// The account behind every principal in the schema's examples.
const USER_ID: &str = "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b";
const DISPLAY_NAME: &str = "Jakub";
const HELLO_WORLD: &str = "dev.example.hello-world";
const TEMPLATE_TS: &str = "dev.example.template-ts";
const PANEL_TS: &str = "dev.example.panel-ts";
const WAIT: Duration = Duration::from_secs(15);

static SCHEMA: LazyLock<Value> =
    LazyLock::new(|| serde_json::from_str(SCHEMA_JSON).expect("schema is valid JSON"));

fn principal() -> Principal {
    Principal::provisional(USER_ID, DISPLAY_NAME)
}

/// Errors from validating `instance` against `$defs/<def>`, as readable strings.
fn violations(def: &str, instance: &Value) -> Vec<String> {
    assert!(
        SCHEMA["$defs"].get(def).is_some(),
        "schema has no $defs/{def}"
    );
    let mut schema = SCHEMA.clone();
    schema["$ref"] = json!(format!("#/$defs/{def}"));
    let validator = jsonschema::validator_for(&schema).expect("schema compiles");
    validator
        .iter_errors(instance)
        .map(|e| format!("{} at {}", e, e.instance_path()))
        .collect()
}

#[track_caller]
fn assert_valid(def: &str, instance: &Value) {
    let errors = violations(def, instance);
    assert!(
        errors.is_empty(),
        "frame does not match $defs/{def}: {errors:?}\n{instance:#}"
    );
}

/// The first example frame the schema gives for `def`.
fn example(def: &str) -> Value {
    SCHEMA["$defs"][def]["examples"][0].clone()
}

/// True when `s` contains 32 hex digits in UUID layout, with or without hyphens.
fn contains_uuid(s: &str) -> bool {
    let bytes = s.as_bytes();
    (0..bytes.len()).any(|start| {
        let mut digits = 0;
        let mut i = start;
        while digits < 32 && i < bytes.len() {
            let b = bytes[i];
            if b.is_ascii_hexdigit() {
                digits += 1;
            } else if b == b'-' && matches!(digits, 8 | 12 | 16 | 20) {
                // A hyphen only where the canonical form puts one.
            } else {
                break;
            }
            i += 1;
        }
        digits == 32
    })
}

/// Fails when any string in `frame`, key or value, looks like a UUID or an address.
#[track_caller]
fn assert_no_raw_ids(frame: &Value) {
    fn walk(value: &Value, frame: &Value) {
        match value {
            Value::String(s) => {
                assert!(
                    !contains_uuid(s),
                    "frame leaks a UUID-shaped id `{s}`: {frame}"
                );
            }
            Value::Array(items) => items.iter().for_each(|v| walk(v, frame)),
            Value::Object(map) => map.iter().for_each(|(k, v)| {
                assert!(!contains_uuid(k), "frame leaks a UUID-shaped key: {frame}");
                if k == "principalId" {
                    let id = v.as_str().unwrap_or_default();
                    assert!(!id.contains('@'), "principalId is an address: {frame}");
                }
                walk(v, frame);
            }),
            _ => {}
        }
    }
    walk(frame, frame);
}

/// Starts a broker loop for HELLO_WORLD on an in-memory pipe; the other end plays the plugin.
fn connect(state: Option<&PluginHostState>) -> (PluginClient, DuplexStream, Shutdown) {
    let broker = PluginBroker::new(
        HELLO_WORLD.into(),
        CapabilityGate::new(vec![]),
        BrokerConfig::default(),
    );
    connect_broker(broker, state)
}

/// As [`connect`], with the broker reading its settings from `state`, as a started
/// plugin's does.
fn connect_with_settings(state: &PluginHostState) -> (PluginClient, DuplexStream, Shutdown) {
    let broker = PluginBroker::new(
        HELLO_WORLD.into(),
        CapabilityGate::new(vec![]),
        BrokerConfig::default(),
    )
    .with_settings(SettingsReader::new(state, HELLO_WORLD));
    connect_broker(broker, Some(state))
}

fn connect_broker(
    broker: PluginBroker,
    state: Option<&PluginHostState>,
) -> (PluginClient, DuplexStream, Shutdown) {
    let (host_end, plugin_end) = tokio::io::duplex(64 * 1024);
    let (reader, writer) = tokio::io::split(host_end);
    let (client, outbound_rx) = PluginClient::channel();
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    tokio::spawn(run_broker_loop(
        broker,
        reader,
        writer,
        outbound_rx,
        shutdown_rx,
    ));
    if let Some(state) = state {
        state
            .clients
            .lock()
            .unwrap()
            .insert(HELLO_WORLD.into(), client.clone());
    }
    (client, plugin_end, shutdown_tx)
}

type Shutdown = tokio::sync::watch::Sender<bool>;

async fn read(plugin: &mut DuplexStream) -> Value {
    tokio::time::timeout(WAIT, wire::read_raw_frame(plugin))
        .await
        .expect("host sent a frame in time")
        .expect("host frame is valid")
}

fn hello_world_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins/hello-world")
}

fn hello_world_manifest() -> PluginManifest {
    PluginManifest::load(&hello_world_dir().join("rim-plugin.json")).expect("hello-world manifest")
}

/// Makes `actual`'s integer request id comparable with the example's.
fn with_id_of(mut actual: Value, example: &Value) -> Value {
    assert!(
        actual["id"].as_i64().is_some_and(|id| id >= 1),
        "host request ids are positive integers: {actual}"
    );
    actual["id"] = example["id"].clone();
    actual
}

// ── The schema itself ──

#[test]
fn every_example_matches_its_definition() {
    let defs = SCHEMA["$defs"].as_object().unwrap();
    for (name, def) in defs {
        let examples = def["examples"].as_array();
        let is_frame = ["Request", "Response", "Notification"]
            .iter()
            .any(|suffix| name.ends_with(suffix));
        assert!(
            !is_frame || examples.is_some_and(|e| !e.is_empty()),
            "frame $defs/{name} needs an example"
        );
        for example in examples.into_iter().flatten() {
            assert_valid(name, example);
        }
    }
}

#[test]
fn framing_matches_the_wire_code() {
    let framing = &SCHEMA["x-framing"];
    assert_eq!(
        framing["maxFrameBytes"],
        json!(wire::MAX_FRAME_SIZE),
        "schema and wire.rs agree on the frame limit"
    );
    assert!(framing["frame"].as_str().unwrap().contains("little-endian"));
}

#[tokio::test]
async fn frames_are_little_endian_length_prefixed_json() {
    let mut buf = Vec::new();
    let frame = example("ShutdownNotification");
    wire::write_frame(&mut buf, &frame).await.unwrap();
    let body = serde_json::to_vec(&frame).unwrap();
    assert_eq!(&buf[..4], &(body.len() as u32).to_le_bytes());
    assert_eq!(&buf[4..], &body[..]);
}

#[test]
fn principal_rejects_raw_ids_and_addresses() {
    assert_valid("Principal", &serde_json::to_value(principal()).unwrap());
    for bad in [
        USER_ID,
        "someone@example.org",
        "0192b3c45d6e7f809a1b2c3d4e5f6a7b",
        "",
    ] {
        let candidate = json!({"principalId": bad, "displayName": DISPLAY_NAME});
        assert!(
            !violations("Principal", &candidate).is_empty(),
            "`{bad}` must not pass as a principalId"
        );
    }
}

#[test]
fn uuid_detector_finds_both_layouts() {
    assert!(contains_uuid(USER_ID));
    assert!(contains_uuid(&format!("user:{}", USER_ID.replace('-', ""))));
    assert!(contains_uuid(&USER_ID.to_ascii_uppercase()));
    assert!(!contains_uuid(&principal().principal_id));
    assert!(!contains_uuid("2026-10-08T21:55:54Z"));
}

// ── Host frames equal the frozen examples ──

#[test]
fn handshake_request_is_frozen() {
    let mut expected = example("HandshakeRequest");
    expected["params"]["hostVersion"] = json!(env!("CARGO_PKG_VERSION"));
    let params = handshake::handshake_params(HELLO_WORLD, &[], Some(principal())).unwrap();
    let frame =
        serde_json::to_value(JsonRpcRequest::new(method::HANDSHAKE, Some(params), 1)).unwrap();
    assert_eq!(frame, expected);
    assert_valid("HandshakeRequest", &frame);
    assert_no_raw_ids(&frame);
}

#[test]
fn handshake_without_principal_sends_null() {
    let params = handshake::handshake_params(HELLO_WORLD, &[], None).unwrap();
    assert_eq!(params["principal"], Value::Null);
    let frame =
        serde_json::to_value(JsonRpcRequest::new(method::HANDSHAKE, Some(params), 1)).unwrap();
    assert_valid("HandshakeRequest", &frame);
}

#[test]
fn handshake_response_example_is_accepted_by_the_host() {
    let response = example("HandshakeResponse");
    handshake::validate_handshake_result(response["result"].clone(), HELLO_WORLD)
        .expect("the frozen handshake answer is accepted");
}

#[test]
fn heartbeat_request_is_frozen() {
    let mut broker = PluginBroker::new(
        HELLO_WORLD.into(),
        CapabilityGate::new(vec![]),
        BrokerConfig::default(),
    );
    let frame = serde_json::to_value(broker.create_heartbeat_ping()).unwrap();
    assert_eq!(frame, example("HeartbeatRequest"));
}

#[tokio::test]
async fn shutdown_notification_is_frozen() {
    let (_client, mut plugin, shutdown) = connect(None);
    shutdown.send(true).unwrap();
    let frame = read(&mut plugin).await;
    assert_eq!(frame, example("ShutdownNotification"));
}

#[tokio::test]
async fn principal_changed_notification_is_frozen() {
    let state = PluginHostState::with_installed(vec![]);
    let (_client, mut plugin, _shutdown) = connect(Some(&state));

    runtime::set_principal(&state, Some(principal())).await;
    let signed_in = read(&mut plugin).await;
    assert_valid("PrincipalChangedNotification", &signed_in);
    assert_eq!(
        signed_in["params"]["principal"],
        serde_json::to_value(principal()).unwrap()
    );
    assert_no_raw_ids(&signed_in);

    // Setting the same principal again sends nothing; signing out does.
    runtime::set_principal(&state, Some(principal())).await;
    runtime::set_principal(&state, None).await;
    let signed_out = read(&mut plugin).await;
    assert_eq!(signed_out, example("PrincipalChangedNotification"));
}

#[tokio::test]
async fn principals_remapped_notification_is_frozen() {
    let dir = tempfile::tempdir().unwrap();
    let mut state = PluginHostState::with_installed(vec![]);
    state.state_path = dir.path().join("plugins.json");
    let (_client, mut plugin, _shutdown) = connect(Some(&state));
    let from = principal().principal_id;
    let to = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";

    assert!(runtime::record_principal_switch(&state, &from, to));
    // The same switch again is no news.
    assert!(!runtime::record_principal_switch(&state, &from, to));
    runtime::announce_remapped(&state).await;
    let frame = read(&mut plugin).await;
    assert_valid("PrincipalsRemappedNotification", &frame);
    assert_eq!(
        frame["params"]["mappings"],
        json!([{ "from": from, "to": to }])
    );
    assert_no_raw_ids(&frame);

    // The switch outlives the app: the state file keeps it.
    let stored = crate::plugin_host::state::PluginStateStore::load(&state.state_path);
    assert_eq!(
        stored.principal_ids.get(&from).map(String::as_str),
        Some(to)
    );
    assert_eq!(runtime::mappings_of(&stored).len(), 1);
}

#[tokio::test]
async fn command_execute_request_is_frozen() {
    let state = PluginHostState::with_installed(vec![hello_world_manifest()]);
    *state.principal.lock().unwrap() = Some(principal());
    let (_client, mut plugin, _shutdown) = connect(Some(&state));

    let expected_request = example("CommandExecuteRequest");
    let answer = example("CommandExecuteResponse");
    let fake_plugin = tokio::spawn(async move {
        let request = read(&mut plugin).await;
        let reply = json!({"jsonrpc": "2.0", "id": request["id"], "result": answer["result"]});
        wire::write_frame(&mut plugin, &reply).await.unwrap();
        (request, plugin)
    });

    let result = command_exec::execute(
        &state,
        HELLO_WORLD,
        "greet",
        json!({"name": "RIM"}),
        false,
        None,
        Initiator::User,
    )
    .await
    .unwrap();
    assert_eq!(result.payload, json!("Hello, RIM!"));

    let (request, _plugin) = fake_plugin.await.unwrap();
    assert_valid("CommandExecuteRequest", &request);
    assert_no_raw_ids(&request);
    assert_eq!(with_id_of(request, &expected_request), expected_request);
}

#[tokio::test]
async fn agent_command_is_marked_and_never_confirmed() {
    let state = PluginHostState::with_installed(vec![hello_world_manifest()]);
    let (_client, mut plugin, _shutdown) = connect(Some(&state));
    let fake_plugin = tokio::spawn(async move {
        let request = read(&mut plugin).await;
        let reply = JsonRpcResponse::success(request["id"].clone(), json!({}));
        wire::write_frame(&mut plugin, &reply).await.unwrap();
        (request, plugin)
    });

    let result = command_exec::execute(
        &state,
        HELLO_WORLD,
        "greet",
        Value::Null,
        false,
        Some(HELLO_WORLD),
        Initiator::Agent,
    )
    .await
    .unwrap();
    assert_eq!(result.payload, Value::Null, "a missing payload is null");

    let (request, _plugin) = fake_plugin.await.unwrap();
    assert_valid("CommandExecuteRequest", &request);
    assert_eq!(request["params"]["initiator"], "agent");
    assert_eq!(request["params"]["confirmed"], false);
    assert_eq!(request["params"]["args"], json!({}));
    assert_eq!(request["params"]["invoker"], Value::Null);
}

#[tokio::test]
async fn log_response_is_frozen_and_echoes_string_ids() {
    let mut broker = PluginBroker::new(
        HELLO_WORLD.into(),
        CapabilityGate::new(vec![]),
        BrokerConfig::default(),
    );
    let mut frame = example("LogRequest");
    frame["id"] = json!("log-1");
    let request: JsonRpcRequest = serde_json::from_value(frame).expect("log request parses");
    let response = serde_json::to_value(broker.handle_request(&request).await).unwrap();
    assert_eq!(response, example("LogResponse"));
}

#[tokio::test]
async fn host_errors_are_error_responses() {
    let mut broker = PluginBroker::new(
        HELLO_WORLD.into(),
        CapabilityGate::new(vec![]),
        BrokerConfig::default(),
    );
    for request in [
        JsonRpcRequest::new("rim.nonexistent", None, 7),
        JsonRpcRequest::new(method::LOG, Some(json!({"level": "loud"})), 8),
        JsonRpcRequest::new("rim.chat.post_message", None, 9),
    ] {
        let response = serde_json::to_value(broker.handle_request(&request).await).unwrap();
        assert_valid("ErrorResponse", &response);
    }
}

// ── Settings ──

/// A host with HELLO_WORLD declaring the settings of the protocol's examples, and
/// the examples' account signed in.
fn settings_host() -> SettingsFixture {
    let host = SettingsFixture::new(vec![test_manifest(
        HELLO_WORLD,
        json!([
            { "key": "context", "title": "Kubernetes context", "value_type": "string", "placeholder": "prod-eu" },
            { "key": "namespace", "title": "Default namespace", "value_type": "string", "default": "default" },
            { "key": "refresh_seconds", "title": "Refresh every (seconds)", "value_type": "integer", "default": 30, "min": 5, "max": 3600 },
            { "key": "output", "title": "Output", "value_type": "enum", "options": ["table", "json"], "default": "table" },
            { "key": "api_token", "title": "API server token", "value_type": "string", "is_secret": true }
        ]),
    )]);
    host.sign_in(Some(&principal().principal_id));
    host
}

#[tokio::test]
async fn settings_get_response_is_frozen() {
    let host = settings_host();
    let expected = example("SettingsGetResponse");
    host.save(
        HELLO_WORLD,
        &principal().principal_id,
        json!({
            "namespace": expected["result"]["values"]["namespace"],
            "api_token": expected["result"]["values"]["api_token"],
        }),
    );
    let (_client, mut plugin, _shutdown) = connect_with_settings(&host.state);

    let request = example("SettingsGetRequest");
    wire::write_frame(&mut plugin, &request).await.unwrap();
    let response = read(&mut plugin).await;
    assert_valid("SettingsGetResponse", &response);
    assert_eq!(response, expected);
}

#[tokio::test]
async fn settings_get_with_a_locked_vault_is_an_error_response() {
    let host = settings_host();
    host.secrets.lock();
    let (_client, mut plugin, _shutdown) = connect_with_settings(&host.state);

    wire::write_frame(&mut plugin, &example("SettingsGetRequest"))
        .await
        .unwrap();
    let response = read(&mut plugin).await;
    assert_valid("ErrorResponse", &response);
    // The schema's example of it; the message names the keyring's own reason.
    let expected = &SCHEMA["$defs"]["ErrorResponse"]["examples"][1];
    assert_eq!(response["id"], expected["id"]);
    assert_eq!(response["error"]["code"], wire::INTERNAL_ERROR);
    assert_eq!(response["error"]["code"], expected["error"]["code"]);
    assert_eq!(response["error"]["data"], expected["error"]["data"]);
}

#[tokio::test]
async fn settings_changed_notification_is_frozen() {
    let host = settings_host();
    let (_client, mut plugin, _shutdown) = connect_with_settings(&host.state);

    // What a save of the plugin's settings sends.
    host.save(
        HELLO_WORLD,
        &principal().principal_id,
        json!({"namespace": "staging", "output": "json"}),
    );
    settings::on_saved(&host.state, HELLO_WORLD);
    let frame = read(&mut plugin).await;
    assert_valid("SettingsChangedNotification", &frame);
    assert_eq!(frame, example("SettingsChangedNotification"));
}

#[tokio::test]
async fn settings_changed_follows_every_principal_change() {
    let host = settings_host();
    let account = principal().principal_id;
    host.save(HELLO_WORLD, &account, json!({"namespace": "prod"}));
    host.sign_in(None);
    let state = &host.state;
    let (_client, mut plugin, _shutdown) = connect_with_settings(state);

    // The UI records the account before it announces the principal.
    host.sign_in(Some(&account));
    runtime::set_principal(state, Some(principal())).await;
    assert_eq!(read(&mut plugin).await["method"], method::PRINCIPAL_CHANGED);
    let settings = read(&mut plugin).await;
    assert_valid("SettingsChangedNotification", &settings);
    assert_eq!(settings["params"]["values"]["namespace"], "prod");

    host.sign_in(None);
    runtime::set_principal(state, None).await;
    assert_eq!(
        read(&mut plugin).await,
        example("PrincipalChangedNotification")
    );
    let settings = read(&mut plugin).await;
    assert_valid("SettingsChangedNotification", &settings);
    assert_eq!(
        settings["params"],
        json!({"values": {"namespace": "default", "refresh_seconds": 30, "output": "table"}}),
        "signed out: the defaults only"
    );
}

#[tokio::test]
async fn no_settings_changed_is_sent_while_the_vault_is_locked() {
    let host = settings_host();
    let (_client, mut plugin, _shutdown) = connect_with_settings(&host.state);

    host.secrets.lock();
    settings::on_saved(&host.state, HELLO_WORLD);
    runtime::set_principal(&host.state, Some(principal())).await;
    assert_eq!(read(&mut plugin).await["method"], method::PRINCIPAL_CHANGED);
    // The next frame answers this request: nothing came in between.
    wire::write_frame(&mut plugin, &example("SettingsGetRequest"))
        .await
        .unwrap();
    let response = read(&mut plugin).await;
    assert_eq!(response["id"], example("SettingsGetRequest")["id"]);
    assert_eq!(response["error"]["data"]["reason"], "secretsLocked");
}

// ── The reference plugin ──

/// Reads plugin frames until a response arrives, checking every `rim.log` and
/// `rim.settings.get` on the way; the settings requests go unanswered.
async fn next_response(stdout: &mut (impl tokio::io::AsyncRead + Unpin)) -> Value {
    loop {
        let frame = tokio::time::timeout(WAIT, wire::read_raw_frame(stdout))
            .await
            .expect("plugin answered in time")
            .expect("plugin frame is valid");
        if frame.get("method") == Some(&json!(method::SETTINGS_GET)) {
            assert_valid("SettingsGetRequest", &frame);
            continue;
        }
        if frame.get("method").is_some() {
            assert_valid("LogRequest", &frame);
            continue;
        }
        return frame;
    }
}

async fn ask(
    stdin: &mut (impl tokio::io::AsyncWrite + Unpin),
    stdout: &mut (impl tokio::io::AsyncRead + Unpin),
    request: &Value,
) -> Value {
    wire::write_frame(stdin, request).await.unwrap();
    let response = next_response(stdout).await;
    assert_eq!(response["id"], request["id"], "the plugin echoes the id");
    response
}

/// Waits for a plugin that was told to exit, failing after fifteen seconds.
async fn wait_for_exit(process: &mut PluginProcess) -> std::process::ExitStatus {
    for _ in 0..750 {
        if let Some(status) = process.try_wait().unwrap() {
            return status;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("plugin {} did not exit", process.plugin_id());
}

#[tokio::test]
async fn hello_world_speaks_v1() {
    if std::process::Command::new("python3")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: python3 is not installed");
        return;
    }
    let manifest = hello_world_manifest();
    let (mut process, pipes) =
        PluginProcess::spawn(HELLO_WORLD, &hello_world_dir(), &manifest.entrypoint).unwrap();
    let (mut stdin, mut stdout) = (pipes.stdin, pipes.stdout);

    let mut handshake = example("HandshakeRequest");
    handshake["params"]["supportedVersions"] = json!([2, 1]);
    handshake["params"]["protocolVersion"] = json!(2);
    let response = ask(&mut stdin, &mut stdout, &handshake).await;
    assert_valid("HandshakeResponse", &response);
    assert_eq!(response["result"]["accepted"], true);
    assert_eq!(
        response["result"]["protocolVersion"], 1,
        "a v1 plugin picks v1 from the host's list"
    );

    let heartbeat = example("HeartbeatRequest");
    let response = ask(&mut stdin, &mut stdout, &heartbeat).await;
    assert_valid("HeartbeatResponse", &response);

    let response = ask(&mut stdin, &mut stdout, &example("CommandExecuteRequest")).await;
    assert_valid("CommandExecuteResponse", &response);
    assert_eq!(response, example("CommandExecuteResponse"));

    let mut unknown = example("CommandExecuteRequest");
    unknown["id"] = json!(3);
    unknown["params"]["commandId"] = json!("rm_rf");
    let response = ask(&mut stdin, &mut stdout, &unknown).await;
    assert_valid("ErrorResponse", &response);
    assert_eq!(response["error"]["code"], wire::INVALID_PARAMS);

    let mut unknown_method = example("HeartbeatRequest");
    unknown_method["id"] = json!(4);
    unknown_method["method"] = json!("rim.future.method");
    let response = ask(&mut stdin, &mut stdout, &unknown_method).await;
    assert_eq!(response["error"]["code"], wire::METHOD_NOT_FOUND);

    // Unknown notifications are ignored; the plugin keeps answering.
    let unknown_notice = json!({"jsonrpc": "2.0", "method": "rim.future.notice"});
    wire::write_frame(&mut stdin, &unknown_notice)
        .await
        .unwrap();
    wire::write_frame(&mut stdin, &example("PrincipalChangedNotification"))
        .await
        .unwrap();
    let mut heartbeat = heartbeat;
    heartbeat["id"] = json!(-2);
    let response = ask(&mut stdin, &mut stdout, &heartbeat).await;
    assert_valid("HeartbeatResponse", &response);

    // rim.shutdown alone makes it exit, before stdin closes.
    wire::write_frame(&mut stdin, &example("ShutdownNotification"))
        .await
        .unwrap();
    let status = wait_for_exit(&mut process).await;
    assert!(status.success(), "clean exit: {status:?}");
    drop(stdin);
}

#[tokio::test]
async fn hello_world_refuses_a_host_without_v1() {
    if std::process::Command::new("python3")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping: python3 is not installed");
        return;
    }
    let manifest = hello_world_manifest();
    let (_process, pipes) =
        PluginProcess::spawn(HELLO_WORLD, &hello_world_dir(), &manifest.entrypoint).unwrap();
    let (mut stdin, mut stdout) = (pipes.stdin, pipes.stdout);

    let mut handshake = example("HandshakeRequest");
    handshake["params"]["supportedVersions"] = json!([2]);
    handshake["params"]["protocolVersion"] = json!(2);
    let response = ask(&mut stdin, &mut stdout, &handshake).await;
    assert_valid("HandshakeResponse", &response);
    assert_eq!(response["result"]["accepted"], false);
    assert!(response["result"]["error"].is_string());
}

// ── The TypeScript SDK template ──

fn template_ts_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins/template-ts")
}

fn template_ts_manifest() -> PluginManifest {
    PluginManifest::load(&template_ts_dir().join("rim-plugin.json")).expect("template-ts manifest")
}

/// The TypeScript plugins run from source: Node 22.18+ runs their TypeScript as
/// is, and they import the SDK by its package name, which resolves to the SDK's
/// build (`npm ci` and `npm run sdk:build` at the repository root).
fn node_runs_typescript() -> bool {
    let runs = std::process::Command::new("node")
        .args(["-e", "process.exit(process.features.typescript ? 0 : 1)"])
        .output()
        .is_ok_and(|out| out.status.success());
    if !runs {
        eprintln!("skipping: needs Node 22.18 or newer on PATH");
        return false;
    }
    let sdk_built = std::process::Command::new("node")
        .args([
            "--input-type=module",
            "-e",
            "await import('@rim-platform/plugin-sdk')",
        ])
        .current_dir(template_ts_dir())
        .output()
        .is_ok_and(|out| out.status.success());
    if !sdk_built {
        eprintln!("skipping: the plugin SDK is not built; run npm ci and npm run sdk:build");
    }
    sdk_built
}

fn execute_frame(id: i64, command_id: &str, initiator: &str, confirmed: bool) -> Value {
    let mut frame = example("CommandExecuteRequest");
    frame["id"] = json!(id);
    frame["params"]["commandId"] = json!(command_id);
    frame["params"]["args"] = json!({});
    frame["params"]["initiator"] = json!(initiator);
    frame["params"]["confirmed"] = json!(confirmed);
    frame
}

#[test]
fn template_ts_manifest_installs() {
    let manifest = template_ts_manifest();
    validate_plugin_manifest(&manifest).expect("the template passes install validation");
    let dangerous: Vec<_> = manifest.commands.iter().map(|c| c.dangerous).collect();
    assert_eq!(
        dangerous,
        [false, true],
        "one safe and one dangerous command"
    );
}

#[tokio::test]
async fn template_ts_speaks_v1() {
    if !node_runs_typescript() {
        return;
    }
    let manifest = template_ts_manifest();
    let (mut process, pipes) =
        PluginProcess::spawn(TEMPLATE_TS, &template_ts_dir(), &manifest.entrypoint).unwrap();
    let (mut stdin, mut stdout) = (pipes.stdin, pipes.stdout);

    // Unknown fields anywhere are ignored, and the plugin picks v1 from the list.
    let mut handshake = example("HandshakeRequest");
    handshake["params"]["pluginId"] = json!(TEMPLATE_TS);
    handshake["params"]["supportedVersions"] = json!([2, 1]);
    handshake["params"]["protocolVersion"] = json!(2);
    handshake["params"]["futureField"] = json!({"nested": true});
    handshake["params"]["principal"]["futureField"] = json!(1);
    let response = ask(&mut stdin, &mut stdout, &handshake).await;
    assert_valid("HandshakeResponse", &response);
    assert_eq!(
        response["result"],
        json!({"accepted": true, "protocolVersion": 1, "pluginId": TEMPLATE_TS})
    );

    let response = ask(&mut stdin, &mut stdout, &example("HeartbeatRequest")).await;
    assert_valid("HeartbeatResponse", &response);

    let mut greet = example("CommandExecuteRequest");
    greet["params"]["futureField"] = json!(true);
    let response = ask(&mut stdin, &mut stdout, &greet).await;
    assert_valid("CommandExecuteResponse", &response);
    assert_eq!(response["result"]["payload"], "Hello, RIM!");

    let response = ask(
        &mut stdin,
        &mut stdout,
        &execute_frame(3, "rm_rf", "user", false),
    )
    .await;
    assert_valid("ErrorResponse", &response);
    assert_eq!(response["error"]["code"], wire::INVALID_PARAMS);

    // The SDK refuses a dangerous command that arrives unconfirmed or from the
    // agent, even though the host never sends one.
    for (id, initiator, confirmed) in [(4, "user", false), (5, "agent", true)] {
        let frame = execute_frame(id, "reset_greetings", initiator, confirmed);
        let response = ask(&mut stdin, &mut stdout, &frame).await;
        assert_valid("ErrorResponse", &response);
        assert_eq!(response["error"]["code"], wire::PLUGIN_ERROR);
    }
    let frame = execute_frame(6, "reset_greetings", "user", true);
    let response = ask(&mut stdin, &mut stdout, &frame).await;
    assert_valid("CommandExecuteResponse", &response);
    assert_eq!(response["result"]["payload"], json!({"cleared": 1}));

    let mut unknown_method = example("HeartbeatRequest");
    unknown_method["id"] = json!(7);
    unknown_method["method"] = json!("rim.future.method");
    let response = ask(&mut stdin, &mut stdout, &unknown_method).await;
    assert_valid("ErrorResponse", &response);
    assert_eq!(response["error"]["code"], wire::METHOD_NOT_FOUND);

    // The plugin greets with the greeting the user saved.
    let mut settings = example("SettingsChangedNotification");
    settings["params"]["values"] = json!({"greeting": "Howdy"});
    wire::write_frame(&mut stdin, &settings).await.unwrap();
    let response = ask(
        &mut stdin,
        &mut stdout,
        &execute_frame(8, "greet", "user", false),
    )
    .await;
    assert_valid("CommandExecuteResponse", &response);
    assert_eq!(response["result"]["payload"], "Howdy, Jakub!");

    let unknown_notice = json!({"jsonrpc": "2.0", "method": "rim.future.notice"});
    wire::write_frame(&mut stdin, &unknown_notice)
        .await
        .unwrap();
    wire::write_frame(&mut stdin, &example("PrincipalChangedNotification"))
        .await
        .unwrap();
    let mut heartbeat = example("HeartbeatRequest");
    heartbeat["id"] = json!(-2);
    let response = ask(&mut stdin, &mut stdout, &heartbeat).await;
    assert_valid("HeartbeatResponse", &response);

    wire::write_frame(&mut stdin, &example("ShutdownNotification"))
        .await
        .unwrap();
    let status = wait_for_exit(&mut process).await;
    assert!(status.success(), "clean exit: {status:?}");
    drop(stdin);
}

#[tokio::test]
async fn template_ts_refuses_a_host_without_v1() {
    if !node_runs_typescript() {
        return;
    }
    let manifest = template_ts_manifest();
    let (_process, pipes) =
        PluginProcess::spawn(TEMPLATE_TS, &template_ts_dir(), &manifest.entrypoint).unwrap();
    let (mut stdin, mut stdout) = (pipes.stdin, pipes.stdout);

    let mut handshake = example("HandshakeRequest");
    handshake["params"]["pluginId"] = json!(TEMPLATE_TS);
    handshake["params"]["supportedVersions"] = json!([2]);
    handshake["params"]["protocolVersion"] = json!(2);
    let response = ask(&mut stdin, &mut stdout, &handshake).await;
    assert_valid("HandshakeResponse", &response);
    assert_eq!(response["result"]["accepted"], false);
    assert_eq!(response["result"]["protocolVersion"], 1);
    assert!(response["result"]["error"].is_string());
}

#[tokio::test]
async fn template_ts_runs_through_the_host() {
    if !node_runs_typescript() {
        return;
    }
    let manifest = template_ts_manifest();
    let host = SettingsFixture::new(vec![manifest.clone()]);
    let state = &host.state;
    *state.principal.lock().unwrap() = Some(principal());
    host.sign_in(Some(&principal().principal_id));
    state
        .plugin_dirs
        .lock()
        .unwrap()
        .insert(TEMPLATE_TS.into(), template_ts_dir());
    runtime::start_plugin(TEMPLATE_TS, &manifest, state).unwrap();
    // The host registers the plugin's client once the handshake is accepted.
    for _ in 0..750 {
        if state.clients.lock().unwrap().contains_key(TEMPLATE_TS) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let run = |command: &'static str, confirmed: bool| {
        command_exec::execute(
            state,
            TEMPLATE_TS,
            command,
            json!({}),
            confirmed,
            None,
            Initiator::User,
        )
    };
    // A save reaches the running plugin before the next command does.
    host.save(
        TEMPLATE_TS,
        &principal().principal_id,
        json!({"greeting": "Hi"}),
    );
    settings::on_saved(state, TEMPLATE_TS);
    let greeting = run("greet", false).await.expect("greet runs");
    assert_eq!(greeting.payload, json!("Hi, Jakub!"));
    assert!(
        run("reset_greetings", false).await.is_err(),
        "the host refuses an unconfirmed dangerous command"
    );
    let reset = run("reset_greetings", true)
        .await
        .expect("confirmed reset runs");
    assert_eq!(reset.payload, json!({"cleared": 1}));

    runtime::stop_plugin(TEMPLATE_TS, state).await.unwrap();
}

// ── A plugin with a panel ──

fn panel_ts_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/plugin_host/test_plugins/panel-ts")
}

/// The next state the panel relay pushes, which must be the test plugin's `main` panel.
async fn next_panel_state(
    changes: &mut tokio::sync::broadcast::Receiver<
        crate::plugin_host::panel_relay::PanelStateChange,
    >,
) -> Value {
    let change = tokio::time::timeout(WAIT, changes.recv())
        .await
        .expect("the panel state arrived in time")
        .expect("panel state changes arrive");
    assert_eq!(
        (change.plugin_id.as_str(), change.panel_id.as_str()),
        (PANEL_TS, "main")
    );
    change.state
}

#[tokio::test]
async fn a_plugin_fills_its_panel_through_the_host() {
    if !node_runs_typescript() {
        return;
    }
    let manifest =
        PluginManifest::load(&panel_ts_dir().join("rim-plugin.json")).expect("panel-ts manifest");
    validate_plugin_manifest(&manifest).expect("the test plugin passes install validation");
    let state = PluginHostState::with_installed(vec![manifest.clone()]);
    {
        let mut store = state.store.lock().unwrap();
        crate::plugin_host::lifecycle::approve_capabilities(
            &mut store,
            &manifest,
            &["ui.panel".into()],
        )
        .unwrap();
    }
    *state.principal.lock().unwrap() = Some(principal());
    state
        .plugin_dirs
        .lock()
        .unwrap()
        .insert(PANEL_TS.into(), panel_ts_dir());
    let mut changes = state.panel_relay.subscribe();
    let mut events = state.events.subscribe();
    runtime::start_plugin(PANEL_TS, &manifest, &state).unwrap();

    // The plugin's first state is pushed live, and stored for a panel that opens later.
    let first = next_panel_state(&mut changes).await;
    assert_eq!(first, json!({"greeting": "Hello, Jakub!", "count": 0}));
    assert_eq!(
        state.panel_relay.get_state(PANEL_TS, "main").unwrap(),
        Some(first)
    );

    // A patch merges into the stored state, and the whole merged state is pushed.
    let counted = command_exec::execute(
        &state,
        PANEL_TS,
        "count",
        json!({}),
        false,
        None,
        Initiator::User,
    )
    .await
    .expect("count runs");
    assert_eq!(counted.payload, json!({"count": 1}));
    let merged = json!({"greeting": "Hello, Jakub!", "count": 1});
    assert_eq!(next_panel_state(&mut changes).await, merged);
    assert_eq!(
        state.panel_relay.get_state(PANEL_TS, "main").unwrap(),
        Some(merged)
    );

    // Stopping the plugin clears what its panel showed.
    runtime::stop_plugin(PANEL_TS, &state).await.unwrap();
    assert_eq!(state.panel_relay.get_state(PANEL_TS, "main").unwrap(), None);

    // The UI heard the plugin come up and go away, so its plugin list follows.
    let mut kinds = Vec::new();
    while kinds.len() < 2 {
        let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
            .await
            .expect("the plugin's start and stop are announced")
            .unwrap();
        assert_eq!(event.plugin_id, PANEL_TS);
        kinds.push(event.kind);
    }
    assert_eq!(
        kinds,
        [
            PluginEventKind::PluginStarted,
            PluginEventKind::PluginStopped
        ]
    );
}
