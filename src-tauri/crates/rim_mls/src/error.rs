//! The crate's error type.

/// Why an operation failed. Nothing an operation wrote is meant to be kept after an error: the
/// caller rolls back the transaction (or the memory store) it ran in.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The store could not be read or written.
    #[error("storage: {0}")]
    Storage(String),
    /// Bytes or text that do not decode as what they claim to be.
    #[error("malformed {what}: {reason}")]
    Malformed { what: &'static str, reason: String },
    /// An argument that breaks a rule (a size cap, a field, a missing value).
    #[error("invalid input: {0}")]
    Invalid(String),
    /// This device has no MLS signature key, or no signed `mls-key` statement for it yet.
    #[error("this device has no MLS identity yet")]
    NoIdentity,
    /// No group state for this conversation and incarnation on this device.
    #[error("no group for this conversation and incarnation")]
    NoGroup,
    /// The message names another conversation, incarnation or group.
    #[error("the message belongs to another group")]
    WrongGroup,
    /// The message's epoch is not one this group can use now: Commits must be for the current
    /// epoch, application messages for it or the two before it.
    #[error("message for epoch {message}, the group is at epoch {group}")]
    EpochMismatch { group: u64, message: u64 },
    /// A Commit of this device waits for the server's answer.
    #[error("a commit of this device is pending")]
    CommitPending,
    /// There is no pending Commit to merge or clear.
    #[error("no commit of this device is pending")]
    NoPendingCommit,
    /// The group stopped at this epoch on a Commit it could not process; only a re-add helps.
    #[error("the group stopped at epoch {0} and waits for a re-add")]
    AwaitingReadd(u64),
    /// A Welcome to an epoch this device's state of the group already reached: a replay.
    #[error("the Welcome is for epoch {welcome}, this device holds the group at epoch {held}")]
    StaleWelcome { held: u64, welcome: u64 },
    /// This device was removed from the group.
    #[error("this device is no longer a member of the group")]
    Removed,
    /// A leaf named in a removal is not in the group.
    #[error("the device {0} is not in the group")]
    NotInGroup(String),
    /// The ciphertext does not decrypt: a replay, a key already used, or tampering.
    #[error("could not decrypt: {0}")]
    Decrypt(String),
    /// Any other refusal by the MLS library.
    #[error("mls: {0}")]
    Mls(String),
    /// A cryptographic primitive failed.
    #[error("crypto: {0}")]
    Crypto(String),
    /// Another device's HPKE public key does not have the length of the suite's X-Wing key.
    #[error(
        "the {what} has {len} bytes, an X-Wing public key has {}",
        crate::peer_key::XWING_PUBLIC_KEY_LEN
    )]
    InvalidPeerKey { what: String, len: usize },
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub(crate) fn malformed(what: &'static str, reason: impl std::fmt::Display) -> Self {
        Self::Malformed {
            what,
            reason: reason.to_string(),
        }
    }

    pub(crate) fn mls(error: impl std::fmt::Debug) -> Self {
        Self::Mls(format!("{error:?}"))
    }
}
