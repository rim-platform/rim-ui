use crate::plugin_host::capability::{self, CapabilityGate, CHAT_METHODS};
use crate::plugin_host::chat_relay::ChatRelay;
use crate::plugin_host::panel_relay::PanelRelay;
use crate::plugin_host::protocol::{method, LogLevel, LogParams};
use crate::plugin_host::settings::{SettingsReadError, SettingsReader};
use crate::plugin_host::wire::{
    self, JsonRpcError, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, WireError,
    CAPABILITY_DENIED, INTERNAL_ERROR, METHOD_NOT_FOUND, RATE_LIMITED,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{sleep_until, timeout, Instant};

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_RATE_LIMIT: u32 = 120; // calls per minute per capability
const OUTBOUND_QUEUE: usize = 32;
const INCOMING_QUEUE: usize = 32;
/// How long the loop may spend telling the plugin to shut down before it closes stdin.
const SHUTDOWN_NOTICE_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug)]
struct RateLimitBucket {
    count: u32,
    window_start: Instant,
}

impl RateLimitBucket {
    fn new() -> Self {
        Self {
            count: 0,
            window_start: Instant::now(),
        }
    }

    fn check_and_increment(&mut self, limit: u32) -> bool {
        let now = Instant::now();
        if now.duration_since(self.window_start) >= Duration::from_secs(60) {
            self.count = 0;
            self.window_start = now;
        }
        if self.count >= limit {
            return false;
        }
        self.count += 1;
        true
    }
}

pub struct BrokerConfig {
    /// Max calls per minute per capability. Key is capability name, value is limit.
    pub rate_limits: HashMap<String, u32>,
    pub default_rate_limit: u32,
}

impl Default for BrokerConfig {
    fn default() -> Self {
        Self {
            rate_limits: HashMap::new(),
            default_rate_limit: DEFAULT_RATE_LIMIT,
        }
    }
}

pub struct PluginBroker {
    plugin_id: String,
    gate: CapabilityGate,
    config: BrokerConfig,
    rate_buckets: HashMap<String, RateLimitBucket>,
    next_heartbeat_id: i64,
    pub responsive: bool,
    panel_relay: Option<Arc<PanelRelay>>,
    /// Panel IDs declared in this plugin's manifest — for ownership verification.
    manifest_panel_ids: Vec<String>,
    /// Where `rim.chat.*` calls go; without it they are METHOD_NOT_FOUND.
    chat_relay: Option<Arc<ChatRelay>>,
    /// Reads this plugin's settings; without it `rim.settings.get` is METHOD_NOT_FOUND
    /// and no `rim.settings.changed` is sent.
    settings: Option<SettingsReader>,
}

/// How the broker answers one admitted plugin request.
pub enum Routed {
    /// The answer is ready.
    Done(JsonRpcResponse),
    /// The UI's message service answers it; run the call off the broker loop.
    Chat(ChatCall),
}

/// A `rim.chat.*` call on its way to the UI.
pub struct ChatCall {
    relay: Arc<ChatRelay>,
    id: serde_json::Value,
    plugin_id: String,
    method: String,
    params: serde_json::Value,
    granted: Vec<String>,
}

impl ChatCall {
    /// Waits for the UI's answer and returns it as the response to the plugin.
    pub async fn run(self) -> JsonRpcResponse {
        match self
            .relay
            .call(&self.plugin_id, &self.method, self.params, self.granted)
            .await
        {
            Ok(result) => JsonRpcResponse::success(self.id, result),
            Err(error) => JsonRpcResponse {
                jsonrpc: "2.0".into(),
                result: None,
                error: Some(error),
                id: self.id,
            },
        }
    }
}

impl PluginBroker {
    pub fn new(plugin_id: String, gate: CapabilityGate, config: BrokerConfig) -> Self {
        Self {
            plugin_id,
            gate,
            config,
            rate_buckets: HashMap::new(),
            next_heartbeat_id: -1,
            responsive: true,
            panel_relay: None,
            manifest_panel_ids: vec![],
            chat_relay: None,
            settings: None,
        }
    }

    /// Serves `rim.settings.get` and `rim.settings.changed` from `settings`.
    pub fn with_settings(mut self, settings: SettingsReader) -> Self {
        self.settings = Some(settings);
        self
    }

    pub fn with_chat_relay(mut self, relay: Arc<ChatRelay>) -> Self {
        self.chat_relay = Some(relay);
        self
    }

    pub fn with_panel_relay(mut self, relay: Arc<PanelRelay>, panel_ids: Vec<String>) -> Self {
        self.panel_relay = Some(relay);
        self.manifest_panel_ids = panel_ids;
        self
    }

    /// Handles an incoming JSON-RPC request from the plugin, waiting for a relayed
    /// chat call's answer.
    #[cfg(test)]
    pub async fn handle_request(&mut self, request: &JsonRpcRequest) -> JsonRpcResponse {
        match self.route(request).await {
            Routed::Done(response) => response,
            Routed::Chat(call) => call.run().await,
        }
    }

    /// Admits a request (capability, rate limit) and answers it, or hands back the
    /// chat call that answers it.
    pub async fn route(&mut self, request: &JsonRpcRequest) -> Routed {
        match self.refusal(request) {
            Some(response) => Routed::Done(response),
            None => match (
                &self.chat_relay,
                CHAT_METHODS.contains(&request.method.as_str()),
            ) {
                (Some(relay), true) => Routed::Chat(ChatCall {
                    relay: relay.clone(),
                    id: request.id.clone(),
                    plugin_id: self.plugin_id.clone(),
                    method: request.method.clone(),
                    params: request
                        .params
                        .clone()
                        .unwrap_or_else(|| serde_json::json!({})),
                    granted: self.gate.approved().to_vec(),
                }),
                _ => Routed::Done(self.dispatch(request).await),
            },
        }
    }

    /// The error answer of a request the capability gate or its rate limit refuses.
    fn refusal(&mut self, request: &JsonRpcRequest) -> Option<JsonRpcResponse> {
        // Check the capability.
        if let Err(required_cap) = self.gate.check(&request.method) {
            log::warn!(
                "plugin {} denied: method={} requires capability={}",
                self.plugin_id,
                request.method,
                required_cap
            );
            return Some(JsonRpcResponse::error(
                request.id.clone(),
                CAPABILITY_DENIED,
                format!("capability denied: {required_cap}"),
            ));
        }

        // Check the rate limit.
        if let Some(cap) = capability::capability_for_method(&request.method) {
            let cap_string = cap.to_string();
            let limit = self
                .config
                .rate_limits
                .get(cap)
                .copied()
                .unwrap_or(self.config.default_rate_limit);
            let bucket = self
                .rate_buckets
                .entry(cap_string.clone())
                .or_insert_with(RateLimitBucket::new);
            if !bucket.check_and_increment(limit) {
                log::warn!(
                    "plugin {} rate limited: method={} capability={}",
                    self.plugin_id,
                    request.method,
                    cap_string
                );
                return Some(JsonRpcResponse::error(
                    request.id.clone(),
                    RATE_LIMITED,
                    format!("rate limit exceeded for capability: {cap_string}"),
                ));
            }
        }
        None
    }

