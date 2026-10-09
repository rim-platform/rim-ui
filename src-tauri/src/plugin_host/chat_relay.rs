//! The `rim.chat.*` calls of local-process plugins, handed to the UI's message service.
//!
//! The message service runs in the webview: it reads the local cache through the cache's
//! Tauri commands and sends through the person's own send path, which needs the session
//! cookie and, in an encrypted conversation, the MLS group code. The broker admits a call
//! (capability and rate limit), and the relay pushes it to the UI as [`PLUGIN_CHAT_EVENT`];
//! the UI answers with `plugin_chat_respond`, which completes the waiting call.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{broadcast, oneshot};

use crate::plugin_host::wire::{JsonRpcError, INTERNAL_ERROR};

/// UI event carrying a [`ChatRequest`].
pub const PLUGIN_CHAT_EVENT: &str = "plugin-chat-request";

/// How long a call waits for the UI's answer.
pub const CHAT_TIMEOUT: Duration = Duration::from_secs(30);

/// How many calls may wait for the UI to pick them up.
const QUEUE: usize = 64;

/// One plugin call for the UI's message service.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: u64,
    pub plugin_id: String,
    pub method: String,
    pub params: serde_json::Value,
    /// The capabilities the plugin was started with, which the service checks the
    /// encrypted grants against.
    pub granted_capabilities: Vec<String>,
}

type Reply = Result<serde_json::Value, JsonRpcError>;

pub struct ChatRelay {
    tx: broadcast::Sender<ChatRequest>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next_id: AtomicU64,
    timeout: Duration,
}

impl Default for ChatRelay {
    fn default() -> Self {
        Self::new(CHAT_TIMEOUT)
    }
}

fn internal(message: &str) -> JsonRpcError {
    JsonRpcError {
        code: INTERNAL_ERROR,
        message: message.to_string(),
        data: None,
    }
}

impl ChatRelay {
    pub fn new(timeout: Duration) -> Self {
        let (tx, _) = broadcast::channel(QUEUE);
        Self {
            tx,
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            timeout,
        }
    }

    /// Calls for the UI, as they are made.
    pub fn subscribe(&self) -> broadcast::Receiver<ChatRequest> {
        self.tx.subscribe()
    }

    /// Hand one call to the UI and wait for its answer: the result, or the JSON-RPC
    /// error the plugin gets.
    pub async fn call(
        &self,
        plugin_id: &str,
        method: &str,
        params: serde_json::Value,
        granted_capabilities: Vec<String>,
    ) -> Reply {
        let request_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (reply, answer) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(request_id, reply);
        }
        let request = ChatRequest {
            request_id,
            plugin_id: plugin_id.to_string(),
            method: method.to_string(),
            params,
            granted_capabilities,
        };
        if self.tx.send(request).is_err() {
            self.forget(request_id);
            return Err(internal("the app is not ready to answer chat calls"));
        }
        match tokio::time::timeout(self.timeout, answer).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err(internal("the app dropped the chat call")),
            Err(_) => {
                self.forget(request_id);
                Err(internal("the app did not answer the chat call in time"))
            }
        }
    }

    /// The UI's answer to `request_id`. False when no call waits for it (it timed out,
    /// or the id is unknown).
    pub fn respond(&self, request_id: u64, reply: Reply) -> bool {
        let waiting = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(&request_id));
        match waiting {
            Some(tx) => tx.send(reply).is_ok(),
            None => false,
        }
    }

    fn forget(&self, request_id: u64) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&request_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn a_call_reaches_the_ui_and_gets_its_answer() {
        let relay = Arc::new(ChatRelay::default());
        let mut ui = relay.subscribe();
        let answering = {
            let relay = relay.clone();
            tokio::spawn(async move {
                let request = ui.recv().await.unwrap();
                assert_eq!(request.plugin_id, "dev.example.reader");
                assert_eq!(request.method, "rim.chat.list_messages");
                assert_eq!(request.granted_capabilities, vec!["chat.read".to_string()]);
                assert!(relay.respond(
                    request.request_id,
                    Ok(serde_json::json!({ "messages": [] }))
                ));
            })
        };
        let reply = relay
            .call(
                "dev.example.reader",
                "rim.chat.list_messages",
                serde_json::json!({ "conversationId": "c" }),
                vec!["chat.read".into()],
            )
            .await;
        assert_eq!(reply.unwrap(), serde_json::json!({ "messages": [] }));
        answering.await.unwrap();
    }

    #[tokio::test]
    async fn the_ui_can_answer_with_an_error() {
        let relay = Arc::new(ChatRelay::default());
        let mut ui = relay.subscribe();
        let answering = {
            let relay = relay.clone();
            tokio::spawn(async move {
                let request = ui.recv().await.unwrap();
                relay.respond(
                    request.request_id,
                    Err(JsonRpcError {
                        code: crate::plugin_host::wire::CAPABILITY_DENIED,
                        message: "capability denied: chat.read.encrypted".into(),
                        data: None,
                    }),
                );
            })
        };
        let err = relay
            .call("p", "rim.chat.get_message", serde_json::json!({}), vec![])
            .await
            .unwrap_err();
        assert_eq!(err.code, crate::plugin_host::wire::CAPABILITY_DENIED);
        answering.await.unwrap();
    }

    #[tokio::test]
    async fn without_a_listener_the_call_fails_at_once() {
        let relay = ChatRelay::default();
        let err = relay
            .call("p", "rim.chat.list_messages", serde_json::json!({}), vec![])
            .await
            .unwrap_err();
        assert_eq!(err.code, INTERNAL_ERROR);
    }

    #[tokio::test]
    async fn an_unanswered_call_times_out_and_a_late_answer_is_dropped() {
        let relay = ChatRelay::new(Duration::from_millis(20));
        let mut ui = relay.subscribe();
        let err = relay
            .call("p", "rim.chat.list_messages", serde_json::json!({}), vec![])
            .await
            .unwrap_err();
        assert_eq!(err.code, INTERNAL_ERROR);
        let request = ui.recv().await.unwrap();
        assert!(!relay.respond(request.request_id, Ok(serde_json::json!({}))));
    }
}
