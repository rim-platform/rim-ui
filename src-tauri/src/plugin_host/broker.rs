#![allow(dead_code)]

use crate::plugin_host::backend_client::{self, AuditEntry, BackendClient};
use crate::plugin_host::capability::{self, CapabilityGate};
use crate::plugin_host::event_forwarder::EventForwarder;
use crate::plugin_host::panel_relay::PanelRelay;
use crate::plugin_host::protocol::{method, LogLevel, LogParams};
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
    backend_client: Option<Arc<BackendClient>>,
    event_forwarder: Option<Arc<EventForwarder>>,
    panel_relay: Option<Arc<PanelRelay>>,
    /// Panel IDs declared in this plugin's manifest — for ownership verification.
    manifest_panel_ids: Vec<String>,
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
            backend_client: None,
            event_forwarder: None,
            panel_relay: None,
            manifest_panel_ids: vec![],
        }
    }

    pub fn with_panel_relay(mut self, relay: Arc<PanelRelay>, panel_ids: Vec<String>) -> Self {
        self.panel_relay = Some(relay);
        self.manifest_panel_ids = panel_ids;
        self
    }

    pub fn with_backend(mut self, client: Arc<BackendClient>) -> Self {
        self.backend_client = Some(client);
        self
    }

    pub fn with_event_forwarder(mut self, forwarder: Arc<EventForwarder>) -> Self {
        self.event_forwarder = Some(forwarder);
        self
    }

    /// Handle an incoming JSON-RPC request from the plugin.
    pub async fn handle_request(&mut self, request: &JsonRpcRequest) -> JsonRpcResponse {
        // Check capability
        if let Err(required_cap) = self.gate.check(&request.method) {
            log::warn!(
                "plugin {} denied: method={} requires capability={}",
                self.plugin_id,
                request.method,
                required_cap
            );
            return JsonRpcResponse::error(
                request.id.clone(),
                CAPABILITY_DENIED,
                format!("capability denied: {required_cap}"),
            );
        }

        // Check rate limit
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
                return JsonRpcResponse::error(
                    request.id.clone(),
                    RATE_LIMITED,
                    format!("rate limit exceeded for capability: {cap_string}"),
                );
            }
        }

        // Dispatch
        self.dispatch(request).await
    }

    async fn dispatch(&self, request: &JsonRpcRequest) -> JsonRpcResponse {
        let method = request.method.as_str();
        match method {
            method::LOG => self.handle_log(request),
            "rim.chat.send_message" => self.handle_backend_call(request, method).await,
            "rim.chat.get_messages" => self.handle_backend_call(request, method).await,
            "rim.chat.search_messages" => self.handle_backend_call(request, method).await,
            "rim.events.subscribe" => self.handle_events_subscribe(request).await,
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

    async fn handle_backend_call(&self, request: &JsonRpcRequest, method: &str) -> JsonRpcResponse {
        let client = match &self.backend_client {
            Some(c) => c,
            None => {
                return JsonRpcResponse::error(
                    request.id.clone(),
                    INTERNAL_ERROR,
                    "backend client not configured",
                );
            }
        };

        let params = request
            .params
            .as_ref()
            .cloned()
            .unwrap_or(serde_json::json!({}));
        let capability = capability::capability_for_method(method)
            .unwrap_or("unknown")
            .to_string();

        let result = match method {
            "rim.chat.send_message" => {
                let server_id = params
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let conversation_id = params
                    .get("conversation_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let text = params.get("text").and_then(|v| v.as_str()).unwrap_or("");
                let parent_message_id = params.get("parent_message_id").and_then(|v| v.as_str());

                if server_id.is_empty() || conversation_id.is_empty() || text.is_empty() {
                    return JsonRpcResponse::error(
                        request.id.clone(),
                        wire::INVALID_PARAMS,
                        "missing required params: server_id, conversation_id, text",
                    );
                }

                client
                    .send_message(server_id, conversation_id, text, parent_message_id)
                    .await
            }
            "rim.chat.get_messages" => {
                let server_id = params
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let conversation_id = params
                    .get("conversation_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let limit = params.get("limit").and_then(|v| v.as_i64()).unwrap_or(50) as i32;
                let cursor = params.get("cursor").and_then(|v| v.as_str());

                if server_id.is_empty() || conversation_id.is_empty() {
                    return JsonRpcResponse::error(
                        request.id.clone(),
                        wire::INVALID_PARAMS,
                        "missing required params: server_id, conversation_id",
                    );
                }

                client
                    .get_messages(server_id, conversation_id, limit, cursor)
                    .await
            }
            "rim.chat.search_messages" => {
                let server_id = params
                    .get("server_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let conversation_id = params
                    .get("conversation_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let query = params.get("query").and_then(|v| v.as_str()).unwrap_or("");
                let limit = params.get("limit").and_then(|v| v.as_i64()).unwrap_or(20) as i32;

                if server_id.is_empty() || conversation_id.is_empty() || query.is_empty() {
                    return JsonRpcResponse::error(
                        request.id.clone(),
                        wire::INVALID_PARAMS,
                        "missing required params: server_id, conversation_id, query",
                    );
                }

                client
                    .search_messages(server_id, conversation_id, query, limit)
                    .await
            }
            _ => unreachable!(),
        };

        let (success, error_msg) = match &result {
            Ok(_) => (true, None),
            Err(e) => (false, Some(e.to_string())),
        };

        backend_client::log_audit(&AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            plugin_id: self.plugin_id.clone(),
            method: method.to_string(),
            capability: capability.clone(),
            success,
            error: error_msg.clone(),
        });

        match result {
            Ok(data) => JsonRpcResponse::success(request.id.clone(), data),
            Err(e) => JsonRpcResponse::error(request.id.clone(), INTERNAL_ERROR, e.to_string()),
        }
    }

    async fn handle_events_subscribe(&self, request: &JsonRpcRequest) -> JsonRpcResponse {
        let forwarder = match &self.event_forwarder {
            Some(f) => f,
            None => {
                return JsonRpcResponse::error(
                    request.id.clone(),
                    INTERNAL_ERROR,
                    "event forwarder not configured",
                );
            }
        };

        let params = request
            .params
            .as_ref()
            .cloned()
            .unwrap_or(serde_json::json!({}));
        let event_types: Vec<String> = params
            .get("event_types")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        if event_types.is_empty() {
            return JsonRpcResponse::error(
                request.id.clone(),
                wire::INVALID_PARAMS,
                "event_types array must not be empty",
            );
        }

        if let Err(e) = forwarder
            .subscribe(&self.plugin_id, event_types.clone())
            .await
        {
            return JsonRpcResponse::error(request.id.clone(), wire::INVALID_PARAMS, e.to_string());
        }

        backend_client::log_audit(&AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            plugin_id: self.plugin_id.clone(),
            method: "rim.events.subscribe".to_string(),
            capability: "events.read".to_string(),
            success: true,
            error: None,
        });

        JsonRpcResponse::success(
            request.id.clone(),
            serde_json::json!({"subscribed": event_types}),
        )
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

        // Verify this plugin owns the panel
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

    pub fn update_capabilities(&mut self, approved: Vec<String>) {
        self.gate.update_capabilities(approved);
    }
}

/// A host → plugin message waiting for the broker loop to send it.
pub struct OutboundRequest {
    method: String,
    params: Option<serde_json::Value>,
    /// `None` sends a notification: no id, and no response is expected.
    reply: Option<oneshot::Sender<JsonRpcResponse>>,
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
/// broker (e.g. `rim.chat.get_messages`) while it is still working on a host request.
#[derive(Debug, Clone)]
pub struct PluginClient {
    tx: mpsc::Sender<OutboundRequest>,
}

impl PluginClient {
    /// Create a client and the receiver to pass to [`run_broker_loop`].
    pub fn channel() -> (Self, mpsc::Receiver<OutboundRequest>) {
        let (tx, rx) = mpsc::channel(OUTBOUND_QUEUE);
        (Self { tx }, rx)
    }

    /// Send `method` to the plugin and wait up to `wait` for its result.
    ///
    /// Dropping the returned future (or timing out) abandons the request; the
    /// broker loop discards the plugin's late response.
    pub async fn request(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
        wait: Duration,
    ) -> Result<serde_json::Value, RequestError> {
        let (reply, response) = oneshot::channel();
        let outbound = OutboundRequest {
            method: method.to_string(),
            params,
            reply: Some(reply),
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

    /// Send `method` to the plugin as a notification, without waiting for anything.
    ///
    /// Fails with [`RequestError::Closed`] when the broker loop is gone.
    pub async fn notify(
        &self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), RequestError> {
        let outbound = OutboundRequest {
            method: method.to_string(),
            params,
            reply: None,
        };
        self.tx
            .send(outbound)
            .await
            .map_err(|_| RequestError::Closed)
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

/// Run the broker loop for one plugin connection until shutdown or disconnect.
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
            Some(outbound) = outbound_rx.recv() => {
                let Some(reply) = outbound.reply else {
                    let notification = JsonRpcNotification::new(outbound.method, outbound.params);
                    if wire::write_frame(&mut writer, &notification).await.is_err() {
                        log::warn!("failed to send notification to plugin {}", broker.plugin_id());
                        break;
                    }
                    continue;
                };
                // Forget requests whose callers gave up (timeout or cancellation).
                pending.retain(|_, reply| !reply.is_closed());
                let id = next_request_id;
                next_request_id += 1;
                let request = JsonRpcRequest::new(outbound.method, outbound.params, id);
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
                    Incoming::Request(request) => {
                        let response = broker.handle_request(&request).await;
                        if wire::write_frame(&mut writer, &response).await.is_err() {
                            log::warn!("failed to write response to plugin");
                            break;
                        }
                    }
                    Incoming::Notification(notification) => {
                        // Same gates as a request; a notification gets no response.
                        broker.handle_request(&notification).await;
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
                        log::warn!("plugin {} sent an invalid frame: {}", broker.plugin_id(), reason);
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
        let req = JsonRpcRequest::new("rim.chat.send_message", None, 1);
        let resp = broker.handle_request(&req).await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, CAPABILITY_DENIED);
    }

    #[tokio::test]
    async fn backend_call_without_client_returns_error() {
        let mut broker = PluginBroker::new(
            "dev.example.test".into(),
            CapabilityGate::new(vec!["chat.write".into()]),
            BrokerConfig::default(),
        );
        // No backend client configured
        let req = JsonRpcRequest::new(
            "rim.chat.send_message",
            Some(serde_json::json!({
                "server_id": "abc",
                "conversation_id": "def",
                "text": "hello"
            })),
            1,
        );
        let resp = broker.handle_request(&req).await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, INTERNAL_ERROR);
    }

    #[tokio::test]
    async fn events_subscribe_without_forwarder_returns_error() {
        let mut broker = PluginBroker::new(
            "dev.example.test".into(),
            CapabilityGate::new(vec!["events.read".into()]),
            BrokerConfig::default(),
        );
        let req = JsonRpcRequest::new(
            "rim.events.subscribe",
            Some(serde_json::json!({"event_types": ["message.created"]})),
            1,
        );
        let resp = broker.handle_request(&req).await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, INTERNAL_ERROR);
    }

    #[tokio::test]
    async fn events_subscribe_with_forwarder() {
        let forwarder = Arc::new(EventForwarder::new());
        let mut broker = PluginBroker::new(
            "dev.example.test".into(),
            CapabilityGate::new(vec!["events.read".into()]),
            BrokerConfig::default(),
        )
        .with_event_forwarder(forwarder.clone());

        let req = JsonRpcRequest::new(
            "rim.events.subscribe",
            Some(serde_json::json!({"event_types": ["message.created", "message.deleted"]})),
            1,
        );
        let resp = broker.handle_request(&req).await;
        assert!(resp.result.is_some());
        assert!(resp.error.is_none());

        // Verify the subscription was registered (public channel events)
        let subs = forwarder
            .subscribers_for("message.created", None, true)
            .await;
        assert_eq!(subs, vec!["dev.example.test"]);
    }

    #[tokio::test]
    async fn events_subscribe_empty_types_rejected() {
        let forwarder = Arc::new(EventForwarder::new());
        let mut broker = PluginBroker::new(
            "dev.example.test".into(),
            CapabilityGate::new(vec!["events.read".into()]),
            BrokerConfig::default(),
        )
        .with_event_forwarder(forwarder);

        let req = JsonRpcRequest::new(
            "rim.events.subscribe",
            Some(serde_json::json!({"event_types": []})),
            1,
        );
        let resp = broker.handle_request(&req).await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, wire::INVALID_PARAMS);
    }

    #[tokio::test]
    async fn events_subscribe_wildcard_rejected() {
        let forwarder = Arc::new(EventForwarder::new());
        let mut broker = PluginBroker::new(
            "dev.example.test".into(),
            CapabilityGate::new(vec!["events.read".into()]),
            BrokerConfig::default(),
        )
        .with_event_forwarder(forwarder);

        let req = JsonRpcRequest::new(
            "rim.events.subscribe",
            Some(serde_json::json!({"event_types": ["*"]})),
            1,
        );
        let resp = broker.handle_request(&req).await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, wire::INVALID_PARAMS);
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

        // No backend client, so the call will fail at dispatch, but rate limiting
        // happens before dispatch. First two calls should pass capability + rate check.
        let req = JsonRpcRequest::new(
            "rim.chat.send_message",
            Some(serde_json::json!({"server_id": "a", "conversation_id": "b", "text": "c"})),
            1,
        );

        // Call 1 and 2 — should pass rate limit (fail at dispatch with INTERNAL_ERROR)
        let resp1 = broker.handle_request(&req).await;
        assert_eq!(resp1.error.as_ref().unwrap().code, INTERNAL_ERROR);

        let resp2 = broker.handle_request(&req).await;
        assert_eq!(resp2.error.as_ref().unwrap().code, INTERNAL_ERROR);

        // Call 3 — should be rate limited
        let resp3 = broker.handle_request(&req).await;
        assert_eq!(resp3.error.as_ref().unwrap().code, RATE_LIMITED);
    }

    // ── Host → plugin requests through the broker loop ──

    type PluginSide = tokio::io::DuplexStream;

    /// Start a broker loop on one end of an in-memory pipe; the other end plays the plugin.
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
