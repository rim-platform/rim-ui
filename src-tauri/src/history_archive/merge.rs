//! Turning every device's segments into one restore (`docs/specs/history-archive-v1.md`,
//! "Reading and restoring").
//!
//! - A message's highest version wins, whichever device wrote it.
//! - A conversation's sync state (its change-feed cursor) is taken only from a device whose
//!   segments were all readable: the cursor promises that every message up to it is in that
//!   device's segments, which a missing segment would break.
//! - A server restored from a backup answers `RESET`, and its versions start over. Anything
//!   archived before the latest reset any device saw is stale and skipped; only a state written
//!   after that reset (by a device that saw it) can be trusted.

use std::collections::{HashMap, HashSet};

use super::archive::ArchiveContents;
use super::format::{ArchivedConversation, ArchivedMessage, Event};

#[derive(Debug, Default)]
pub(crate) struct RestorePlan {
    pub messages: Vec<ArchivedMessage>,
    pub conversations: Vec<ArchivedConversation>,
}

type ConversationKey<'a> = (&'a str, &'a str);

pub(crate) fn plan_restore(contents: &ArchiveContents) -> RestorePlan {
    let incomplete: HashSet<&str> = contents
        .missing
        .iter()
        .chain(&contents.damaged)
        .map(|s| s.device_id.as_str())
        .chain(contents.damaged_heads.iter().map(String::as_str))
        .collect();

    // The latest reset any device saw, per conversation.
    let mut resets: HashMap<ConversationKey<'_>, i64> = HashMap::new();
    for segment in &contents.segments {
        for event in &segment.events {
            if let Event::Conversation(c) = event {
                if let Some(at) = c.reset_at {
                    let latest = resets
                        .entry((&c.workspace_id, &c.conversation_id))
                        .or_insert(at);
                    *latest = (*latest).max(at);
                }
            }
        }
    }
    let stale = |key: ConversationKey<'_>, created_at_ms: i64| {
        resets.get(&key).is_some_and(|reset| created_at_ms < *reset)
    };

    let mut messages: HashMap<&str, &ArchivedMessage> = HashMap::new();
    let mut states: HashMap<ConversationKey<'_>, (&ArchivedConversation, i64)> = HashMap::new();
    for segment in &contents.segments {
        let trusted = !incomplete.contains(segment.device_id.as_str());
        for event in &segment.events {
            match event {
                Event::Message(m) => {
                    if stale((&m.workspace_id, &m.conversation_id), segment.created_at_ms) {
                        continue;
                    }
                    let newer = messages
                        .get(m.id.as_str())
                        .is_none_or(|existing| m.version > existing.version);
                    if newer {
                        messages.insert(&m.id, m);
                    }
                }
                Event::Conversation(c) => {
                    let key = (c.workspace_id.as_str(), c.conversation_id.as_str());
                    if !trusted
                        || stale(key, segment.created_at_ms)
                        || c.reset_at != resets.get(&key).copied()
                    {
                        continue;
                    }
                    let rank = |c: &ArchivedConversation, at: i64| (c.complete, c.max_version, at);
                    let better = states
                        .get(&key)
                        .is_none_or(|(best, at)| rank(c, segment.created_at_ms) > rank(best, *at));
                    if better {
                        states.insert(key, (c, segment.created_at_ms));
                    }
                }
            }
        }
    }

    let mut conversations: Vec<ArchivedConversation> =
        states.values().map(|(c, _)| (*c).clone()).collect();
    // A conversation with archived messages but no state to trust is followed from the
    // beginning: the next sync reads it whole and the higher versions win.
    let mut seen: HashSet<ConversationKey<'_>> = states.keys().copied().collect();
    for m in messages.values() {
        let key = (m.workspace_id.as_str(), m.conversation_id.as_str());
        if seen.insert(key) {
            conversations.push(ArchivedConversation {
                workspace_id: m.workspace_id.clone(),
                conversation_id: m.conversation_id.clone(),
                cursor: None,
                complete: false,
                last_viewed_at: 0,
                reset_at: resets.get(&key).copied(),
                max_version: 0,
            });
        }
    }
    conversations.sort_by(|a, b| {
        (&a.workspace_id, &a.conversation_id).cmp(&(&b.workspace_id, &b.conversation_id))
    });

    let mut messages: Vec<ArchivedMessage> = messages.into_values().cloned().collect();
    messages.sort_by(|a, b| (a.sent_at_us, &a.id).cmp(&(b.sent_at_us, &b.id)));
    RestorePlan {
        messages,
        conversations,
    }
}