    async fn dispatch(&self, request: &JsonRpcRequest) -> JsonRpcResponse {
        let method = request.method.as_str();
        match method {
            method::LOG => self.handle_log(request),
            method::SETTINGS_GET => self.handle_settings_get(request).await,
            "rim.ui.update_panel" => self.handle_update_panel(request),
            _ => JsonRpcResponse::error(
                request.id.clone(),
                METHOD_NOT_FOUND,
                format!("method not found: {}", request.method),
            ),
        }
    }

    fn handle_log(&self, request: &JsonRpcRequest) -> JsonRpcResponse {
        let params = request.params.clone().unwrap_or(serde_json::Value::Null);
        let params: LogParams = match serde_json::from_value(params) {
            Ok(params) => params,
            Err(e) => {
                return JsonRpcResponse::error(
                    request.id.clone(),
                    wire::INVALID_PARAMS,
                    format!("invalid rim.log params: {e}"),
                );
            }
        };
        let level = match params.level {
            LogLevel::Debug => log::Level::Debug,
            LogLevel::Info => log::Level::Info,
            LogLevel::Warn => log::Level::Warn,
            LogLevel::Error => log::Level::Error,
        };
        log::log!(level, "[plugin:{}] {}", self.plugin_id, params.message);
        JsonRpcResponse::success(request.id.clone(), serde_json::json!({"ok": true}))
    }

    /// `rim.settings.get`: this connection's plugin's settings, for the account
    /// signed in now. Params are ignored.
    async fn handle_settings_get(&self, request: &JsonRpcRequest) -> JsonRpcResponse {
        match self.read_settings().await {
            Some(Ok(values)) => JsonRpcResponse::success(
                request.id.clone(),
                serde_json::json!({ "values": values }),
            ),
            Some(Err(e)) => JsonRpcResponse {
                jsonrpc: "2.0".into(),
                result: None,
                error: Some(e.to_rpc_error()),
                id: request.id.clone(),
            },
            None => JsonRpcResponse::error(
                request.id.clone(),
                METHOD_NOT_FOUND,
                format!("method not found: {}", request.method),
            ),
        }
    }

    /// This plugin's settings as they are now, read off the loop's thread since
    /// a secret's first read can wait on the keyring; `None` without a reader.
    async fn read_settings(
        &self,
    ) -> Option<Result<serde_json::Map<String, serde_json::Value>, SettingsReadError>> {
        let reader = self.settings.clone()?;
        Some(
            tokio::task::spawn_blocking(move || reader.read())
                .await
                .unwrap_or_else(|e| Err(SettingsReadError::Io(e.to_string()))),
        )
    }

    /// The `rim.settings.changed` notice with the settings as they are now, or
    /// `None` when there is nothing to send: no reader, or a failed read, which
    /// the plugin's next `rim.settings.get` reports.
    async fn settings_changed_notice(&self) -> Option<JsonRpcNotification> {
        match self.read_settings().await? {
            Ok(values) => Some(JsonRpcNotification::new(
                method::SETTINGS_CHANGED,
                Some(serde_json::json!({ "values": values })),
            )),
            Err(e) => {
                log::warn!(
                    "[plugin_host] settings of {} not sent: {}",
                    self.plugin_id,
                    e
                );
                None
            }
        }
    }

    fn handle_update_panel(&self, request: &JsonRpcRequest) -> JsonRpcResponse {
        let relay = match &self.panel_relay {
            Some(r) => r,
            None => {
                return JsonRpcResponse::error(
                    request.id.clone(),
                    INTERNAL_ERROR,
                    "panel relay not configured",
                );
            }
        };

        let params = request
            .params
            .as_ref()
            .cloned()
            .unwrap_or(serde_json::json!({}));
        let panel_id = match params.get("panel_id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => {
                return JsonRpcResponse::error(
                    request.id.clone(),
                    wire::INVALID_PARAMS,
                    "missing required param: panel_id",
                );
            }
        };

        // The plugin must own the panel.
        if !self.manifest_panel_ids.contains(&panel_id) {
            return JsonRpcResponse::error(
                request.id.clone(),
                CAPABILITY_DENIED,
                format!(
                    "panel '{}' is not declared in plugin '{}' manifest",
                    panel_id, self.plugin_id
                ),
            );
        }

        let state = match params.get("state") {
            Some(s) => s.clone(),
            None => {
                return JsonRpcResponse::error(
                    request.id.clone(),
                    wire::INVALID_PARAMS,
                    "missing required param: state",
                );
            }
        };

        let patch = params
            .get("patch")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let result = if patch {
            relay
                .patch_state(&self.plugin_id, &panel_id, state)
                .map(|merged| serde_json::json!({"panel_id": panel_id, "state": merged}))
        } else {
            relay
                .set_state(&self.plugin_id, &panel_id, state.clone())
                .map(|_| serde_json::json!({"panel_id": panel_id, "state": state}))
        };

        match result {
            Ok(data) => JsonRpcResponse::success(request.id.clone(), data),
            Err(e) => JsonRpcResponse::error(request.id.clone(), INTERNAL_ERROR, e.to_string()),
        }
    }

    pub fn create_heartbeat_ping(&mut self) -> JsonRpcRequest {
        let id = self.next_heartbeat_id;
        self.next_heartbeat_id -= 1;
        JsonRpcRequest::new(method::HEARTBEAT, None, id)
    }

    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }
}

/// A host → plugin message waiting for the broker loop to send it.
pub enum OutboundRequest {
    /// A request; the plugin's response goes to `reply`.
    Request {
        method: String,
        params: Option<serde_json::Value>,
        reply: oneshot::Sender<JsonRpcResponse>,
    },
    /// A notification: no id, and no response is expected.
    Notification {
        method: String,
        params: Option<serde_json::Value>,
    },
    /// `rim.settings.changed`, with the settings read when the loop sends it. The
    /// loop also answers `rim.settings.get`, so every set the plugin receives was
    /// read after the one before it.
    SettingsChanged,
}

