//! Wire types of the server's `messageChanges` query (rim-server `docs/message-change-feed.md`).
//!
//! The webview makes the HTTP call (it holds the session cookie); these types are what it
//! hands to and gets from the cache. They serialize in GraphQL's camelCase, so a
//! [`ChangesRequest`] is passed to the query as its `input` unchanged.

use serde::{Deserialize, Serialize};

/// `MessageChangesInput`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChangesRequest {
    pub server_id: String,
    pub conversations: Vec<CursorInput>,
    pub limit: Option<i32>,
}

/// `MessageChangeCursorInput`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CursorInput {
    pub conversation_id: String,
    pub after: Option<String>,
}

/// `ConversationChangesStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ChangesStatus {
    Ok,
    NoAccess,
    Reset,
    /// A status this build does not know. The conversation is left as it is.
    #[serde(other)]
    Unknown,
}

/// `ConversationMessageChanges`: one conversation's answer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationChanges {
    pub conversation_id: String,
    pub status: ChangesStatus,
    pub changes: Vec<MessageChange>,
    pub cursor: String,
    pub has_more: bool,
}

/// `MessageChange`. `kind` is not needed to apply a change (the message's own state decides),
/// so it is not parsed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MessageChange {
    pub version: String,
    pub edited_at: Option<String>,
    /// The message as the UI's `MessageWithReactions` fragment selects it. Stored whole so the
    /// timeline can be rendered from the cache; the fields the cache indexes are read from it.
    pub message: serde_json::Value,
}

/// The fields of a feed message the cache needs for its own columns.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MessageCore {
    pub id: String,
    pub conversation_id: String,
    pub thread_id: Option<String>,
    pub author_id: String,
    pub text: Option<String>,
    pub is_deleted: bool,
    pub sent_at: String,
}
