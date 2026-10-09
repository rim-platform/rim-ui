//! Who a leaf is: the `mls-key` statement in which a device key certifies the device's MLS
//! signature key, the basic credential that carries it, and the checks a client runs on every
//! leaf before trusting it.
//!
//! The device key never enters this crate. The app signs the statement payload this crate
//! builds, and answers which device keys are certified through [`DeviceDirectory`] (it replays
//! key logs and checks device certificates).

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::codec::{b64, is_principal_id, parse_uuid, strict_json, to_json, unb64};
use crate::error::{Error, Result};

/// Context bytes of an `mls-key` statement signature.
pub const MLS_KEY_CONTEXT: &[u8] = b"rim.mls-key.v1\0";

/// Largest statement payload accepted.
const MAX_PAYLOAD: usize = 16 * 1024;

const ED25519_TAG: &str = "ed25519:";

/// A signed statement as it travels: the exact signed JSON text and its tagged signature. Also
/// the JSON of a leaf's basic credential identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedStatement {
    pub payload: String,
    pub signature: String,
}

/// A device's MLS signature key as an `mls-key` statement states it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MlsKeyStatement {
    pub principal_id: String,
    pub device_id: Uuid,
    /// The raw Ed25519 public key the leaf's `signature_key` must equal.
    pub mls_key: [u8; 32],
    pub issued_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MlsKeyPayload {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    principal_id: String,
    device_id: String,
    mls_key: String,
    issued_at: String,
}

/// The `mls-key` payload for these values, fields in their fixed order.
pub fn mls_key_payload(
    principal_id: &str,
    device_id: &Uuid,
    mls_key: &[u8; 32],
    issued_at: &str,
) -> String {
    to_json(&MlsKeyPayload {
        v: 2,
        kind: "mls-key".into(),
        principal_id: principal_id.into(),
        device_id: device_id.hyphenated().to_string(),
        mls_key: tagged_key(mls_key),
        issued_at: issued_at.into(),
    })
}

impl MlsKeyStatement {
    /// Read an `mls-key` payload strictly, without checking its signature.
    pub fn parse(payload: &str) -> Result<Self> {
        if payload.len() > MAX_PAYLOAD {
            return Err(Error::malformed("mls-key statement", "payload too large"));
        }
        let fields: MlsKeyPayload = strict_json(payload.as_bytes(), "mls-key statement")?;
        if fields.v != 2 || fields.kind != "mls-key" {
            return Err(Error::malformed(
                "mls-key statement",
                "wrong version or type",
            ));
        }
        if !is_principal_id(&fields.principal_id) {
            return Err(Error::malformed("mls-key statement", "bad principal id"));
        }
        Ok(Self {
            device_id: parse_uuid(&fields.device_id, "mls-key device id")?,
            mls_key: parse_tagged_key(&fields.mls_key)?,
            principal_id: fields.principal_id,
            issued_at: fields.issued_at,
        })
    }

    /// Read `statement` and check that `device_key` (tagged text) signed it.
    pub fn verify(statement: &SignedStatement, device_key: &str) -> Result<Self> {
        let parsed = Self::parse(&statement.payload)?;
        if !verify_tagged(MLS_KEY_CONTEXT, statement, device_key) {
            return Err(Error::Invalid(
                "the mls-key statement is not signed by the device key".into(),
            ));
        }
        Ok(parsed)
    }
}

/// `ed25519:<base64url>` of a raw key.
pub(crate) fn tagged_key(key: &[u8; 32]) -> String {
    format!("{ED25519_TAG}{}", b64(key))
}

/// A tagged Ed25519 public key: canonical spelling, a valid point in its canonical encoding,
/// not a weak key.
pub(crate) fn parse_tagged_key(text: &str) -> Result<[u8; 32]> {
    let bad = || Error::malformed("ed25519 key", "not a canonical tagged Ed25519 key");
    let bytes: [u8; 32] = unb64(text.strip_prefix(ED25519_TAG).ok_or_else(bad)?)?
        .try_into()
        .map_err(|_| bad())?;
    let key = VerifyingKey::from_bytes(&bytes).map_err(|_| bad())?;
    if key.is_weak() || key.to_edwards().compress().to_bytes() != bytes {
        return Err(bad());
    }
    Ok(bytes)
}

/// Whether `statement` carries a version 2 Ed25519 signature by `key` (tagged text) over
/// `context || payload`. Strict: weak keys and malleable signatures fail.
pub(crate) fn verify_tagged(context: &[u8], statement: &SignedStatement, key: &str) -> bool {
    let Ok(key) = parse_tagged_key(key) else {
        return false;
    };
    let Some(signature) = statement.signature.strip_prefix(ED25519_TAG) else {
        return false;
    };
    let Ok(signature) = unb64(signature).map(<[u8; 64]>::try_from) else {
        return false;
    };
    let (Ok(key), Ok(signature)) = (VerifyingKey::from_bytes(&key), signature) else {
        return false;
    };
    let mut message = context.to_vec();
    message.extend_from_slice(statement.payload.as_bytes());
    key.verify_strict(&message, &Signature::from_bytes(&signature))
        .is_ok()
}

/// The basic credential identity carrying `statement`: its JSON.
pub(crate) fn credential_identity(statement: &SignedStatement) -> Vec<u8> {
    to_json(statement).into_bytes()
}

