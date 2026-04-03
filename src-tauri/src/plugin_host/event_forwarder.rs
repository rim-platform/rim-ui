#![allow(dead_code)]

use crate::plugin_host::wire::{self, JsonRpcNotification, WireError};
use std::collections::{HashMap, HashSet};
use tokio::io::AsyncWrite;
use tokio::sync::{Mutex, RwLock};

/// Allowed event types that plugins can subscribe to.
/// Wildcard "*" is NOT allowed — plugins must request explicit event types.
const ALLOWED_EVENT_TYPES: &[&str] = &[
    "message.created",
    "message.edited",
    "message.deleted",
    "conversation.created",
    "conversation.updated",
    "member.joined",
    "member.left",
    "typing.started",
    "typing.stopped",
];

#[derive(Debug, thiserror::Error)]
pub enum EventForwarderError {
    #[error("wildcard subscriptions are not allowed")]
    WildcardNotAllowed,
    #[error("unknown event type: {0}")]
    UnknownEventType(String),
}

/// Tracks which plugins are subscribed to which event types,
/// and which conversations they are allowed to receive events from.
pub struct EventForwarder {
    /// plugin_id -> set of subscribed event types
    subscriptions: RwLock<HashMap<String, HashSet<String>>>,
    /// plugin_id -> set of conversation_ids the plugin is allowed to access.
    /// If empty, the plugin receives events only from public channels.
    allowed_conversations: RwLock<HashMap<String, HashSet<String>>>,
}

impl EventForwarder {
    pub fn new() -> Self {
        Self {
            subscriptions: RwLock::new(HashMap::new()),
            allowed_conversations: RwLock::new(HashMap::new()),
        }
    }

    /// Register a plugin's interest in specific event types.
    /// Rejects wildcard "*" and unknown event types.
    pub async fn subscribe(
        &self,
        plugin_id: &str,
        event_types: Vec<String>,
    ) -> Result<(), EventForwarderError> {
        // Validate all event types before subscribing
        for event_type in &event_types {
            if event_type == "*" {
                return Err(EventForwarderError::WildcardNotAllowed);
            }
            if !ALLOWED_EVENT_TYPES.contains(&event_type.as_str()) {
                return Err(EventForwarderError::UnknownEventType(event_type.clone()));
            }
        }

        let mut subs = self.subscriptions.write().await;
        let plugin_subs = subs.entry(plugin_id.to_string()).or_default();
        for event_type in &event_types {
            plugin_subs.insert(event_type.clone());
        }
        log::info!(
            "plugin {} subscribed to events: {:?}",
            plugin_id,
            event_types
        );
        Ok(())
    }

    /// Grant a plugin access to events from a specific conversation.
    pub async fn grant_conversation_access(&self, plugin_id: &str, conversation_id: &str) {
        let mut allowed = self.allowed_conversations.write().await;
        allowed
            .entry(plugin_id.to_string())
            .or_default()
            .insert(conversation_id.to_string());
    }

    /// Revoke all conversation access for a plugin.
    pub async fn revoke_all_conversation_access(&self, plugin_id: &str) {
        let mut allowed = self.allowed_conversations.write().await;
        allowed.remove(plugin_id);
    }

    /// Remove all subscriptions for a plugin (e.g. on disable/uninstall).
    pub async fn unsubscribe_all(&self, plugin_id: &str) {
        let mut subs = self.subscriptions.write().await;
        subs.remove(plugin_id);
        let mut allowed = self.allowed_conversations.write().await;
        allowed.remove(plugin_id);
        log::info!("plugin {} unsubscribed from all events", plugin_id);
    }

    /// Get the set of plugins subscribed to a given event type,
    /// filtered by conversation access.
    /// `conversation_id`: the conversation the event originated from.
    /// `is_public_channel`: whether the conversation is a public channel.
    pub async fn subscribers_for(
        &self,
        event_type: &str,
        conversation_id: Option<&str>,
        is_public_channel: bool,
    ) -> Vec<String> {
        let subs = self.subscriptions.read().await;
        let allowed = self.allowed_conversations.read().await;

        subs.iter()
            .filter_map(|(plugin_id, types)| {
                if !types.contains(event_type) {
                    return None;
                }
                // Public channel events are visible to all subscribed plugins
                if is_public_channel {
                    return Some(plugin_id.clone());
                }
                // For DM/group events, check conversation access
                if let Some(conv_id) = conversation_id {
                    if let Some(plugin_convs) = allowed.get(plugin_id) {
                        if plugin_convs.contains(conv_id) {
                            return Some(plugin_id.clone());
                        }
                    }
                }
                // No access to this conversation's events
                None
            })
            .collect()
    }

