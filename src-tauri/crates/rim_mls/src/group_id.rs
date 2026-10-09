//! The MLS group id of a conversation's incarnation.

use uuid::Uuid;

const PREFIX: &[u8; 4] = b"rim1";

/// A conversation's group, one per incarnation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ConversationGroup {
    pub conversation_id: Uuid,
    /// 1 for the conversation's first group, +1 for each fresh group after it.
    pub incarnation: u32,
}

impl ConversationGroup {
    pub fn new(conversation_id: Uuid, incarnation: u32) -> Self {
        Self {
            conversation_id,
            incarnation,
        }
    }

    /// The 24-byte group id: ASCII `rim1`, the conversation UUID, the incarnation big-endian.
    pub fn group_id(&self) -> [u8; 24] {
        let mut id = [0u8; 24];
        id[..4].copy_from_slice(PREFIX);
        id[4..20].copy_from_slice(self.conversation_id.as_bytes());
        id[20..].copy_from_slice(&self.incarnation.to_be_bytes());
        id
    }

    /// The conversation and incarnation a group id names, if it is one of RIM's.
    pub fn from_group_id(bytes: &[u8]) -> Option<Self> {
        if bytes.len() != 24 || &bytes[..4] != PREFIX {
            return None;
        }
        let conversation_id = Uuid::from_slice(&bytes[4..20]).ok()?;
        let incarnation = u32::from_be_bytes(bytes[20..].try_into().ok()?);
        Some(Self::new(conversation_id, incarnation))
    }

    /// The next incarnation's group of the same conversation.
    pub fn next(&self) -> Self {
        Self::new(self.conversation_id, self.incarnation + 1)
    }
}
