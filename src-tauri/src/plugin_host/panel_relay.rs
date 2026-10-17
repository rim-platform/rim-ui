use std::collections::HashMap;
use std::sync::RwLock;

use tokio::sync::broadcast;

const MAX_STATE_SIZE_BYTES: usize = 1024 * 1024; // 1 MiB per plugin
/// Changes a slow listener may fall behind by before it misses some. A panel
/// only needs the newest state, so a lagging listener skips to it.
const CHANGE_QUEUE: usize = 64;

/// A panel's new state, pushed to the UI as the `plugin-panel-state` event so an
/// open panel sees each update as it happens.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct PanelStateChange {
    pub plugin_id: String,
    pub panel_id: String,
    /// The whole state after the change; `null` when the plugin stopped.
    pub state: serde_json::Value,
}

#[derive(Debug, thiserror::Error)]
pub enum PanelRelayError {
    #[error("state size exceeds limit ({0} bytes, max {MAX_STATE_SIZE_BYTES})")]
    StateTooLarge(usize),
    #[error("lock poisoned")]
    LockPoisoned,
}

impl serde::Serialize for PanelRelayError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Caches panel state per plugin per panel. The plugin process sends state
/// updates over the wire protocol; the host caches them and the UI forwards
/// them to the panel's iframe with postMessage.
pub struct PanelRelay {
    /// plugin_id -> (panel_id -> state JSON)
    states: RwLock<HashMap<String, HashMap<String, serde_json::Value>>>,
    changes: broadcast::Sender<PanelStateChange>,
}

impl PanelRelay {
    pub fn new() -> Self {
        Self {
            states: RwLock::new(HashMap::new()),
            changes: broadcast::channel(CHANGE_QUEUE).0,
        }
    }

    /// Every state change from now on, in order. The app forwards them to the UI.
    pub fn subscribe(&self) -> broadcast::Receiver<PanelStateChange> {
        self.changes.subscribe()
    }

    fn publish(&self, plugin_id: &str, panel_id: &str, state: serde_json::Value) {
        // No receiver (tests, or before the app subscribed) is not an error.
        let _ = self.changes.send(PanelStateChange {
            plugin_id: plugin_id.to_string(),
            panel_id: panel_id.to_string(),
            state,
        });
    }

    /// Replaces the state of a plugin's panel.
    ///
    /// # Errors
    ///
    /// Returns [`PanelRelayError::StateTooLarge`] when the plugin's states would
    /// exceed the size limit, and [`PanelRelayError::LockPoisoned`] when the
    /// cache lock is poisoned.
    pub fn set_state(
        &self,
        plugin_id: &str,
        panel_id: &str,
        state: serde_json::Value,
    ) -> Result<(), PanelRelayError> {
        self.check_size(plugin_id, &state)?;

        let mut states = self
            .states
            .write()
            .map_err(|_| PanelRelayError::LockPoisoned)?;
        states
            .entry(plugin_id.to_string())
            .or_default()
            .insert(panel_id.to_string(), state.clone());
        drop(states);
        self.publish(plugin_id, panel_id, state);
        Ok(())
    }

    /// Patches the state of a plugin's panel with a shallow merge of top-level
    /// keys, and returns the merged state. A patch over a state that is not an
    /// object replaces it.
    ///
    /// # Errors
    ///
    /// Returns [`PanelRelayError::StateTooLarge`] when the merged states exceed
    /// the size limit, in which case the panel's state is removed, and
    /// [`PanelRelayError::LockPoisoned`] when the cache lock is poisoned.
    pub fn patch_state(
        &self,
        plugin_id: &str,
        panel_id: &str,
        patch: serde_json::Value,
    ) -> Result<serde_json::Value, PanelRelayError> {
        let mut states = self
            .states
            .write()
            .map_err(|_| PanelRelayError::LockPoisoned)?;
        let plugin_states = states.entry(plugin_id.to_string()).or_default();
        let current = plugin_states
            .entry(panel_id.to_string())
            .or_insert_with(|| serde_json::json!({}));

        // Shallow merge, only when both are objects.
        if let (Some(current_obj), Some(patch_obj)) = (current.as_object_mut(), patch.as_object()) {
            for (key, value) in patch_obj {
                current_obj.insert(key.clone(), value.clone());
            }
        } else {
            // A current state that is not an object is replaced entirely.
            *current = patch;
        }

        let merged = current.clone();

        // Check the size after the merge.
        let total = self.total_size_for_plugin_inner(&states, plugin_id);
        if total > MAX_STATE_SIZE_BYTES {
            // Roll back by removing the panel state.
            if let Some(ps) = states.get_mut(plugin_id) {
                ps.remove(panel_id);
            }
            return Err(PanelRelayError::StateTooLarge(total));
        }

        drop(states);
        self.publish(plugin_id, panel_id, merged.clone());
        Ok(merged)
    }