/// Why a host → plugin request did not produce a result.
#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    /// The broker loop is gone: the plugin exited, was stopped, or broke the framing.
    #[error("plugin connection closed")]
    Closed,
    #[error("plugin did not answer within {0:?}")]
    TimedOut(Duration),
    /// The plugin answered with a JSON-RPC error.
    #[error("plugin error {}: {}", .0.code, .0.message)]
    Plugin(JsonRpcError),
}

/// Cloneable handle for sending requests to one running plugin process.
///
/// Requests are written by the broker loop that owns the plugin's stdio, and the
/// plugin's response is matched back by JSON-RPC id, so a plugin may call the
/// broker (e.g. `rim.ui.update_panel`) while it is still working on a host request.
#[derive(Debug, Clone)]
pub struct PluginClient {
    tx: mpsc::Sender<OutboundRequest>,
}

impl PluginClient {
    /// Creates a client and the receiver to pass to [`run_broker_loop`].
    pub fn channel() -> (Self, mpsc::Receiver<OutboundRequest>) {
        let (tx, rx) = mpsc::channel(OUTBOUND_QUEUE);
        (Self { tx }, rx)
    }

    /// Sends `method` to the plugin and waits up to `wait` for its result.
    ///
    /// Dropping the returned future (or timing out) abandons the request; the
    /// broker loop discards the plugin's late response.
    ///
    /// # Errors
    ///
    /// Returns [`RequestError::Closed`] when the broker loop is gone,
    /// [`RequestError::TimedOut`] after `wait`, and [`RequestError::Plugin`] when
    /// the plugin answers with a JSON-RPC error.
    pub async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
        wait: Duration,
    ) -> Result<serde_json::Value, RequestError> {
        let (reply, response) = oneshot::channel();
        let outbound = OutboundRequest::Request {
            method: method.to_string(),
            params,
            reply,
        };
        let exchange = async {
            self.tx
                .send(outbound)
                .await
                .map_err(|_| RequestError::Closed)?;
            response.await.map_err(|_| RequestError::Closed)
        };
        let response = timeout(wait, exchange)
            .await
            .map_err(|_| RequestError::TimedOut(wait))??;
        match (response.error, response.result) {
            (Some(error), _) => Err(RequestError::Plugin(error)),
            (None, result) => Ok(result.unwrap_or(serde_json::Value::Null)),
        }
    }

    /// Sends `method` to the plugin as a notification, without waiting for anything.
    ///
    /// # Errors
    ///
    /// Returns [`RequestError::Closed`] when the broker loop is gone.
    pub async fn notify(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), RequestError> {
        let outbound = OutboundRequest::Notification {
            method: method.to_string(),
            params,
        };
        self.tx
            .send(outbound)
            .await
            .map_err(|_| RequestError::Closed)
    }

    /// Sends `rim.settings.changed` to the plugin with its settings as they are when
    /// the broker loop writes it. Nothing is sent when the read fails.
    ///
    /// # Errors
    ///
    /// Returns [`RequestError::Closed`] when the broker loop is gone.
    pub async fn settings_changed(&self) -> Result<(), RequestError> {
        self.tx
            .send(OutboundRequest::SettingsChanged)
            .await
            .map_err(|_| RequestError::Closed)
    }

    /// Queues `rim.settings.changed` as [`Self::settings_changed`] does, without
    /// waiting. Returns `false` when the queue is full, so the caller sends it
    /// with [`Self::settings_changed`] instead; a closed loop has nobody to tell.
    pub fn try_settings_changed(&self) -> bool {
        !matches!(
            self.tx.try_send(OutboundRequest::SettingsChanged),
            Err(mpsc::error::TrySendError::Full(_))
        )
    }

    /// True when both handles talk to the same broker loop.
    pub fn same_connection(&self, other: &PluginClient) -> bool {
        self.tx.same_channel(&other.tx)
    }
}

/// One frame from the plugin, sorted by JSON-RPC shape.
enum Incoming {
    Request(JsonRpcRequest),
    Notification(JsonRpcRequest),
    Response(JsonRpcResponse),
    Invalid(String),
}

fn classify(frame: serde_json::Value) -> Incoming {
    let has_method = frame.get("method").is_some();
    let has_id = frame.get("id").is_some_and(|id| !id.is_null());
    match (has_method, has_id) {
        (true, true) => serde_json::from_value(frame)
            .map(Incoming::Request)
            .unwrap_or_else(|e| Incoming::Invalid(e.to_string())),
        (true, false) => {
            let mut frame = frame;
            frame["id"] = serde_json::Value::Null;
            serde_json::from_value(frame)
                .map(Incoming::Notification)
                .unwrap_or_else(|e| Incoming::Invalid(e.to_string()))
        }
        (false, true) => serde_json::from_value(frame)
            .map(Incoming::Response)
            .unwrap_or_else(|e| Incoming::Invalid(e.to_string())),
        (false, false) => Incoming::Invalid("frame has neither method nor id".into()),
    }
}

/// Map key for a JSON-RPC id. Plugins echo ids back verbatim, so the JSON text is stable.
fn id_key(id: &serde_json::Value) -> String {
    id.to_string()
}

