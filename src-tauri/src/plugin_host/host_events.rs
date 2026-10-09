//! Plugin processes coming up and going away, pushed to the UI as
//! [`PLUGIN_EVENT`] so its plugin list (health, the side rail's panels) follows
//! without polling.

use tokio::sync::broadcast;

/// UI event carrying a [`PluginEvent`].
pub const PLUGIN_EVENT: &str = "plugin-event";

/// How many events a slow UI may fall behind before older ones are dropped.
const QUEUE: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginEventKind {
    /// The plugin finished its handshake and takes commands.
    PluginStarted,
    /// The plugin's process ended: stopped, crashed, or failed its handshake.
    PluginStopped,
}

/// Mirror of the UI's `PluginEvent`.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct PluginEvent {
    pub plugin_id: String,
    pub kind: PluginEventKind,
    pub timestamp: String,
}

pub struct PluginEvents {
    tx: broadcast::Sender<PluginEvent>,
}

impl Default for PluginEvents {
    fn default() -> Self {
        Self::new()
    }
}

impl PluginEvents {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(QUEUE);
        Self { tx }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PluginEvent> {
        self.tx.subscribe()
    }

    pub fn publish(&self, plugin_id: &str, kind: PluginEventKind) {
        // No receiver (no UI yet, or a test) is fine: the UI reads the list when it starts.
        let _ = self.tx.send(PluginEvent {
            plugin_id: plugin_id.to_string(),
            kind,
            timestamp: chrono::Utc::now().to_rfc3339(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_serialize_as_the_ui_reads_them() {
        let events = PluginEvents::new();
        let mut rx = events.subscribe();
        events.publish("chat.rim.k8s-pods", PluginEventKind::PluginStarted);
        let event = rx.try_recv().unwrap();
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["plugin_id"], "chat.rim.k8s-pods");
        assert_eq!(json["kind"], "plugin_started");
        assert!(json["timestamp"].as_str().is_some_and(|t| !t.is_empty()));
    }

    #[test]
    fn publishing_without_a_listener_is_fine() {
        PluginEvents::new().publish("p", PluginEventKind::PluginStopped);
    }
}