    /// Returns the cached state of a plugin's panel, if any.
    ///
    /// # Errors
    ///
    /// Returns [`PanelRelayError::LockPoisoned`] when the cache lock is poisoned.
    pub fn get_state(
        &self,
        plugin_id: &str,
        panel_id: &str,
    ) -> Result<Option<serde_json::Value>, PanelRelayError> {
        let states = self
            .states
            .read()
            .map_err(|_| PanelRelayError::LockPoisoned)?;
        Ok(states
            .get(plugin_id)
            .and_then(|ps| ps.get(panel_id))
            .cloned())
    }

    /// Drops all state of a plugin (on disable, uninstall or crash).
    ///
    /// # Errors
    ///
    /// Returns [`PanelRelayError::LockPoisoned`] when the cache lock is poisoned.
    pub fn cleanup_plugin(&self, plugin_id: &str) -> Result<(), PanelRelayError> {
        let mut states = self
            .states
            .write()
            .map_err(|_| PanelRelayError::LockPoisoned)?;
        let panels = states.remove(plugin_id);
        drop(states);
        // Tell open panels the plugin's state is gone, so none shows stale data.
        for panel_id in panels.into_iter().flat_map(|p| p.into_keys()) {
            self.publish(plugin_id, &panel_id, serde_json::Value::Null);
        }
        Ok(())
    }

    fn check_size(
        &self,
        plugin_id: &str,
        new_state: &serde_json::Value,
    ) -> Result<(), PanelRelayError> {
        let new_size = serde_json::to_string(new_state)
            .map(|s| s.len())
            .unwrap_or(0);

        let states = self
            .states
            .read()
            .map_err(|_| PanelRelayError::LockPoisoned)?;
        let existing_size = self.total_size_for_plugin_inner(&states, plugin_id);

        // Conservative: the new state replaces one panel's, but is checked
        // against the plugin's whole total.
        if existing_size + new_size > MAX_STATE_SIZE_BYTES {
            return Err(PanelRelayError::StateTooLarge(existing_size + new_size));
        }
        Ok(())
    }

