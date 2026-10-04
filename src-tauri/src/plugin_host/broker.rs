#![allow(dead_code)]

use crate::plugin_host::backend_client::{self, AuditEntry, BackendClient};
use crate::plugin_host::capability::{self, CapabilityGate};
use crate::plugin_host::event_forwarder::EventForwarder;
use crate::plugin_host::panel_relay::PanelRelay;
use crate::plugin_host::wire::{
    self, JsonRpcRequest, JsonRpcResponse, WireError, CAPABILITY_DENIED, INTERNAL_ERROR,
    METHOD_NOT_FOUND, RATE_LIMITED,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::Mutex;
use tokio::time::timeout;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_RATE_LIMIT: u32 = 120; // calls per minute per capability

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
            "rim.log" => self.handle_log(request),
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
        if let Some(params) = &request.params {
            let level = params
                .get("level")
                .and_then(|v| v.as_str())
                .unwrap_or("info");
            let message = params.get("message").and_then(|v| v.as_str()).unwrap_or("");
            log::info!("[plugin:{}] [{}] {}", self.plugin_id, level, message);
        }
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
        JsonRpcRequest::new("rim.heartbeat", None, id)
    }

    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }

    pub fn update_capabilities(&mut self, approved: Vec<String>) {
        self.gate.update_capabilities(approved);
    }
}

/// Run the broker read loop.
pub async fn run_broker_loop<R, W>(
    broker: &Mutex<PluginBroker>,
    reader: &Mutex<R>,
    writer: &Mutex<W>,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
) where
    R: AsyncRead + Unpin + Send,
    W: AsyncWrite + Unpin + Send,
{
    let mut heartbeat_interval = tokio::time::interval(HEARTBEAT_INTERVAL);
    heartbeat_interval.tick().await; // skip first immediate tick

    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    log::info!("broker loop shutting down for plugin");
                    break;
                }
            }
            _ = heartbeat_interval.tick() => {
                let ping = {
                    let mut b = broker.lock().await;
                    b.create_heartbeat_ping()
                };
                let mut w = writer.lock().await;
                if wire::write_frame(&mut *w, &ping).await.is_err() {
                    log::warn!("failed to send heartbeat, plugin may have exited");
                    break;
                }
                let result = {
                    let mut r = reader.lock().await;
                    timeout(HEARTBEAT_TIMEOUT, wire::read_raw_frame(&mut *r)).await
                };
                match result {
                    Ok(Ok(_)) => {
                        broker.lock().await.responsive = true;
                    }
                    Ok(Err(WireError::ConnectionClosed)) => {
                        log::warn!("plugin connection closed during heartbeat");
                        break;
                    }
                    Ok(Err(e)) => {
                        log::warn!("heartbeat read error: {}", e);
                        broker.lock().await.responsive = false;
                    }
                    Err(_) => {
                        log::warn!("heartbeat timeout — plugin unresponsive");
                        broker.lock().await.responsive = false;
                    }
                }
            }
            frame = async {
                let mut r = reader.lock().await;
                wire::read_frame::<_, JsonRpcRequest>(&mut *r).await
            } => {
                match frame {
                    Ok(request) => {
                        let response = {
                            let mut b = broker.lock().await;
                            b.handle_request(&request).await
                        };
                        let mut w = writer.lock().await;
                        if wire::write_frame(&mut *w, &response).await.is_err() {
                            log::warn!("failed to write response to plugin");
                            break;
                        }
                    }
                    Err(WireError::ConnectionClosed) => {
                        log::info!("plugin connection closed");
                        break;
                    }
                    Err(e) => {
                        log::warn!("error reading from plugin: {}", e);
                        break;
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
    async fn unknown_method_denied_by_capability_gate() {
        let mut broker = test_broker();
        let req = JsonRpcRequest::new("rim.nonexistent", None, 1);
        let resp = broker.handle_request(&req).await;
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, CAPABILITY_DENIED);
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
}
