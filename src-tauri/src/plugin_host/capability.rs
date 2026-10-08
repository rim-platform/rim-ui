#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::LazyLock;

/// Maps JSON-RPC method names to required capabilities.
static METHOD_CAPABILITY_MAP: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    // Chat capabilities
    m.insert("rim.chat.send_message", "chat.write");
    m.insert("rim.chat.get_messages", "chat.read");
    m.insert("rim.chat.search_messages", "chat.read");
    m.insert("rim.chat.edit_message", "chat.write");
    m.insert("rim.chat.delete_message", "chat.write");
    // Events capabilities
    m.insert("rim.events.subscribe", "events.read");
    // Local process capabilities
    m.insert("rim.process.spawn", "local.process");
    m.insert("rim.process.kill", "local.process");
    // Network capabilities
    m.insert("rim.network.http_request", "network");
    m.insert("rim.network.websocket_connect", "network");
    // File system capabilities
    m.insert("rim.fs.read_file", "fs.read");
    m.insert("rim.fs.write_file", "fs.write");
    m.insert("rim.fs.list_dir", "fs.read");
    // UI capabilities
    m.insert("rim.ui.show_notification", "ui.notify");
    m.insert("rim.ui.show_panel", "ui.panel");
    m.insert("rim.ui.update_panel", "ui.panel");
    // Log is always allowed (no capability required)
    m
});

/// Built-in capability names a manifest may request next to its own
/// `plugin.<plugin_id>.<verb>` keys (see `validation.rs`).
///
/// Each one guards something the host does today: a method the broker
/// dispatches (`chat.*`, `events.read`, `ui.panel`), or, for `ui.notify`, the
/// notifications a panel sends through the frontend bridge (`pluginBridge.ts`).
/// Names in [`METHOD_CAPABILITY_MAP`] that guard nothing yet (`local.process`,
/// `network`, `fs.*`) stay out, so the approval prompt never asks for a
/// permission that does nothing.
pub const BUILTIN_CAPABILITIES: &[&str] = &[
    "chat.read",
    "chat.write",
    "events.read",
    "ui.panel",
    "ui.notify",
];

/// Methods that are always allowed without capability approval.
const ALWAYS_ALLOWED: &[&str] = &["rim.log", "rim.heartbeat_response"];

#[derive(Debug, Clone)]
pub struct CapabilityGate {
    approved_capabilities: Vec<String>,
}

impl CapabilityGate {
    pub fn new(approved_capabilities: Vec<String>) -> Self {
        Self {
            approved_capabilities,
        }
    }

    /// Check whether a plugin is allowed to call the given method.
    /// Returns Ok(()) if allowed, Err(required_capability) if denied.
    pub fn check(&self, method: &str) -> Result<(), String> {
        if ALWAYS_ALLOWED.contains(&method) {
            return Ok(());
        }

        match METHOD_CAPABILITY_MAP.get(method) {
            Some(required_cap) => {
                if self.approved_capabilities.iter().any(|c| c == required_cap) {
                    Ok(())
                } else {
                    Err(required_cap.to_string())
                }
            }
            // No capability guards an unknown method; the broker answers it with
            // METHOD_NOT_FOUND, so it never reaches a handler.
            None => Ok(()),
        }
    }

    pub fn update_capabilities(&mut self, approved: Vec<String>) {
        self.approved_capabilities = approved;
    }
}

/// Look up the capability required for a method. Returns None if always-allowed or unknown.
pub fn capability_for_method(method: &str) -> Option<&'static str> {
    if ALWAYS_ALLOWED.contains(&method) {
        return None;
    }
    METHOD_CAPABILITY_MAP.get(method).copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_builtin_capability_guards_a_method() {
        for cap in BUILTIN_CAPABILITIES {
            assert!(
                METHOD_CAPABILITY_MAP.values().any(|c| c == cap),
                "{cap} is in no capability table entry"
            );
        }
    }

    #[test]
    fn log_always_allowed() {
        let gate = CapabilityGate::new(vec![]);
        assert!(gate.check("rim.log").is_ok());
    }

    #[test]
    fn heartbeat_always_allowed() {
        let gate = CapabilityGate::new(vec![]);
        assert!(gate.check("rim.heartbeat_response").is_ok());
    }

    #[test]
    fn approved_capability_allowed() {
        let gate = CapabilityGate::new(vec!["chat.write".into()]);
        assert!(gate.check("rim.chat.send_message").is_ok());
    }

    #[test]
    fn missing_capability_denied() {
        let gate = CapabilityGate::new(vec!["chat.read".into()]);
        let err = gate.check("rim.chat.send_message").unwrap_err();
        assert_eq!(err, "chat.write");
    }

    #[test]
    fn unknown_method_is_left_to_the_dispatcher() {
        let gate = CapabilityGate::new(vec!["chat.read".into()]);
        assert!(gate.check("rim.unknown.method").is_ok());
        assert_eq!(capability_for_method("rim.unknown.method"), None);
    }

    #[test]
    fn update_capabilities() {
        let mut gate = CapabilityGate::new(vec![]);
        assert!(gate.check("rim.chat.send_message").is_err());
        gate.update_capabilities(vec!["chat.write".into()]);
        assert!(gate.check("rim.chat.send_message").is_ok());
    }
}