    fn total_size_for_plugin_inner(
        &self,
        states: &HashMap<String, HashMap<String, serde_json::Value>>,
        plugin_id: &str,
    ) -> usize {
        states
            .get(plugin_id)
            .map(|ps| {
                ps.values()
                    .map(|v| serde_json::to_string(v).map(|s| s.len()).unwrap_or(0))
                    .sum()
            })
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get_state() {
        let relay = PanelRelay::new();
        relay
            .set_state("dev.example.test", "main", serde_json::json!({"count": 42}))
            .unwrap();

        let state = relay.get_state("dev.example.test", "main").unwrap();
        assert_eq!(state, Some(serde_json::json!({"count": 42})));
    }

    #[test]
    fn get_nonexistent_returns_none() {
        let relay = PanelRelay::new();
        let state = relay.get_state("dev.example.test", "main").unwrap();
        assert!(state.is_none());
    }

    #[test]
    fn patch_state_merges() {
        let relay = PanelRelay::new();
        relay
            .set_state(
                "dev.example.test",
                "main",
                serde_json::json!({"a": 1, "b": 2}),
            )
            .unwrap();

        let merged = relay
            .patch_state(
                "dev.example.test",
                "main",
                serde_json::json!({"b": 99, "c": 3}),
            )
            .unwrap();

        assert_eq!(merged, serde_json::json!({"a": 1, "b": 99, "c": 3}));

        let state = relay
            .get_state("dev.example.test", "main")
            .unwrap()
            .unwrap();
        assert_eq!(state, serde_json::json!({"a": 1, "b": 99, "c": 3}));
    }

    #[test]
    fn patch_creates_if_absent() {
        let relay = PanelRelay::new();
        let merged = relay
            .patch_state("dev.example.test", "main", serde_json::json!({"x": 1}))
            .unwrap();
        assert_eq!(merged, serde_json::json!({"x": 1}));
    }

    #[test]
    fn cleanup_removes_all_panels() {
        let relay = PanelRelay::new();
        relay
            .set_state("dev.example.test", "panel_a", serde_json::json!({"a": 1}))
            .unwrap();
        relay
            .set_state("dev.example.test", "panel_b", serde_json::json!({"b": 2}))
            .unwrap();

        relay.cleanup_plugin("dev.example.test").unwrap();

        assert!(relay
            .get_state("dev.example.test", "panel_a")
            .unwrap()
            .is_none());
        assert!(relay
            .get_state("dev.example.test", "panel_b")
            .unwrap()
            .is_none());
    }

    #[test]
    fn cleanup_does_not_affect_other_plugins() {
        let relay = PanelRelay::new();
        relay
            .set_state("dev.example.a", "main", serde_json::json!({"a": 1}))
            .unwrap();
        relay
            .set_state("dev.example.b", "main", serde_json::json!({"b": 2}))
            .unwrap();

        relay.cleanup_plugin("dev.example.a").unwrap();

        assert!(relay.get_state("dev.example.a", "main").unwrap().is_none());
        assert!(relay.get_state("dev.example.b", "main").unwrap().is_some());
    }

    #[test]
    fn every_change_is_pushed_with_the_whole_state() {
        let relay = PanelRelay::new();
        let mut changes = relay.subscribe();
        relay
            .set_state("dev.example.test", "main", serde_json::json!({"a": 1}))
            .unwrap();
        relay
            .patch_state("dev.example.test", "main", serde_json::json!({"b": 2}))
            .unwrap();
        relay.cleanup_plugin("dev.example.test").unwrap();

        let change = |state| PanelStateChange {
            plugin_id: "dev.example.test".into(),
            panel_id: "main".into(),
            state,
        };
        assert_eq!(
            changes.try_recv().unwrap(),
            change(serde_json::json!({"a": 1}))
        );
        assert_eq!(
            changes.try_recv().unwrap(),
            change(serde_json::json!({"a": 1, "b": 2}))
        );
        assert_eq!(changes.try_recv().unwrap(), change(serde_json::Value::Null));
        assert!(changes.try_recv().is_err(), "nothing else was pushed");
    }

    #[test]
    fn a_refused_change_is_not_pushed() {
        let relay = PanelRelay::new();
        let mut changes = relay.subscribe();
        let big_string = "x".repeat(MAX_STATE_SIZE_BYTES + 1);
        assert!(relay
            .set_state("dev.example.test", "main", serde_json::json!(big_string))
            .is_err());
        assert!(relay
            .patch_state(
                "dev.example.test",
                "main",
                serde_json::json!({"s": big_string})
            )
            .is_err());
        assert!(changes.try_recv().is_err());
    }

    #[test]
    fn state_size_limit_enforced() {
        let relay = PanelRelay::new();
        // Create a state just over 1 MiB
        let big_string = "x".repeat(MAX_STATE_SIZE_BYTES + 1);
        let err = relay
            .set_state("dev.example.test", "main", serde_json::json!(big_string))
            .unwrap_err();
        assert!(matches!(err, PanelRelayError::StateTooLarge(_)));
    }
}
