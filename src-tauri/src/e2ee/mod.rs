//! End-to-end encrypted DMs and groups on the desktop: the app's side of `rim_mls`.
//!
//! The webview talks to the server (it holds the session cookie) and drives every step; this
//! module keeps the MLS group state and does the cryptography, all in the account's encrypted
//! cache database:
//!
//! - **Identity and key packages** (`identity`): this device's MLS signature key, certified by
//!   the device key in an `mls-key` statement, and the key packages it keeps on the server.
//! - **Groups** (`group`): creating a conversation's group, committing membership changes,
//!   settling a Commit with the server's answer, joining from a Welcome, re-add requests.
//! - **The change feed** (`feed`): an [`EnvelopeHandler`](crate::message_cache::sync) that
//!   applies Commits up to each entry's epoch and decrypts the entry, once, in the transaction
//!   that stores its plaintext row.
//! - **Sending** (`outgoing`): a message's plaintext is stored under the id this device chose
//!   before its envelope leaves, and kept to send again in a newer epoch.
//! - **Leaves** (`directory`): every member device is checked against its principal's key log
//!   and device certificates; verified devices are remembered.
//! - **Attachments** (`attachment`): AES-256-GCM files, over raw IPC.
//! - **Link previews** (`link_preview`): fetched by the sender, never by receivers.

pub(crate) mod attachment;
pub(crate) mod commands;
mod directory;
mod feed;
mod group;
mod identity;
pub(crate) mod link_preview;
mod outgoing;

#[cfg(test)]
mod tests;

use serde::Serialize;

use crate::message_cache::CacheError;

pub(crate) use feed::{ConversationInput, Decryptor, SyncNote};

/// Tauri-managed state: files encrypted on this device and waiting for their message.
pub(crate) fn attachment_state() -> attachment::PendingAttachments {
    attachment::PendingAttachments::default()
}

/// Schema v6 of the cache database: what end-to-end encryption keeps beside the MLS state.
///
/// - `message.e2ee_state` marks rows of encrypted messages: `decrypted`, `invalid`,
///   `placeholder` (this device cannot read it) or `outgoing` (sent here, not acknowledged).
/// - `e2ee_conversation`: per conversation, which incarnation of its group this device holds,
///   the first epoch it can read, whether it was removed, and what the timeline must say about
///   the group (leaves to verify, devices that failed, a misbehaving committer, a re-add wait).
/// - `e2ee_outgoing`: this device's messages and edits until the server acknowledges them,
///   with the content and franking key to send them again in a newer epoch.
/// - `e2ee_verified_device`: devices whose certificate verified, with the certified key.
/// - `e2ee_readd_honored`: when this device last acted on a device's re-add request.
pub(crate) const SCHEMA: &str = "
ALTER TABLE message ADD COLUMN e2ee_state TEXT;

CREATE TABLE e2ee_conversation (
    workspace_id       TEXT NOT NULL,
    conversation_id    TEXT NOT NULL,
    -- The incarnation of the group state this device holds; 0 for none.
    incarnation        INTEGER NOT NULL DEFAULT 0,
    -- An incarnation this device created and whose first Commit waits for the server.
    next_incarnation   INTEGER,
    -- The first epoch of `incarnation` this device can decrypt.
    join_epoch         INTEGER NOT NULL DEFAULT 0,
    -- 1 once this device processed its own removal.
    removed            INTEGER NOT NULL DEFAULT 0,
    -- 1 while new leaves wait for verification.
    verify_pending     INTEGER NOT NULL DEFAULT 0,
    -- JSON list of devices whose leaf did not verify: [{principalId, deviceId, reason}].
    unverified         TEXT NOT NULL DEFAULT '[]',
    -- JSON of the device whose Commit summary did not match its proposals.
    misbehaved         TEXT,
    -- Unix milliseconds of this device's re-add request while it waits for it.
    readd_requested_at INTEGER,
    -- Unix milliseconds of this device's last Commit with an update path.
    last_update_at     INTEGER,
    -- JSON list of the devices that started each incarnation after the first, as far as this
    -- device saw them: [{incarnation, principalId, deviceId}].
    resets             TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (workspace_id, conversation_id)
);

CREATE TABLE e2ee_outgoing (
    message_id      TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    -- 'send' or 'edit'.
    kind            TEXT NOT NULL,
    incarnation     INTEGER NOT NULL,
    epoch           INTEGER NOT NULL,
    envelope        BLOB NOT NULL,
    content         BLOB NOT NULL,
    franking_key    BLOB NOT NULL,
    commitment      BLOB NOT NULL,
    -- For an edit: the row's text and payload before it, put back if the server refuses it.
    previous        TEXT,
    created_at      INTEGER NOT NULL
);

CREATE TABLE e2ee_verified_device (
    principal_id TEXT NOT NULL,
    device_id    TEXT NOT NULL,
    -- The device key its certificate names, tagged text.
    device_key   TEXT NOT NULL,
    PRIMARY KEY (principal_id, device_id)
);

