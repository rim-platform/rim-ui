//! Message franking: the sender's commitment to a message's content, and the server's receipt
//! over it (computed here too, so the client and the server tests share one implementation).

use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

const COMMITMENT_CONTEXT: &[u8] = b"rim.e2ee.franking.v1\0";
const RECEIPT_CONTEXT: &[u8] = b"rim.e2ee.franking-receipt.v1\0";

fn hmac_sha256(key: &[u8; 32], parts: &[&[u8]]) -> [u8; 32] {
    // HMAC-SHA256 takes keys of any length; a 32-byte key cannot fail.
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC takes any key length");
    for part in parts {
        mac.update(part);
    }
    mac.finalize().into_bytes().into()
}

/// `HMAC-SHA256(franking_key, "rim.e2ee.franking.v1\0" || content)` over the exact content bytes.
pub fn franking_commitment(franking_key: &[u8; 32], content: &[u8]) -> [u8; 32] {
    hmac_sha256(franking_key, &[COMMITMENT_CONTEXT, content])
}

/// What the server's receipt binds: the message, where and by whom it was sent, and when.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReceiptFacts {
    pub message_id: Uuid,
    pub conversation_id: Uuid,
    pub sender_user_id: Uuid,
    pub sender_device_id: Uuid,
    /// The row's `sent_at` in microseconds since the Unix epoch.
    pub sent_at_us: i64,
    pub commitment: [u8; 32],
}

/// The bytes the receipt's HMAC runs over: the context, the four ids as raw UUID bytes, the
/// time as a big-endian i64, the commitment.
pub fn franking_receipt_input(facts: &ReceiptFacts) -> Vec<u8> {
    let mut input = Vec::with_capacity(RECEIPT_CONTEXT.len() + 4 * 16 + 8 + 32);
    input.extend_from_slice(RECEIPT_CONTEXT);
    input.extend_from_slice(facts.message_id.as_bytes());
    input.extend_from_slice(facts.conversation_id.as_bytes());
    input.extend_from_slice(facts.sender_user_id.as_bytes());
    input.extend_from_slice(facts.sender_device_id.as_bytes());
    input.extend_from_slice(&facts.sent_at_us.to_be_bytes());
    input.extend_from_slice(&facts.commitment);
    input
}

/// The server's receipt `HMAC-SHA256(server_key, receipt input)`.
pub fn franking_receipt(server_key: &[u8; 32], facts: &ReceiptFacts) -> [u8; 32] {
    hmac_sha256(server_key, &[&franking_receipt_input(facts)])
}
