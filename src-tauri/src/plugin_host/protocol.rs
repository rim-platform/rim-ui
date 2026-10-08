//! Plugin protocol v1: the frozen wire contract between the host and a plugin process.
//!
//! The language-neutral source of truth is `protocol/plugin-protocol-v1.schema.json`
//! at the repository root: every frame below is a `$defs` entry there, with a
//! description per field and an example frame. These Rust types are the host's
//! side of the same shapes, and the conformance tests in this module fail when the
//! two drift apart or when a frame leaks a raw user id.
//!
//! - **Framing**: a 4-byte little-endian unsigned length, then that many bytes of
//!   UTF-8 JSON, at most [`crate::plugin_host::wire::MAX_FRAME_SIZE`] bytes.
//! - **Envelope**: JSON-RPC 2.0 requests, responses and notifications, in both
//!   directions over the plugin's stdin and stdout.
//! - **Field names** in v1 params and results are camelCase.
//! - **Evolution**: a v1 shape never changes. New methods may be added to v1, so
//!   both sides ignore notifications they do not know and answer unknown requests
//!   with `METHOD_NOT_FOUND`. Anything else is a new protocol version, negotiated
//!   in the handshake.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The protocol version this host prefers.
pub const PROTOCOL_VERSION: u32 = 1;

/// Every protocol version this host can speak, newest first. A plugin answers
/// the handshake with one of these.
pub const SUPPORTED_VERSIONS: &[u32] = &[1];

/// Method names of the frozen v1 messages.
pub mod method {
    /// Host → plugin request, always the host's first request on a connection.
    pub const HANDSHAKE: &str = "rim.handshake";
    /// Host → plugin request every 30 s; any `result` counts as alive.
    pub const HEARTBEAT: &str = "rim.heartbeat";
    /// Host → plugin notification: the plugin should exit. The host closes stdin next.
    pub const SHUTDOWN: &str = "rim.shutdown";
    /// Host → plugin notification: the signed-in user changed.
    pub const PRINCIPAL_CHANGED: &str = "rim.principal.changed";
    /// Host → plugin request: run one of the plugin's manifest commands.
    pub const COMMAND_EXECUTE: &str = "rim.command.execute";
    /// Plugin → host request or notification: write a line to the host log.
    pub const LOG: &str = "rim.log";
}

/// Prefix of a provisional principal id, derived from today's account id.
///
/// Once user keys exist, a principal id becomes the hash of the user's inception
/// key and the host announces the switch with [`method::PRINCIPAL_CHANGED`].
pub const PROVISIONAL_PRINCIPAL_PREFIX: &str = "rimp0_";

/// Domain separator hashed in front of the account id.
const PROVISIONAL_PRINCIPAL_DOMAIN: &[u8] = b"rim.principal.provisional.v1\0";

/// How a plugin sees a person.
///
/// Plugins may store and compare `principal_id` but must treat it as opaque: it
/// is never the local user UUID and never a `name@domain`, and it stays the same
/// when the user's keys change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Principal {
    /// Opaque, stable id of the person.
    pub principal_id: String,
    /// Human-readable label to show for the person. Not unique, may change.
    pub display_name: String,
}

impl Principal {
    /// The provisional principal of an account, until key identity lands.
    ///
    /// The id is `rimp0_` plus the unpadded base64url SHA-256 of a domain
    /// separator and the lowercased account id, so it is the same on every
    /// device and cannot be turned back into the account id.
    pub fn provisional(user_id: &str, display_name: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(PROVISIONAL_PRINCIPAL_DOMAIN);
        hasher.update(user_id.trim().to_ascii_lowercase().as_bytes());
        Self {
            principal_id: format!(
                "{PROVISIONAL_PRINCIPAL_PREFIX}{}",
                URL_SAFE_NO_PAD.encode(hasher.finalize())
            ),
            display_name: display_name.to_string(),
        }
    }
}

/// Params of [`method::HANDSHAKE`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeParams {
    /// The version the host prefers, the first entry of `supported_versions`.
    pub protocol_version: u32,
    /// Every version the host speaks, newest first.
    pub supported_versions: Vec<u32>,
    /// The plugin id from the manifest the host loaded for this process.
    pub plugin_id: String,
    /// The host application's version.
    pub host_version: String,
    /// Capabilities the user approved for this plugin.
    pub granted_capabilities: Vec<String>,
    /// The signed-in user the plugin acts for, or `null` when nobody is signed in.
    pub principal: Option<Principal>,
}

/// Result of [`method::HANDSHAKE`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeResult {
    /// Whether the plugin accepts the connection.
    pub accepted: bool,
    /// The version the plugin chose from `supported_versions`.
    pub protocol_version: u32,
    /// The plugin's own id; must equal the one the host sent.
    pub plugin_id: String,
    /// Why the plugin refused, when `accepted` is false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Params of [`method::PRINCIPAL_CHANGED`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrincipalChangedParams {
    /// The signed-in user from now on, or `null` after sign-out.
    pub principal: Option<Principal>,
}

/// Who started a command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Initiator {
    /// A person: the command palette, a keybind, a panel or a context action.
    User,
    /// The AI agent, after the user consented to this plugin's AI commands.
    Agent,
}

/// Params of [`method::COMMAND_EXECUTE`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecuteParams {
    /// The `id` of a command in the plugin's manifest.
    pub command_id: String,
    /// The command's arguments, keyed by argument name.
    pub args: serde_json::Value,
    /// The signed-in user on whose behalf the command runs, or `null`.
    pub invoker: Option<Principal>,
    /// Whether a person or the AI agent started the command.
    pub initiator: Initiator,
    /// True only when the manifest marks the command `dangerous` and the user
    /// confirmed this run. The host never sends an unconfirmed dangerous command,
    /// and the agent cannot confirm one.
    pub confirmed: bool,
}

/// Result of [`method::COMMAND_EXECUTE`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    /// The command's output, any JSON value.
    #[serde(default)]
    pub payload: serde_json::Value,
    /// Optional one-line summary the host may show to the user.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Severity of a [`method::LOG`] line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// Params of [`method::LOG`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogParams {
    pub level: LogLevel,
    pub message: String,
}

#[cfg(test)]
mod conformance;

#[cfg(test)]
mod tests {
    use super::*;

    const USER_ID: &str = "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b";

    #[test]
    fn provisional_principal_is_stable_and_opaque() {
        let a = Principal::provisional(USER_ID, "Jakub");
        let b = Principal::provisional(&USER_ID.to_ascii_uppercase(), "Jakub D.");
        assert_eq!(a.principal_id, b.principal_id, "same account, same id");
        assert!(a.principal_id.starts_with(PROVISIONAL_PRINCIPAL_PREFIX));
        assert_eq!(
            a.principal_id.len(),
            PROVISIONAL_PRINCIPAL_PREFIX.len() + 43
        );
        assert!(!a.principal_id.contains(USER_ID));
        assert!(!a.principal_id.contains('@'));

        let other = Principal::provisional("0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7c", "Jakub");
        assert_ne!(a.principal_id, other.principal_id);
    }

    #[test]
    fn principal_serializes_camel_case() {
        let json = serde_json::to_value(Principal::provisional(USER_ID, "Jakub")).unwrap();
        let keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["displayName", "principalId"]);
    }
}