/// Aborts the stdout reader task when the broker loop ends or is dropped.
struct AbortOnDrop(tokio::task::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Runs the broker loop for one plugin connection until shutdown or disconnect.
///
/// The loop owns the plugin's stdin and is the only writer. A separate task reads
/// stdout frame by frame (a partially read frame is never cancelled), and the loop
/// routes each frame by shape: plugin requests go to the [`PluginBroker`], responses
/// complete the matching [`PluginClient::request`] or heartbeat. When the loop ends,
/// every pending request fails with [`RequestError::Closed`].
pub async fn run_broker_loop<R, W>(
    mut broker: PluginBroker,
    reader: R,
    mut writer: W,
    mut outbound_rx: mpsc::Receiver<OutboundRequest>,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
) where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send,
{
    let (frame_tx, mut frame_rx) = mpsc::channel(INCOMING_QUEUE);
    let _reader_task = AbortOnDrop(tokio::spawn(async move {
        let mut reader = reader;
        loop {
            let frame = wire::read_raw_frame(&mut reader).await;
            let stop = frame.is_err();
            if frame_tx.send(frame).await.is_err() || stop {
                break;
            }
        }
    }));

    let mut pending: HashMap<String, oneshot::Sender<JsonRpcResponse>> = HashMap::new();
    // Answers of chat calls, which run off the loop so it keeps serving heartbeats
    // and other calls while the UI works.
    let (answer_tx, mut answer_rx) = mpsc::channel::<JsonRpcResponse>(INCOMING_QUEUE);
    let mut next_request_id: i64 = 1;
    let mut heartbeat: Option<(String, Instant)> = None;
    let mut heartbeat_interval = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat_interval.tick().await; // skip first immediate tick

    loop {
        let heartbeat_deadline = heartbeat.as_ref().map(|(_, deadline)| *deadline);
        tokio::select! {
            changed = shutdown_rx.changed() => {
                if changed.is_err() || *shutdown_rx.borrow() {
                    log::info!("broker loop shutting down for plugin {}", broker.plugin_id());
                    // Best effort: a plugin that stopped reading must not hold up the stop.
                    // Returning drops the writer, which closes the plugin's stdin.
                    let notice = JsonRpcNotification::new(method::SHUTDOWN, None);
                    let _ = timeout(
                        SHUTDOWN_NOTICE_TIMEOUT,
                        wire::write_frame(&mut writer, &notice),
                    )
                    .await;
                    break;
                }
            }
            _ = heartbeat_interval.tick() => {
                let ping = broker.create_heartbeat_ping();
                if wire::write_frame(&mut writer, &ping).await.is_err() {
                    log::warn!("failed to send heartbeat, plugin may have exited");
                    break;
                }
                heartbeat = Some((id_key(&ping.id), Instant::now() + HEARTBEAT_TIMEOUT));
            }
            _ = sleep_until(heartbeat_deadline.unwrap_or_else(Instant::now)),
                if heartbeat_deadline.is_some() =>
            {
                log::warn!("heartbeat timeout — plugin {} unresponsive", broker.plugin_id());
                broker.responsive = false;
                heartbeat = None;
            }
            Some(answer) = answer_rx.recv() => {
                if wire::write_frame(&mut writer, &answer).await.is_err() {
                    log::warn!("failed to write response to plugin");
                    break;
                }
            }
            Some(outbound) = outbound_rx.recv() => {
                let (method, params, reply) = match outbound {
                    OutboundRequest::Request { method, params, reply } => (method, params, reply),
                    OutboundRequest::Notification { method, params } => {
                        let notification = JsonRpcNotification::new(method, params);
                        if wire::write_frame(&mut writer, &notification).await.is_err() {
                            log::warn!("failed to send notification to plugin {}", broker.plugin_id());
                            break;
                        }
                        continue;
                    }
                    OutboundRequest::SettingsChanged => {
                        let Some(notification) = broker.settings_changed_notice().await else {
                            continue;
                        };
                        if wire::write_frame(&mut writer, &notification).await.is_err() {
                            log::warn!("failed to send settings to plugin {}", broker.plugin_id());
                            break;
                        }
                        continue;
                    }
                };
                // Forget requests whose callers gave up (timeout or cancellation).
                pending.retain(|_, reply| !reply.is_closed());
                let id = next_request_id;
                next_request_id += 1;
                let request = JsonRpcRequest::new(method, params, id);
                pending.insert(id_key(&request.id), reply);
                if wire::write_frame(&mut writer, &request).await.is_err() {
                    log::warn!("failed to send request to plugin {}", broker.plugin_id());
                    break;
                }
            }
            frame = frame_rx.recv() => {
                let frame = match frame {
                    Some(Ok(frame)) => frame,
                    Some(Err(WireError::Json(e))) => {
                        // The length prefix was read in full, so framing is intact.
                        log::warn!("plugin {} sent invalid JSON: {}", broker.plugin_id(), e);
                        continue;
                    }
                    Some(Err(WireError::ConnectionClosed)) | None => {
                        log::info!("plugin {} connection closed", broker.plugin_id());
                        break;
                    }
                    Some(Err(e)) => {
                        log::warn!("error reading from plugin {}: {}", broker.plugin_id(), e);
                        break;
                    }
                };
                match classify(frame) {
                    Incoming::Request(request) => match broker.route(&request).await {
                        Routed::Done(response) => {
                            if wire::write_frame(&mut writer, &response).await.is_err() {
                                log::warn!("failed to write response to plugin");
                                break;
                            }
                        }
                        Routed::Chat(call) => {
                            let answer_tx = answer_tx.clone();
                            tokio::spawn(async move {
                                let _ = answer_tx.send(call.run().await).await;
                            });
                        }
                    },
                    Incoming::Notification(notification) => {
                        // Same gates as a request; a notification gets no response,
                        // so a chat call sent as one is dropped.
                        if let Routed::Chat(_) = broker.route(&notification).await {
                            log::debug!(
                                "plugin {} sent {} as a notification; dropped",
                                broker.plugin_id(),
                                notification.method
                            );
                        }
                    }
                    Incoming::Response(response) => {
                        let key = id_key(&response.id);
                        if heartbeat.as_ref().is_some_and(|(id, _)| *id == key) {
                            broker.responsive = true;
                            heartbeat = None;
                        } else if let Some(reply) = pending.remove(&key) {
                            let _ = reply.send(response);
                        } else {
                            log::debug!(
                                "plugin {} sent a response to unknown id {}",
                                broker.plugin_id(),
                                key
                            );
                        }
                    }
                    Incoming::Invalid(reason) => {
                        // The reason may quote the frame, which can carry message text.
                        log::warn!("plugin {} sent an invalid frame", broker.plugin_id());
                        log::debug!("plugin {} invalid frame: {}", broker.plugin_id(), reason);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::capability::CapabilityGate;
    use crate::plugin_host::settings::{test_manifest, SettingsFixture};

    fn test_broker() -> PluginBroker {
        PluginBroker::new(
            "dev.example.test".into(),
            CapabilityGate::new(vec!["chat.write".into()]),
            BrokerConfig::default(),
        )
    }

    #[tokio::test]
    async fn log_method_succeeds() {
        let mut broker = test_broker();
        let req = JsonRpcRequest::new(
            "rim.log",
            Some(serde_json::json!({"level": "info", "message": "hello"})),
            1,
        );
        let resp = broker.handle_request(&req).await;
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());
    }

    #[tokio::test]
    async fn log_with_invalid_level_is_invalid_params() {
        let mut broker = test_broker();
        let req = JsonRpcRequest::new(
            "rim.log",
            Some(serde_json::json!({"level": "loud", "message": "hello"})),
            1,
        );
        let resp = broker.handle_request(&req).await;
        assert_eq!(resp.error.unwrap().code, wire::INVALID_PARAMS);
    }

    #[tokio::test]
    async fn unknown_method_is_method_not_found() {
        let mut broker = test_broker();
        let req = JsonRpcRequest::new("rim.nonexistent", None, 1);
        let resp = broker.handle_request(&req).await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, METHOD_NOT_FOUND);
    }

    #[tokio::test]
    async fn capability_denied() {
        let mut broker = PluginBroker::new(
            "dev.example.test".into(),
            CapabilityGate::new(vec![]),
            BrokerConfig::default(),
        );
        let req = JsonRpcRequest::new("rim.chat.post_message", None, 1);
        let resp = broker.handle_request(&req).await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, CAPABILITY_DENIED);
    }

    /// Without a chat relay (and for `events.read`, which nothing serves) a granted
    /// method still does nothing.
    #[tokio::test]
    async fn granted_but_unwired_methods_are_method_not_found() {
        let mut broker = PluginBroker::new(
            "dev.example.test".into(),
            CapabilityGate::new(vec![
                "chat.read".into(),
                "chat.write".into(),
                "events.read".into(),
            ]),
            BrokerConfig::default(),
        );
        for method in [
            "rim.chat.post_message",
            "rim.chat.list_messages",
            "rim.chat.get_message",
            "rim.chat.search_messages",
            "rim.events.subscribe",
        ] {
            let req = JsonRpcRequest::new(method, Some(serde_json::json!({})), 1);
            let resp = broker.handle_request(&req).await;
            assert_eq!(resp.error.unwrap().code, METHOD_NOT_FOUND, "{method}");
        }
    }

    #[tokio::test]
    async fn chat_calls_go_to_the_relay_with_the_start_time_grants() {
        let relay = Arc::new(ChatRelay::default());
        let mut ui = relay.subscribe();
        let mut broker = PluginBroker::new(
            "dev.example.reader".into(),
            CapabilityGate::new(vec!["chat.read".into(), "chat.read.encrypted".into()]),
            BrokerConfig::default(),
        )
        .with_chat_relay(relay.clone());
        let answering = {
            let relay = relay.clone();
            tokio::spawn(async move {
                let request = ui.recv().await.unwrap();
                assert_eq!(request.method, "rim.chat.list_messages");
                assert_eq!(request.params, serde_json::json!({"conversationId": "c"}));
                assert_eq!(
                    request.granted_capabilities,
                    vec!["chat.read".to_string(), "chat.read.encrypted".to_string()]
                );
                relay.respond(request.request_id, Ok(serde_json::json!({"messages": []})));
            })
        };
        let req = JsonRpcRequest::new(
            "rim.chat.list_messages",
            Some(serde_json::json!({"conversationId": "c"})),
            4,
        );
        let resp = broker.handle_request(&req).await;
        assert_eq!(resp.id, serde_json::json!(4));
        assert_eq!(resp.result.unwrap(), serde_json::json!({"messages": []}));
        answering.await.unwrap();
    }

    #[tokio::test]
    async fn chat_calls_without_the_plain_grant_never_reach_the_relay() {
        let relay = Arc::new(ChatRelay::default());
        let mut ui = relay.subscribe();
        let mut broker = PluginBroker::new(
            "dev.example.reader".into(),
            CapabilityGate::new(vec![
                "chat.read.encrypted".into(),
                "chat.write.encrypted".into(),
            ]),
            BrokerConfig::default(),
        )
        .with_chat_relay(relay);
        for method in CHAT_METHODS {
            let req = JsonRpcRequest::new(*method, Some(serde_json::json!({})), 1);
            let resp = broker.handle_request(&req).await;
            assert_eq!(resp.error.unwrap().code, CAPABILITY_DENIED, "{method}");
        }
        assert!(ui.try_recv().is_err(), "nothing was relayed");
    }

    #[tokio::test]
    async fn chat_calls_share_their_capability_rate_limit() {
        let relay = Arc::new(ChatRelay::new(Duration::from_millis(10)));
        let _ui = relay.subscribe();
        let mut broker = PluginBroker::new(
            "dev.example.reader".into(),
            CapabilityGate::new(vec!["chat.read".into()]),
            BrokerConfig {
                rate_limits: HashMap::from([("chat.read".to_string(), 2)]),
                default_rate_limit: DEFAULT_RATE_LIMIT,
            },
        )
        .with_chat_relay(relay);
        let list = JsonRpcRequest::new("rim.chat.list_messages", None, 1);
        let get = JsonRpcRequest::new("rim.chat.get_message", None, 2);
        assert!(matches!(broker.route(&list).await, Routed::Chat(_)));
        assert!(matches!(broker.route(&get).await, Routed::Chat(_)));
        match broker.route(&list).await {
            Routed::Done(resp) => assert_eq!(resp.error.unwrap().code, RATE_LIMITED),
            Routed::Chat(_) => panic!("the third chat.read call is over the limit"),
        }
    }

    // ── Settings ──

    const SETTINGS_PLUGIN: &str = "dev.example.settings";
    const OTHER_PLUGIN: &str = "dev.example.other";
    const NO_SETTINGS_PLUGIN: &str = "dev.example.plain";
    const ACCOUNT: &str = "rimp0_a";

    /// [`SETTINGS_PLUGIN`] and [`OTHER_PLUGIN`] declaring the same settings, and
    /// [`NO_SETTINGS_PLUGIN`] declaring none, with [`ACCOUNT`] signed in.
    fn settings_host() -> SettingsFixture {
        let schema = serde_json::json!([
            { "key": "namespace", "title": "Namespace", "value_type": "string", "default": "default" },
            { "key": "refresh_seconds", "title": "Refresh", "value_type": "integer", "default": 30 },
            { "key": "context", "title": "Context", "value_type": "string" },
            { "key": "api_token", "title": "Token", "value_type": "string", "is_secret": true }
        ]);
        let host = SettingsFixture::new(vec![
            test_manifest(SETTINGS_PLUGIN, schema.clone()),
            test_manifest(OTHER_PLUGIN, schema),
            test_manifest(NO_SETTINGS_PLUGIN, serde_json::json!([])),
        ]);
        host.sign_in(Some(ACCOUNT));
        host
    }

    /// A broker for `plugin_id` reading its settings from `host`, as a started
    /// plugin's broker does.
    fn settings_broker(host: &SettingsFixture, plugin_id: &str) -> PluginBroker {
        PluginBroker::new(
            plugin_id.into(),
            CapabilityGate::new(vec![]),
            BrokerConfig::default(),
        )
        .with_settings(SettingsReader::new(&host.state, plugin_id))
    }

    fn settings_get(id: i64) -> JsonRpcRequest {
        JsonRpcRequest::new(method::SETTINGS_GET, None, id)
    }

    #[tokio::test]
    async fn settings_get_answers_saved_values_over_defaults_with_secrets_in_plain_form() {
        let host = settings_host();
        host.save(
            SETTINGS_PLUGIN,
            ACCOUNT,
            serde_json::json!({"namespace": "prod", "api_token": "t0k"}),
        );
        let mut broker = settings_broker(&host, SETTINGS_PLUGIN);
        let resp = broker.handle_request(&settings_get(1)).await;
        assert!(resp.error.is_none(), "{:?}", resp.error);
        assert_eq!(
            resp.result.unwrap(),
            serde_json::json!({"values": {
                "namespace": "prod",
                "refresh_seconds": 30,
                "api_token": "t0k",
            }}),
            "context has neither a saved value nor a default, so it is left out"
        );
    }

    #[tokio::test]
    async fn settings_get_of_a_plugin_without_settings_is_an_empty_set() {
        let host = settings_host();
        let mut broker = settings_broker(&host, NO_SETTINGS_PLUGIN);
        let resp = broker.handle_request(&settings_get(1)).await;
        assert_eq!(resp.result.unwrap(), serde_json::json!({"values": {}}));
    }

    #[tokio::test]
    async fn settings_get_signed_out_answers_the_defaults_only() {
        let host = settings_host();
        host.save(
            SETTINGS_PLUGIN,
            ACCOUNT,
            serde_json::json!({"namespace": "prod", "api_token": "t0k"}),
        );
        host.sign_in(None);
        let mut broker = settings_broker(&host, SETTINGS_PLUGIN);
        let resp = broker.handle_request(&settings_get(1)).await;
        assert_eq!(
            resp.result.unwrap(),
            serde_json::json!({"values": {"namespace": "default", "refresh_seconds": 30}})
        );
    }

    #[tokio::test]
    async fn settings_get_with_a_locked_vault_says_why() {
        let host = settings_host();
        host.secrets.lock();
        let mut broker = settings_broker(&host, SETTINGS_PLUGIN);
        let error = broker.handle_request(&settings_get(1)).await.error.unwrap();
        assert_eq!(error.code, INTERNAL_ERROR);
        assert_eq!(
            error.data,
            Some(serde_json::json!({"reason": "secretsLocked"}))
        );
    }

    #[tokio::test]
    async fn settings_get_reads_the_connections_plugin_whatever_the_params_say() {
        let host = settings_host();
        host.save(
            SETTINGS_PLUGIN,
            ACCOUNT,
            serde_json::json!({"namespace": "own"}),
        );
        host.save(
            OTHER_PLUGIN,
            ACCOUNT,
            serde_json::json!({"namespace": "other"}),
        );
        let mut broker = settings_broker(&host, SETTINGS_PLUGIN);
        let req = JsonRpcRequest::new(
            method::SETTINGS_GET,
            Some(serde_json::json!({"pluginId": OTHER_PLUGIN, "plugin_id": OTHER_PLUGIN})),
            1,
        );
        let resp = broker.handle_request(&req).await;
        assert_eq!(resp.result.unwrap()["values"]["namespace"], "own");
    }

    #[tokio::test]
    async fn settings_get_without_a_reader_is_method_not_found() {
        let mut broker = test_broker();
        let resp = broker.handle_request(&settings_get(1)).await;
        assert_eq!(resp.error.unwrap().code, METHOD_NOT_FOUND);
    }

    #[test]
    fn heartbeat_ping_has_negative_id() {
        let mut broker = test_broker();
        let ping = broker.create_heartbeat_ping();
        assert_eq!(ping.method, "rim.heartbeat");
        assert_eq!(ping.id, serde_json::json!(-1));

        let ping2 = broker.create_heartbeat_ping();
        assert_eq!(ping2.id, serde_json::json!(-2));
    }

    #[tokio::test]
    async fn rate_limiting_works() {
        let mut broker = PluginBroker::new(
            "dev.example.test".into(),
            CapabilityGate::new(vec!["chat.write".into()]),
            BrokerConfig {
                rate_limits: {
                    let mut m = HashMap::new();
                    m.insert("chat.write".into(), 2); // only 2 calls per minute
                    m
                },
                default_rate_limit: DEFAULT_RATE_LIMIT,
            },
        );

        // No handler serves the method, so the call fails at dispatch, but rate limiting
        // happens before dispatch. The first two calls pass the capability and rate checks.
        let req = JsonRpcRequest::new(
            "rim.chat.post_message",
            Some(serde_json::json!({"conversationId": "b", "body": "c"})),
            1,
        );

        // Calls 1 and 2 pass the rate limit and fail at dispatch with METHOD_NOT_FOUND.
        let resp1 = broker.handle_request(&req).await;
        assert_eq!(resp1.error.as_ref().unwrap().code, METHOD_NOT_FOUND);

        let resp2 = broker.handle_request(&req).await;
        assert_eq!(resp2.error.as_ref().unwrap().code, METHOD_NOT_FOUND);

        // Call 3 is rate limited.
        let resp3 = broker.handle_request(&req).await;
        assert_eq!(resp3.error.as_ref().unwrap().code, RATE_LIMITED);
    }

    // ── Host → plugin requests through the broker loop ──

    type PluginSide = tokio::io::DuplexStream;

    /// Starts a broker loop on one end of an in-memory pipe; the other end plays the plugin.
    fn spawn_loop() -> (PluginClient, PluginSide, tokio::sync::watch::Sender<bool>) {
        let (host_end, plugin_end) = tokio::io::duplex(64 * 1024);
        let (reader, writer) = tokio::io::split(host_end);
        let (client, outbound_rx) = PluginClient::channel();
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        tokio::spawn(run_broker_loop(
            test_broker(),
            reader,
            writer,
            outbound_rx,
            shutdown_rx,
        ));
        (client, plugin_end, shutdown_tx)
    }

    async fn read_json(plugin: &mut PluginSide) -> serde_json::Value {
        wire::read_raw_frame(plugin).await.unwrap()
    }

    const WAIT: Duration = Duration::from_secs(5);

    #[tokio::test]
    async fn client_request_round_trip() {
        let (client, mut plugin, _shutdown) = spawn_loop();
        let fake_plugin = tokio::spawn(async move {
            let request = read_json(&mut plugin).await;
            assert_eq!(request["method"], "rim.command.execute");
            assert_eq!(request["params"]["command_id"], "greet");
            let response = JsonRpcResponse::success(request["id"].clone(), serde_json::json!("hi"));
            wire::write_frame(&mut plugin, &response).await.unwrap();
            plugin
        });

        let result = client
            .request(
                "rim.command.execute",
                Some(serde_json::json!({"command_id": "greet", "args": {}})),
                WAIT,
            )
            .await
            .unwrap();
        assert_eq!(result, serde_json::json!("hi"));
        fake_plugin.await.unwrap();
    }

    #[tokio::test]
    async fn plugin_can_call_broker_while_host_request_pending() {
        let (client, mut plugin, _shutdown) = spawn_loop();
        let fake_plugin = tokio::spawn(async move {
            let host_request = read_json(&mut plugin).await;
            // Before answering, the plugin makes its own call to the host.
            let log = JsonRpcRequest::new(
                "rim.log",
                Some(serde_json::json!({"level": "info", "message": "working"})),
                7,
            );
            wire::write_frame(&mut plugin, &log).await.unwrap();
            let log_response = read_json(&mut plugin).await;
            assert_eq!(log_response["id"], 7);
            assert_eq!(log_response["result"]["ok"], true);

            let response =
                JsonRpcResponse::success(host_request["id"].clone(), serde_json::json!({"n": 1}));
            wire::write_frame(&mut plugin, &response).await.unwrap();
            plugin
        });

        let result = client
            .request("rim.command.execute", None, WAIT)
            .await
            .unwrap();
        assert_eq!(result, serde_json::json!({"n": 1}));
        fake_plugin.await.unwrap();
    }

    #[tokio::test]
    async fn concurrent_requests_are_matched_by_id() {
        let (client, mut plugin, _shutdown) = spawn_loop();
        let fake_plugin = tokio::spawn(async move {
            let first = read_json(&mut plugin).await;
            let second = read_json(&mut plugin).await;
            // Answer out of order, echoing each request's own params.
            for request in [second, first] {
                let response =
                    JsonRpcResponse::success(request["id"].clone(), request["params"].clone());
                wire::write_frame(&mut plugin, &response).await.unwrap();
            }
            plugin
        });

        let (a, b) = tokio::join!(
            client.request("m", Some(serde_json::json!("a")), WAIT),
            client.request("m", Some(serde_json::json!("b")), WAIT),
        );
        assert_eq!(a.unwrap(), serde_json::json!("a"));
        assert_eq!(b.unwrap(), serde_json::json!("b"));
        fake_plugin.await.unwrap();
    }

    #[tokio::test]
    async fn plugin_error_response_maps_to_request_error() {
        let (client, mut plugin, _shutdown) = spawn_loop();
        let fake_plugin = tokio::spawn(async move {
            let request = read_json(&mut plugin).await;
            let response =
                JsonRpcResponse::error(request["id"].clone(), wire::PLUGIN_ERROR, "kubectl failed");
            wire::write_frame(&mut plugin, &response).await.unwrap();
            plugin
        });

        let err = client.request("m", None, WAIT).await.unwrap_err();
        match err {
            RequestError::Plugin(e) => {
                assert_eq!(e.code, wire::PLUGIN_ERROR);
                assert_eq!(e.message, "kubectl failed");
            }
            other => panic!("expected plugin error, got {other:?}"),
        }
        fake_plugin.await.unwrap();
    }

    #[tokio::test]
    async fn request_times_out_when_plugin_never_answers() {
        let (client, _plugin, _shutdown) = spawn_loop();
        let err = client
            .request("m", None, Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(matches!(err, RequestError::TimedOut(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn pending_request_fails_when_plugin_disconnects() {
        let (client, mut plugin, _shutdown) = spawn_loop();
        let fake_plugin = tokio::spawn(async move {
            read_json(&mut plugin).await;
            drop(plugin); // the plugin process exits mid-command
        });

        let err = client.request("m", None, WAIT).await.unwrap_err();
        assert!(matches!(err, RequestError::Closed), "got {err:?}");
        fake_plugin.await.unwrap();

        // The loop is gone, so later requests fail fast too.
        let err = client.request("m", None, WAIT).await.unwrap_err();
        assert!(matches!(err, RequestError::Closed), "got {err:?}");
    }

    #[tokio::test]
    async fn notifications_and_stray_frames_do_not_stop_the_loop() {
        let (client, mut plugin, _shutdown) = spawn_loop();
        let fake_plugin = tokio::spawn(async move {
            let request = read_json(&mut plugin).await;
            let notification = wire::JsonRpcNotification::new(
                "rim.log",
                Some(serde_json::json!({"level": "info", "message": "no id"})),
            );
            wire::write_frame(&mut plugin, &notification).await.unwrap();
            wire::write_frame(&mut plugin, &serde_json::json!({"jsonrpc": "2.0"}))
                .await
                .unwrap();
            let unknown = JsonRpcResponse::success(serde_json::json!(999), serde_json::json!(1));
            wire::write_frame(&mut plugin, &unknown).await.unwrap();

            let response = JsonRpcResponse::success(request["id"].clone(), serde_json::json!(true));
            wire::write_frame(&mut plugin, &response).await.unwrap();
            plugin
        });

        let result = client.request("m", None, WAIT).await.unwrap();
        assert_eq!(result, serde_json::json!(true));
        fake_plugin.await.unwrap();
    }

    #[tokio::test]
    async fn a_chat_call_does_not_hold_up_the_loop() {
        let relay = Arc::new(ChatRelay::default());
        let mut ui = relay.subscribe();
        let (host_end, mut plugin) = tokio::io::duplex(64 * 1024);
        let (reader, writer) = tokio::io::split(host_end);
        let (_client, outbound_rx) = PluginClient::channel();
        let (_shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        let broker = PluginBroker::new(
            "dev.example.reader".into(),
            CapabilityGate::new(vec!["chat.read".into()]),
            BrokerConfig::default(),
        )
        .with_chat_relay(relay.clone());
        tokio::spawn(run_broker_loop(
            broker,
            reader,
            writer,
            outbound_rx,
            shutdown_rx,
        ));

        let list = JsonRpcRequest::new(
            "rim.chat.list_messages",
            Some(serde_json::json!({"conversationId": "c"})),
            "list",
        );
        wire::write_frame(&mut plugin, &list).await.unwrap();
        let request = ui.recv().await.unwrap();

        // While the UI works on the chat call, the plugin's log call is answered.
        let log = JsonRpcRequest::new(
            "rim.log",
            Some(serde_json::json!({"level": "info", "message": "waiting"})),
            "log",
        );
        wire::write_frame(&mut plugin, &log).await.unwrap();
        assert_eq!(read_json(&mut plugin).await["id"], "log");

        relay.respond(request.request_id, Ok(serde_json::json!({"messages": []})));
        let answer = read_json(&mut plugin).await;
        assert_eq!(answer["id"], "list");
        assert_eq!(answer["result"], serde_json::json!({"messages": []}));
    }

    #[tokio::test]
    async fn notify_sends_a_frame_without_id() {
        let (client, mut plugin, _shutdown) = spawn_loop();
        client
            .notify(
                method::PRINCIPAL_CHANGED,
                Some(serde_json::json!({"principal": null})),
            )
            .await
            .unwrap();
        let frame = read_json(&mut plugin).await;
        assert_eq!(frame["method"], method::PRINCIPAL_CHANGED);
        assert!(
            frame.get("id").is_none(),
            "a notification has no id: {frame}"
        );
    }

    /// Starts a broker loop for [`SETTINGS_PLUGIN`] reading `host`, on an
    /// in-memory pipe; the other end plays the plugin.
    fn spawn_settings_loop(
        host: &SettingsFixture,
    ) -> (PluginClient, PluginSide, tokio::sync::watch::Sender<bool>) {
        let (host_end, plugin_end) = tokio::io::duplex(64 * 1024);
        let (reader, writer) = tokio::io::split(host_end);
        let (client, outbound_rx) = PluginClient::channel();
        let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
        tokio::spawn(run_broker_loop(
            settings_broker(host, SETTINGS_PLUGIN),
            reader,
            writer,
            outbound_rx,
            shutdown_rx,
        ));
        (client, plugin_end, shutdown_tx)
    }

    #[tokio::test]
    async fn settings_changed_carries_the_settings_of_whoever_is_signed_in_when_sent() {
        let host = settings_host();
        host.save(
            SETTINGS_PLUGIN,
            ACCOUNT,
            serde_json::json!({"namespace": "a"}),
        );
        host.save(
            SETTINGS_PLUGIN,
            "rimp0_b",
            serde_json::json!({"namespace": "b"}),
        );
        let (client, mut plugin, _shutdown) = spawn_settings_loop(&host);

        client.settings_changed().await.unwrap();
        let frame = read_json(&mut plugin).await;
        assert_eq!(frame["method"], method::SETTINGS_CHANGED);
        assert!(
            frame.get("id").is_none(),
            "a notification has no id: {frame}"
        );
        assert_eq!(frame["params"]["values"]["namespace"], "a");

        host.sign_in(Some("rimp0_b"));
        assert!(client.try_settings_changed());
        let frame = read_json(&mut plugin).await;
        assert_eq!(frame["params"]["values"]["namespace"], "b");
    }

    #[tokio::test]
    async fn settings_changed_is_not_sent_while_the_vault_is_locked() {
        let host = settings_host();
        host.save(
            SETTINGS_PLUGIN,
            ACCOUNT,
            serde_json::json!({"api_token": "t0k"}),
        );
        let (client, mut plugin, _shutdown) = spawn_settings_loop(&host);

        host.secrets.lock();
        client.settings_changed().await.unwrap();
        // The plugin asks; the answer says why, and it is the first frame it gets.
        wire::write_frame(&mut plugin, &settings_get(9))
            .await
            .unwrap();
        let frame = read_json(&mut plugin).await;
        assert_eq!(frame["id"], 9);
        assert_eq!(frame["error"]["data"]["reason"], "secretsLocked");

        host.secrets.unlock();
        client.settings_changed().await.unwrap();
        let frame = read_json(&mut plugin).await;
        assert_eq!(frame["method"], method::SETTINGS_CHANGED);
        assert_eq!(frame["params"]["values"]["api_token"], "t0k");
    }

    #[tokio::test]
    async fn settings_are_read_when_written_so_no_older_set_follows_a_newer_one() {
        let host = settings_host();
        host.save(
            SETTINGS_PLUGIN,
            ACCOUNT,
            serde_json::json!({"namespace": "old"}),
        );
        let (client, mut plugin, _shutdown) = spawn_settings_loop(&host);

        // Queued before the newer values were saved, written after: the notice
        // carries the newer set, and so does the answer. The loop may write
        // either frame first; both hold the newer set whichever it is.
        client.settings_changed().await.unwrap();
        host.save(
            SETTINGS_PLUGIN,
            ACCOUNT,
            serde_json::json!({"namespace": "new"}),
        );
        wire::write_frame(&mut plugin, &settings_get(1))
            .await
            .unwrap();
        let frames = [read_json(&mut plugin).await, read_json(&mut plugin).await];
        let notice = frames
            .iter()
            .find(|f| f["method"] == method::SETTINGS_CHANGED)
            .expect("a rim.settings.changed notice");
        let answer = frames
            .iter()
            .find(|f| f["id"] == 1)
            .expect("the rim.settings.get answer");
        assert_eq!(notice["params"]["values"]["namespace"], "new");
        assert_eq!(answer["result"]["values"]["namespace"], "new");
    }

    #[tokio::test]
    async fn shutdown_signal_tells_the_plugin_and_closes_stdin() {
        let (_client, mut plugin, shutdown) = spawn_loop();
        shutdown.send(true).unwrap();

        let frame = read_json(&mut plugin).await;
        assert_eq!(frame["method"], method::SHUTDOWN);
        assert!(frame.get("id").is_none(), "rim.shutdown is a notification");
        let next: Result<serde_json::Value, _> = wire::read_raw_frame(&mut plugin).await;
        assert!(
            matches!(next, Err(WireError::ConnectionClosed)),
            "stdin closes after rim.shutdown: {next:?}"
        );
    }

    #[tokio::test]
    async fn shutdown_signal_ends_loop_and_fails_pending_requests() {
        let (client, _plugin, shutdown) = spawn_loop();
        let pending = tokio::spawn({
            let client = client.clone();
            async move { client.request("m", None, WAIT).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        shutdown.send(true).unwrap();

        let err = pending.await.unwrap().unwrap_err();
        assert!(matches!(err, RequestError::Closed), "got {err:?}");
    }

    #[tokio::test]
    async fn same_connection_distinguishes_clients() {
        let (a, _rx_a) = PluginClient::channel();
        let (b, _rx_b) = PluginClient::channel();
        assert!(a.same_connection(&a.clone()));
        assert!(!a.same_connection(&b));
    }
}
