use std::collections::HashMap;
use std::sync::LazyLock;

/// Maps JSON-RPC method names to required capabilities.
static METHOD_CAPABILITY_MAP: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    // Chat capabilities: the client message service
    m.insert(CHAT_LIST_MESSAGES, CHAT_READ);
    m.insert(CHAT_GET_MESSAGE, CHAT_READ);
    m.insert(CHAT_SEARCH_MESSAGES, CHAT_READ);
    m.insert(CHAT_POST_MESSAGE, CHAT_WRITE);
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

/// Reads the person's plaintext conversations through the client message service.
pub const CHAT_READ: &str = "chat.read";
/// Posts as the person in their plaintext conversations.
pub const CHAT_WRITE: &str = "chat.write";
/// Also reads end-to-end encrypted DMs and groups; requires [`CHAT_READ`].
pub const CHAT_READ_ENCRYPTED: &str = "chat.read.encrypted";
/// Also posts in end-to-end encrypted DMs and groups; requires [`CHAT_WRITE`].
pub const CHAT_WRITE_ENCRYPTED: &str = "chat.write.encrypted";

/// Each encrypted chat capability and the plain one a manifest must ask for with it.
pub const ENCRYPTED_CHAT_CAPABILITIES: &[(&str, &str)] = &[
    (CHAT_READ_ENCRYPTED, CHAT_READ),
    (CHAT_WRITE_ENCRYPTED, CHAT_WRITE),
];

pub const CHAT_LIST_MESSAGES: &str = "rim.chat.list_messages";
pub const CHAT_GET_MESSAGE: &str = "rim.chat.get_message";
pub const CHAT_SEARCH_MESSAGES: &str = "rim.chat.search_messages";
pub const CHAT_POST_MESSAGE: &str = "rim.chat.post_message";

/// The methods the UI's message service answers; the broker relays them there.
pub const CHAT_METHODS: &[&str] = &[
    CHAT_LIST_MESSAGES,
    CHAT_GET_MESSAGE,
    CHAT_SEARCH_MESSAGES,
    CHAT_POST_MESSAGE,
];

/// The capability names a manifest may declare and a command may require, with
/// [`NETWORK_FETCH`] for a `WebSandboxed` plugin; install refuses any other name.
///
/// Each one guards something the running host does: `rim.ui.update_panel`
/// (`ui.panel`), the notifications a panel sends through the frontend bridge,
/// `pluginBridge.ts` (`ui.notify`), and the `rim.chat.*` methods of the client
/// message service (`chat.*`; the encrypted names widen what the plain ones
/// reach to encrypted conversations).
///
/// The other names in [`METHOD_CAPABILITY_MAP`] stay out: `local.process`,
/// `network`, `fs.*` and `events.read` guard methods nothing implements, and the
/// approval prompt never asks for a permission that does nothing.
pub const BUILTIN_CAPABILITIES: &[&str] = &[
    "ui.panel",
    "ui.notify",
    CHAT_READ,
    CHAT_WRITE,
    CHAT_READ_ENCRYPTED,
    CHAT_WRITE_ENCRYPTED,
];

/// Lets a `WebSandboxed` plugin connect to the origins its manifest lists. No
/// host method needs it: the frame's content security policy enforces it.
pub const NETWORK_FETCH: &str = "network.fetch";

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

    /// The capabilities approved when the plugin started.
    pub fn approved(&self) -> &[String] {
        &self.approved_capabilities
    }

    /// Checks whether the plugin may call `method`. Always-allowed and unknown
    /// methods pass.
    ///
    /// # Errors
    ///
    /// Returns the name of the required capability when it was not approved.
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
}

/// Returns the capability `method` requires; `None` if it is always allowed or unknown.
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
            let guards = METHOD_CAPABILITY_MAP.values().any(|c| c == cap);
            let widens = ENCRYPTED_CHAT_CAPABILITIES
                .iter()
                .any(|(encrypted, plain)| {
                    encrypted == cap && METHOD_CAPABILITY_MAP.values().any(|c| c == plain)
                });
            assert!(guards || widens, "{cap} is in no capability table entry");
        }
    }

    #[test]
    fn chat_methods_need_the_plain_chat_capabilities() {
        let reader = CapabilityGate::new(vec![CHAT_READ.into()]);
        for method in [CHAT_LIST_MESSAGES, CHAT_GET_MESSAGE, CHAT_SEARCH_MESSAGES] {
            assert!(reader.check(method).is_ok(), "{method}");
        }
        assert_eq!(reader.check(CHAT_POST_MESSAGE).unwrap_err(), CHAT_WRITE);

        // An encrypted grant alone opens nothing: the plain one is checked first.
        let encrypted_only = CapabilityGate::new(vec![
            CHAT_READ_ENCRYPTED.into(),
            CHAT_WRITE_ENCRYPTED.into(),
        ]);
        for method in CHAT_METHODS {
            assert!(encrypted_only.check(method).is_err(), "{method}");
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
        assert!(gate.check("rim.chat.post_message").is_ok());
    }

    #[test]
    fn missing_capability_denied() {
        let gate = CapabilityGate::new(vec!["chat.read".into()]);
        let err = gate.check("rim.chat.post_message").unwrap_err();
        assert_eq!(err, "chat.write");
    }

    #[test]
    fn unknown_method_is_left_to_the_dispatcher() {
        let gate = CapabilityGate::new(vec!["chat.read".into()]);
        assert!(gate.check("rim.unknown.method").is_ok());
        assert_eq!(capability_for_method("rim.unknown.method"), None);
    }
}