CREATE TABLE e2ee_readd_honored (
    conversation_id TEXT NOT NULL,
    device_id       TEXT NOT NULL,
    honored_at      INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, device_id)
);
";

/// Schema v7 of the cache database: what this device pins against a server that changes its
/// answers.
///
/// - `e2ee_conversation.membership`: the principals processed Commits added and removed, for the
///   timeline.
/// - `e2ee_pin`: conversations this device knows are encrypted, kept whatever the server says
///   later and through `forget`; a direct message's two principals, fixed on first use.
/// - `e2ee_peer`: per principal, the head of the longest key log verified here and the devices
///   seen revoked.
pub(crate) const SCHEMA_PINS: &str = "
ALTER TABLE e2ee_conversation ADD COLUMN membership TEXT NOT NULL DEFAULT '[]';

CREATE TABLE e2ee_pin (
    workspace_id    TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    -- The server's encryptedAt as this device first saw it, when it did.
    encrypted_at    TEXT,
    -- JSON list of a direct message's two principal ids.
    dm_principals   TEXT,
    PRIMARY KEY (workspace_id, conversation_id)
);

INSERT INTO e2ee_pin (workspace_id, conversation_id)
    SELECT workspace_id, conversation_id FROM e2ee_conversation;

CREATE TABLE e2ee_peer (
    principal_id TEXT PRIMARY KEY,
    -- The seq and payload hash of the head of the longest key log verified on this device.
    head_seq     INTEGER NOT NULL,
    head_hash    TEXT NOT NULL,
    -- JSON list of the principal's device ids seen revoked.
    revoked      TEXT NOT NULL DEFAULT '[]'
);
";

/// Undoes [`SCHEMA`] and [`SCHEMA_PINS`], for tests that take a cache back to an older version.
#[cfg(test)]
pub(crate) const DROP_SCHEMA: &str = "
DROP TABLE e2ee_pin;
DROP TABLE e2ee_peer;
DROP TABLE e2ee_conversation;
DROP TABLE e2ee_outgoing;
DROP TABLE e2ee_verified_device;
DROP TABLE e2ee_readd_honored;
ALTER TABLE message DROP COLUMN e2ee_state;
";

#[derive(Debug, thiserror::Error)]
pub(crate) enum E2eeError {
    #[error(transparent)]
    Cache(#[from] CacheError),
    #[error("{0}")]
    Mls(#[from] rim_mls::Error),
    #[error("device key: {0}")]
    Key(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    /// Sending is stopped in the conversation (a device that does not verify is in it).
    #[error("{0}")]
    Blocked(String),
}

impl From<rusqlite::Error> for E2eeError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Cache(CacheError::Db(e))
    }
}

impl From<serde_json::Error> for E2eeError {
    fn from(e: serde_json::Error) -> Self {
        Self::Cache(CacheError::Json(e))
    }
}

impl From<E2eeError> for CacheError {
    fn from(e: E2eeError) -> Self {
        match e {
            E2eeError::Cache(e) => e,
            other => CacheError::Invalid(other.to_string()),
        }
    }
}

impl E2eeError {
    /// The code the webview branches on.
    pub(crate) fn code(&self) -> &'static str {
        use rim_mls::Error as M;
        match self {
            Self::Cache(e) => e.code(),
            Self::Mls(M::NoIdentity) => "E2EE_NO_IDENTITY",
            Self::Mls(M::NoGroup) => "E2EE_NO_GROUP",
            Self::Mls(M::CommitPending) => "E2EE_COMMIT_PENDING",
            Self::Mls(M::NoPendingCommit) => "E2EE_NO_PENDING_COMMIT",
            Self::Mls(M::AwaitingReadd(_)) => "E2EE_AWAITING_READD",
            Self::Mls(M::Removed) => "E2EE_REMOVED",
            Self::Mls(M::StaleWelcome { .. }) => "E2EE_STALE_WELCOME",
            Self::Mls(M::EpochMismatch { .. }) => "E2EE_EPOCH_MISMATCH",
            Self::Mls(M::Storage(_)) => "CACHE_STORAGE",
            Self::Mls(_) => "E2EE_MLS",
            Self::Key(_) => "E2EE_DEVICE_KEY",
            Self::Invalid(_) => "INVALID_ARGS",
            Self::Blocked(_) => "E2EE_UNVERIFIED_DEVICE",
        }
    }
}

/// Serialized as `{ kind, message }`, the shape `safeInvoke` narrows.
impl Serialize for E2eeError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("E2eeError", 2)?;
        s.serialize_field("kind", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub(crate) type Result<T> = std::result::Result<T, E2eeError>;

/// Unpadded base64url, as every binary value on the wire.
pub(crate) fn b64(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn unb64(text: &str) -> Result<Vec<u8>> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| E2eeError::Invalid("not unpadded base64url".into()))
}

pub(crate) fn parse_uuid(text: &str) -> Result<uuid::Uuid> {
    uuid::Uuid::parse_str(text).map_err(|_| E2eeError::Invalid(format!("not a UUID: {text}")))
}

pub(crate) fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