/// What a device key's owner says about a device, as the app found it: whether a device
/// certificate of `principal_id` names `device_id`, verifies against the principal's replayed
/// key log, and has no revocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceStatus {
    /// Certified and not revoked; `device_key` is the certificate's key in tagged text.
    Certified { device_key: String },
    /// Certified once, revoked since.
    Revoked,
    /// No certificate names this device.
    Unknown,
    /// The principal's key log does not replay.
    KeyLogInvalid,
}

/// The app's answers to the leaf checks this crate cannot make alone.
pub trait DeviceDirectory {
    /// The certificate status of a device.
    fn device(&self, principal_id: &str, device_id: &Uuid) -> DeviceStatus;
    /// Whether the principal is a current member of the conversation.
    fn is_member(&self, principal_id: &str) -> bool;
}

/// A member of a group: its leaf, and who its credential says it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Leaf {
    pub index: u32,
    /// The leaf's signature key.
    pub signature_key: Vec<u8>,
    /// The credential, as read from the leaf (`Err` when it does not parse).
    pub identity: std::result::Result<LeafIdentity, String>,
}

/// What a leaf's credential claims, read but not yet verified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeafIdentity {
    pub principal_id: String,
    pub device_id: Uuid,
    pub mls_key: [u8; 32],
    pub statement: SignedStatement,
}

impl Leaf {
    pub(crate) fn new(index: u32, signature_key: Vec<u8>, credential: Option<&[u8]>) -> Self {
        let identity = match credential {
            Some(identity) => parse_identity(identity).map_err(|e| e.to_string()),
            None => Err("not a basic credential".into()),
        };
        Self {
            index,
            signature_key,
            identity,
        }
    }

    /// The device this leaf claims to be, if its credential parses.
    pub fn device(&self) -> Option<DeviceRef> {
        self.identity.as_ref().ok().map(|id| DeviceRef {
            principal_id: id.principal_id.clone(),
            device_id: id.device_id,
        })
    }
}

fn parse_identity(identity: &[u8]) -> Result<LeafIdentity> {
    let statement: SignedStatement = strict_json(identity, "credential identity")?;
    let claim = MlsKeyStatement::parse(&statement.payload)?;
    Ok(LeafIdentity {
        principal_id: claim.principal_id,
        device_id: claim.device_id,
        mls_key: claim.mls_key,
        statement,
    })
}

/// A device of a principal, as RIM names it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DeviceRef {
    pub principal_id: String,
    pub device_id: Uuid,
}

/// Why a leaf is not trusted.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LeafError {
    #[error("the credential is not a valid mls-key statement: {0}")]
    BadCredential(String),
    #[error("the principal's key log does not replay")]
    KeyLogInvalid,
    #[error("no device certificate names this device")]
    UnknownDevice,
    #[error("the device is revoked")]
    RevokedDevice,
    #[error("the mls-key statement is not signed by the device key")]
    BadStatementSignature,
    #[error("the leaf's signature key is not the certified MLS key")]
    KeyMismatch,
    #[error("the principal is not a member of the conversation")]
    NotMember,
    #[error("another leaf has the same principal and device")]
    DuplicateDevice,
}

/// A leaf that failed verification, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeafProblem {
    pub leaf: Leaf,
    pub error: LeafError,
}

/// Check one leaf of a group whose leaves are `all`: the credential is an `mls-key` statement,
/// the device is certified and not revoked, the device key signed the statement, the leaf's
/// signature key is the stated MLS key, the principal is a member, and no other leaf is the same
/// device.
pub fn verify_leaf(
    leaf: &Leaf,
    all: &[Leaf],
    directory: &dyn DeviceDirectory,
) -> std::result::Result<(), LeafError> {
    let identity = leaf
        .identity
        .as_ref()
        .map_err(|e| LeafError::BadCredential(e.clone()))?;
    let device_key = match directory.device(&identity.principal_id, &identity.device_id) {
        DeviceStatus::Certified { device_key } => device_key,
        DeviceStatus::Revoked => return Err(LeafError::RevokedDevice),
        DeviceStatus::Unknown => return Err(LeafError::UnknownDevice),
        DeviceStatus::KeyLogInvalid => return Err(LeafError::KeyLogInvalid),
    };
    if !verify_tagged(MLS_KEY_CONTEXT, &identity.statement, &device_key) {
        return Err(LeafError::BadStatementSignature);
    }
    if leaf.signature_key != identity.mls_key {
        return Err(LeafError::KeyMismatch);
    }
    if !directory.is_member(&identity.principal_id) {
        return Err(LeafError::NotMember);
    }
    let same_device = all
        .iter()
        .filter(|other| other.index != leaf.index)
        .any(|other| {
            other.identity.as_ref().is_ok_and(|other| {
                other.principal_id == identity.principal_id && other.device_id == identity.device_id
            })
        });
    if same_device {
        return Err(LeafError::DuplicateDevice);
    }
    Ok(())
}

/// Check every leaf of `leaves` and return those that fail.
pub fn verify_leaves(leaves: &[Leaf], directory: &dyn DeviceDirectory) -> Vec<LeafProblem> {
    leaves
        .iter()
        .filter_map(|leaf| {
            verify_leaf(leaf, leaves, directory)
                .err()
                .map(|error| LeafProblem {
                    leaf: leaf.clone(),
                    error,
                })
        })
        .collect()
}
