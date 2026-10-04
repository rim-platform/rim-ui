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
            // Unknown methods are denied by default
            None => Err(format!("unknown method: {method}")),
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
    fn unknown_method_denied() {
        let gate = CapabilityGate::new(vec!["chat.read".into()]);
        let err = gate.check("rim.unknown.method").unwrap_err();
        assert!(err.contains("unknown method"));
    }

    #[test]
    fn update_capabilities() {
        let mut gate = CapabilityGate::new(vec![]);
        assert!(gate.check("rim.chat.send_message").is_err());
        gate.update_capabilities(vec!["chat.write".into()]);
        assert!(gate.check("rim.chat.send_message").is_ok());
    }
}