    /// Deliver an event to a plugin process via its stdin writer.
    pub async fn deliver_event<W: AsyncWrite + Unpin + Send>(
        writer: &Mutex<W>,
        event_type: &str,
        payload: serde_json::Value,
    ) -> Result<(), WireError> {
        let notification = JsonRpcNotification::new(
            format!("rim.event.{event_type}"),
            Some(payload),
        );
        let mut w = writer.lock().await;
        wire::write_frame(&mut *w, &notification).await
    }

    /// Check if a plugin has any active subscriptions.
    pub async fn has_subscriptions(&self, plugin_id: &str) -> bool {
        let subs = self.subscriptions.read().await;
        subs.get(plugin_id)
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn subscribe_and_query() {
        let forwarder = EventForwarder::new();

        forwarder
            .subscribe("dev.example.a", vec!["message.created".into(), "message.deleted".into()])
            .await
            .unwrap();
        forwarder
            .subscribe("dev.example.b", vec!["message.created".into()])
            .await
            .unwrap();

        // Public channel events visible to all subscribers
        let subs = forwarder
            .subscribers_for("message.created", Some("conv1"), true)
            .await;
        assert_eq!(subs.len(), 2);

        let subs = forwarder
            .subscribers_for("message.deleted", Some("conv1"), true)
            .await;
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0], "dev.example.a");

        let subs = forwarder
            .subscribers_for("message.edited", Some("conv1"), true)
            .await;
        assert!(subs.is_empty());
    }

    #[tokio::test]
    async fn wildcard_rejected() {
        let forwarder = EventForwarder::new();
        let err = forwarder
            .subscribe("dev.example.all", vec!["*".into()])
            .await
            .unwrap_err();
        assert!(matches!(err, EventForwarderError::WildcardNotAllowed));
    }

    #[tokio::test]
    async fn unknown_event_type_rejected() {
        let forwarder = EventForwarder::new();
        let err = forwarder
            .subscribe("dev.example.test", vec!["something.unknown".into()])
            .await
            .unwrap_err();
        assert!(matches!(err, EventForwarderError::UnknownEventType(_)));
    }

    #[tokio::test]
    async fn dm_events_filtered_without_access() {
        let forwarder = EventForwarder::new();
        forwarder
            .subscribe("dev.example.a", vec!["message.created".into()])
            .await
            .unwrap();

        // DM event — plugin has no conversation access
        let subs = forwarder
            .subscribers_for("message.created", Some("dm-conv-123"), false)
            .await;
        assert!(subs.is_empty());
    }

    #[tokio::test]
    async fn dm_events_visible_with_access() {
        let forwarder = EventForwarder::new();
        forwarder
            .subscribe("dev.example.a", vec!["message.created".into()])
            .await
            .unwrap();
        forwarder
            .grant_conversation_access("dev.example.a", "dm-conv-123")
            .await;

        let subs = forwarder
            .subscribers_for("message.created", Some("dm-conv-123"), false)
            .await;
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0], "dev.example.a");

        // Different DM — still no access
        let subs = forwarder
            .subscribers_for("message.created", Some("dm-conv-456"), false)
            .await;
        assert!(subs.is_empty());
    }

    #[tokio::test]
    async fn unsubscribe_all_clears_conversation_access() {
        let forwarder = EventForwarder::new();
        forwarder
            .subscribe("dev.example.a", vec!["message.created".into()])
            .await
            .unwrap();
        forwarder
            .grant_conversation_access("dev.example.a", "conv-1")
            .await;
        assert!(forwarder.has_subscriptions("dev.example.a").await);

        forwarder.unsubscribe_all("dev.example.a").await;
        assert!(!forwarder.has_subscriptions("dev.example.a").await);

        let subs = forwarder
            .subscribers_for("message.created", Some("conv-1"), false)
            .await;
        assert!(subs.is_empty());
    }

    #[tokio::test]
    async fn deliver_event_writes_frame() {
        let buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let writer = buf.clone();

        EventForwarder::deliver_event(
            &writer,
            "message.created",
            serde_json::json!({"messageId": "abc"}),
        )
        .await
        .unwrap();

        let data = buf.lock().await;
        assert!(!data.is_empty());

        let mut cursor = std::io::Cursor::new(data.as_slice());
        let notif: JsonRpcNotification = wire::read_frame(&mut cursor).await.unwrap();
        assert_eq!(notif.method, "rim.event.message.created");
        assert!(notif.params.is_some());
    }
}
