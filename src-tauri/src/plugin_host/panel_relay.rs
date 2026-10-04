#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::RwLock;

const MAX_STATE_SIZE_BYTES: usize = 1024 * 1024; // 1 MiB per plugin

#[derive(Debug, thiserror::Error)]
pub enum PanelRelayError {
    #[error("state size exceeds limit ({0} bytes, max {MAX_STATE_SIZE_BYTES})")]
    StateTooLarge(usize),
    #[error("panel '{panel_id}' not declared in manifest of plugin '{plugin_id}'")]
    PanelNotOwned { plugin_id: String, panel_id: String },
    #[error("lock poisoned")]
    LockPoisoned,
}

impl serde::Serialize for PanelRelayError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Caches panel state per plugin per panel.
/// Plugin process sends state updates via wire protocol, host caches
/// and forwards to the iframe panel via postMessage (frontend side).
pub struct PanelRelay {
    /// plugin_id -> (panel_id -> state JSON)
    states: RwLock<HashMap<String, HashMap<String, serde_json::Value>>>,
}

impl PanelRelay {
    pub fn new() -> Self {
        Self {
            states: RwLock::new(HashMap::new()),
        }
    }

    /// Full replace of panel state for a plugin's panel.
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
            .insert(panel_id.to_string(), state);
        Ok(())
    }

    /// Patch (shallow merge) panel state — merges top-level keys.
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

        // Shallow merge: only merge if both are objects
        if let (Some(current_obj), Some(patch_obj)) = (current.as_object_mut(), patch.as_object()) {
            for (key, value) in patch_obj {
                current_obj.insert(key.clone(), value.clone());
            }
        } else {
            // If current isn't an object, replace entirely
            *current = patch;
        }

        let merged = current.clone();

        // Check size after merge
        let total = self.total_size_for_plugin_inner(&states, plugin_id);
        if total > MAX_STATE_SIZE_BYTES {
            // Rollback by removing the panel state
            if let Some(ps) = states.get_mut(plugin_id) {
                ps.remove(panel_id);
            }
            return Err(PanelRelayError::StateTooLarge(total));
        }

        Ok(merged)
    }

    /// Get cached state for a plugin's panel.
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

    /// Clean up all state for a plugin (on disable/uninstall/crash).
    pub fn cleanup_plugin(&self, plugin_id: &str) -> Result<(), PanelRelayError> {
        let mut states = self
            .states
            .write()
            .map_err(|_| PanelRelayError::LockPoisoned)?;
        states.remove(plugin_id);
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

        // Approximate: new state replaces one panel, but we check total conservatively
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
