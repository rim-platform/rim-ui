//! Re-add requests: a device without usable group state asks, signed with its device key, to be
//! removed and added again.

use serde::{Deserialize, Serialize};

use crate::codec::{b64, is_principal_id, parse_uuid, required, strict_json, to_json, unb64};
use crate::error::{Error, Result};
use crate::group_id::ConversationGroup;
use crate::identity::{verify_tagged, DeviceRef, SignedStatement};

/// Context bytes of a re-add request signature.
pub const READD_CONTEXT: &[u8] = b"rim.mls-readd.v1\0";

const MAX_PAYLOAD: usize = 16 * 1024;

/// A re-add request as its device signed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaddRequest {
    pub device: DeviceRef,
    pub group: ConversationGroup,
    /// The last epoch the device processed; `None` when it has no state at all.
    pub last_epoch: Option<u64>,
    pub nonce: [u8; 16],
    pub issued_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Wire {
    v: u8,
    #[serde(rename = "type")]
    kind: String,
    principal_id: String,
    device_id: String,
    conversation_id: String,
    incarnation: u32,
    #[serde(deserialize_with = "required")]
    last_epoch: Option<u64>,
    nonce: String,
    issued_at: String,
}

impl ReaddRequest {
    /// The payload to sign with the device key over [`READD_CONTEXT`], fields in their fixed order.
    pub fn payload(&self) -> String {
        to_json(&Wire {
            v: 2,
            kind: "mls-readd".into(),
            principal_id: self.device.principal_id.clone(),
            device_id: self.device.device_id.hyphenated().to_string(),
            conversation_id: self.group.conversation_id.hyphenated().to_string(),
            incarnation: self.group.incarnation,
            last_epoch: self.last_epoch,
            nonce: b64(&self.nonce),
            issued_at: self.issued_at.clone(),
        })
    }

    /// A request with a fresh random nonce, issued now.
    pub fn new(
        device: DeviceRef,
        group: ConversationGroup,
        last_epoch: Option<u64>,
    ) -> Result<Self> {
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).map_err(|e| Error::Crypto(format!("random: {e}")))?;
        Ok(Self {
            device,
            group,
            last_epoch,
            nonce,
            issued_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        })
    }

    /// Read a request strictly and check that `device_key` (the requesting device's certified key,
    /// tagged text) signed it.
    pub fn verify(statement: &SignedStatement, device_key: &str) -> Result<Self> {
        if statement.payload.len() > MAX_PAYLOAD {
            return Err(Error::malformed("re-add request", "payload too large"));
        }
        let wire: Wire = strict_json(statement.payload.as_bytes(), "re-add request")?;
        if wire.v != 2 || wire.kind != "mls-readd" || !is_principal_id(&wire.principal_id) {
            return Err(Error::malformed(
                "re-add request",
                "wrong version, type or principal",
            ));
        }
        if wire.incarnation == 0 {
            return Err(Error::malformed("re-add request", "incarnation 0"));
        }
        let nonce: [u8; 16] = unb64(&wire.nonce)?
            .try_into()
            .map_err(|_| Error::malformed("re-add request", "the nonce is not 16 bytes"))?;
        if !verify_tagged(READD_CONTEXT, statement, device_key) {
            return Err(Error::Invalid(
                "the re-add request is not signed by the device key".into(),
            ));
        }
        Ok(Self {
            device: DeviceRef {
                device_id: parse_uuid(&wire.device_id, "re-add device id")?,
                principal_id: wire.principal_id,
            },
            group: ConversationGroup::new(
                parse_uuid(&wire.conversation_id, "re-add conversation id")?,
                wire.incarnation,
            ),
            last_epoch: wire.last_epoch,
            nonce,
            issued_at: wire.issued_at,
        })
    }
}

/// Whether a committer may act on a request now: at most one per device and conversation in 24
/// hours. `last_honored_at` is when this device last acted on one from the same device, both in
/// Unix seconds.
pub fn may_honor_readd(last_honored_at: Option<i64>, now: i64) -> bool {
    last_honored_at.is_none_or(|at| now - at >= 24 * 60 * 60)
}
