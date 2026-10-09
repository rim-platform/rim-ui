//! The sync loop's state machine, kept in the database so an interrupted sync resumes.
//!
//! The webview drives it (it holds the session cookie for the HTTP call):
//!
//! ```text
//! request = cache.begin_sync(conversations)
//! while let Some(r) = request {
//!     response = server.messageChanges(r)
//!     request = cache.apply_changes(response)
//! }
//! ```
//!
//! [`CacheStore::begin_sync`] marks conversations pending; [`CacheStore::next_request`] asks
//! for every pending conversation with its stored cursor; [`CacheStore::apply_changes`]
//! writes the answer and leaves a conversation pending while the feed says `hasMore`.
//!
//! Entries of end-to-end encrypted conversations go through an [`EnvelopeHandler`] (the `e2ee`
//! module), which decrypts each one in the page's transaction; this module never sees MLS.

use rusqlite::{params, OptionalExtension, Transaction};

use super::feed::{
    ChangesRequest, ChangesStatus, ConversationChanges, CursorInput, MessageChange, MessageCore,
};
use super::store::{parse_timestamp_us, CacheStore};
use super::CacheError;

/// The server accepts at most 100 conversations per request.
pub(crate) const MAX_CONVERSATIONS_PER_REQUEST: usize = 100;
/// Changes asked for per conversation. The server's maximum; it lowers this itself so one
/// request stays within its 1000-change budget.
pub(crate) const PER_CONVERSATION_LIMIT: i32 = 200;
/// A sync of "everything" covers this many of the most recently viewed conversations.
pub(crate) const RECENT_CONVERSATIONS: usize = 50;

impl CacheStore {
    /// Mark conversations for syncing and return the first request, if any.
    ///
    /// `Some(ids)`: those of `ids` the cache already follows (a real-time signal for a
    /// conversation never opened on this device is not a reason to download its history).
    /// `None`: the [`RECENT_CONVERSATIONS`] most recently viewed ones (startup, reconnect).
    pub(crate) fn begin_sync(
        &mut self,
        workspace_id: &str,
        conversation_ids: Option<&[String]>,
    ) -> Result<Option<ChangesRequest>, CacheError> {
        let tx = self.conn.transaction()?;
        match conversation_ids {
            Some(ids) => {
                let mut stmt = tx.prepare_cached(
                    "UPDATE conversation_sync SET pending = 1
                     WHERE workspace_id = ?1 AND conversation_id = ?2",
                )?;
                for id in ids {
                    stmt.execute(params![workspace_id, id])?;
                }
            }
            None => {
                tx.execute(
                    "UPDATE conversation_sync SET pending = 1
                     WHERE workspace_id = ?1 AND conversation_id IN (
                         SELECT conversation_id FROM conversation_sync
                         WHERE workspace_id = ?1
                         ORDER BY last_viewed_at DESC
                         LIMIT ?2)",
                    params![workspace_id, RECENT_CONVERSATIONS as i64],
                )?;
            }
        }
        tx.commit()?;
        self.next_request(workspace_id)
    }

    /// The request for every pending conversation (most recently viewed first, at most
    /// [`MAX_CONVERSATIONS_PER_REQUEST`]), or `None` when nothing is pending.
    pub(crate) fn next_request(
        &self,
        workspace_id: &str,
    ) -> Result<Option<ChangesRequest>, CacheError> {
        let mut stmt = self.conn.prepare_cached(
            "SELECT conversation_id, cursor FROM conversation_sync
             WHERE workspace_id = ?1 AND pending = 1
             ORDER BY last_viewed_at DESC, conversation_id
             LIMIT ?2",
        )?;
        let conversations = stmt
            .query_map(
                params![workspace_id, MAX_CONVERSATIONS_PER_REQUEST as i64],
                |row| {
                    Ok(CursorInput {
                        conversation_id: row.get(0)?,
                        after: row.get(1)?,
                    })
                },
            )?
            .collect::<Result<Vec<_>, _>>()?;

        if conversations.is_empty() {
            return Ok(None);
        }
        Ok(Some(ChangesRequest {
            server_id: workspace_id.to_string(),
            conversations,
            limit: Some(PER_CONVERSATION_LIMIT),
        }))
    }

    /// Apply one `messageChanges` answer in a single transaction, then return the next
    /// request (the conversations that still have more), or `None` when the sync is done.
    ///
    /// Per conversation:
    /// - `OK`: upsert every change, store the cursor.
    /// - `RESET`: the stored cursor is ahead of the server; drop the cached messages, then
    ///   apply the changes (which start from the beginning) like an initial sync.
    /// - `NO_ACCESS`: the user can no longer read it; drop its messages and stop following it.
    ///
    /// An answer for a conversation the cache does not follow is ignored.
    #[cfg(test)]
    pub(crate) fn apply_changes(
        &mut self,
        workspace_id: &str,
        response: Vec<ConversationChanges>,
    ) -> Result<Option<ChangesRequest>, CacheError> {
        self.apply_changes_with(workspace_id, response, &mut PlaintextOnly)
    }

    /// [`Self::apply_changes`], with encrypted entries handed to `handler` inside the same
    /// transaction.
    pub(crate) fn apply_changes_with(
        &mut self,
        workspace_id: &str,
        response: Vec<ConversationChanges>,
        handler: &mut dyn EnvelopeHandler,
    ) -> Result<Option<ChangesRequest>, CacheError> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let tx = self.conn.transaction()?;
        for entry in response {
            apply_conversation(&tx, workspace_id, entry, now_ms, handler)?;
        }
        tx.commit()?;
        self.next_request(workspace_id)
    }
}

/// What an [`EnvelopeHandler`] did with a change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Handled {
    /// Not an encrypted entry: stored as a plaintext message.
    Plaintext,
    /// Stored (or deliberately skipped) by the handler.
    Done,
    /// The handler cannot go on in this conversation yet: the rest of the page is left for a
    /// later sync, and the cursor stays where it was.
    Stop,
}

/// Decrypts the encrypted entries of the change feed, each in the page's transaction.
pub(crate) trait EnvelopeHandler {
    /// One change of a conversation, in feed order.
    fn change(
        &mut self,
        tx: &Transaction<'_>,
        workspace_id: &str,
        conversation_id: &str,
        change: &MessageChange,
    ) -> Result<Handled, CacheError>;

    /// The conversation's page is stored; `drained` when the feed has nothing more for it.
    fn finish(
        &mut self,
        tx: &Transaction<'_>,
        workspace_id: &str,
        conversation_id: &str,
        drained: bool,
    ) -> Result<(), CacheError>;

    /// The user lost access to the conversation: forget everything kept for it.
    fn dropped(
        &mut self,
        tx: &Transaction<'_>,
        workspace_id: &str,
        conversation_id: &str,
    ) -> Result<(), CacheError>;
}

/// The handler of a cache without end-to-end encryption: every entry is plaintext.
#[cfg(test)]
pub(crate) struct PlaintextOnly;

#[cfg(test)]
impl EnvelopeHandler for PlaintextOnly {
    fn change(
        &mut self,
        _tx: &Transaction<'_>,
        _workspace_id: &str,
        _conversation_id: &str,
        _change: &MessageChange,
    ) -> Result<Handled, CacheError> {
        Ok(Handled::Plaintext)
    }

    fn finish(
        &mut self,
        _tx: &Transaction<'_>,
        _workspace_id: &str,
        _conversation_id: &str,
        _drained: bool,
    ) -> Result<(), CacheError> {
        Ok(())
    }

    fn dropped(
        &mut self,
        _tx: &Transaction<'_>,
        _workspace_id: &str,
        _conversation_id: &str,
    ) -> Result<(), CacheError> {
        Ok(())
    }
}

fn apply_conversation(
    tx: &Transaction<'_>,
    workspace_id: &str,
    entry: ConversationChanges,
    now_ms: i64,
    handler: &mut dyn EnvelopeHandler,
) -> Result<(), CacheError> {
    let conversation_id = entry.conversation_id.as_str();
    let followed: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM conversation_sync WHERE workspace_id = ?1 AND conversation_id = ?2",
            params![workspace_id, conversation_id],
            |row| row.get(0),
        )
        .optional()?;
    if followed.is_none() {
        log::warn!("[message_cache] ignoring changes for an unfollowed conversation");
        return Ok(());
    }

    match entry.status {
        ChangesStatus::NoAccess => {
            drop_messages(tx, workspace_id, conversation_id, false)?;
            handler.dropped(tx, workspace_id, conversation_id)?;
            tx.execute(
                "DELETE FROM conversation_sync WHERE workspace_id = ?1 AND conversation_id = ?2",
                params![workspace_id, conversation_id],
            )?;
            return Ok(());
        }
        ChangesStatus::Unknown => {
            log::warn!(
                "[message_cache] unknown change-feed status; leaving the conversation as is"
            );
            tx.execute(
                "UPDATE conversation_sync SET pending = 0
                 WHERE workspace_id = ?1 AND conversation_id = ?2",
                params![workspace_id, conversation_id],
            )?;
            return Ok(());
        }
        ChangesStatus::Reset => {
            // Decrypted rows cannot be fetched again: they stay, and the feed is read over them.
            drop_messages(tx, workspace_id, conversation_id, true)?;
            // `reset_at` tells the history archive which archived copies predate the reset.
            tx.execute(
                "UPDATE conversation_sync SET complete = 0, reset_at = ?3
                 WHERE workspace_id = ?1 AND conversation_id = ?2",
                params![workspace_id, conversation_id, now_ms],
            )?;
        }
        ChangesStatus::Ok => {}
    }

    for change in entry.changes {
        match handler.change(tx, workspace_id, conversation_id, &change)? {
            Handled::Plaintext => upsert_message(tx, workspace_id, conversation_id, change)?,
            Handled::Done => {}
            Handled::Stop => {
                // Not pending: this run would only stop at the same entry again. The handler
                // says why, and the next sync of the conversation resumes from the cursor.
                tx.execute(
                    "UPDATE conversation_sync SET pending = 0
                     WHERE workspace_id = ?1 AND conversation_id = ?2",
                    params![workspace_id, conversation_id],
                )?;
                return Ok(());
            }
        }
    }

    tx.execute(
        "UPDATE conversation_sync
         SET cursor = ?3,
             pending = ?4,
             complete = CASE WHEN ?4 = 0 THEN 1 ELSE complete END
         WHERE workspace_id = ?1 AND conversation_id = ?2",
        params![workspace_id, conversation_id, entry.cursor, entry.has_more],
    )?;
    handler.finish(tx, workspace_id, conversation_id, !entry.has_more)?;
    Ok(())
}

/// Delete a conversation's cached messages; with `keep_decrypted`, all but the rows only this
/// device can read (decrypted, invalid or still being sent).
fn drop_messages(
    tx: &Transaction<'_>,
    workspace_id: &str,
    conversation_id: &str,
    keep_decrypted: bool,
) -> Result<(), CacheError> {
    tx.execute(
        "DELETE FROM message WHERE workspace_id = ?1 AND conversation_id = ?2
           AND (?3 = 0 OR e2ee_state IS NULL OR e2ee_state = 'placeholder')",
        params![workspace_id, conversation_id, keep_decrypted],
    )?;
    Ok(())
}

/// Insert a message, or replace the cached copy if this change has a higher version. Changes
/// can arrive out of order (an edit seen before its create, a stale page after a newer one),
/// so the version decides, not arrival order. A change that does not parse is skipped rather
/// than failing the whole page.
fn upsert_message(
    tx: &Transaction<'_>,
    workspace_id: &str,
    conversation_id: &str,
    change: MessageChange,
) -> Result<(), CacheError> {
    let core: MessageCore = match serde_json::from_value(change.message.clone()) {
        Ok(core) => core,
        Err(e) => {
            log::warn!("[message_cache] skipping a change with an unreadable message: {e}");
            return Ok(());
        }
    };
    if core.conversation_id != conversation_id {
        log::warn!("[message_cache] skipping a change filed under the wrong conversation");
        return Ok(());
    }
    let Ok(version) = change.version.parse::<i64>() else {
        log::warn!("[message_cache] skipping a change with a non-numeric version");
        return Ok(());
    };
    let Ok(sent_at_us) = parse_timestamp_us(&core.sent_at) else {
        log::warn!("[message_cache] skipping a change with an unreadable sentAt");
        return Ok(());
    };

    // A tombstone keeps who and when, never what: no text, attachments or previews, even if
    // a server sent them.
    let text = if core.is_deleted { None } else { core.text };
    let payload = stored_payload(change.message, core.is_deleted);

    write_message(
        tx,
        &MessageRow {
            id: core.id,
            workspace_id: workspace_id.to_string(),
            conversation_id: conversation_id.to_string(),
            thread_id: core.thread_id,
            author_id: core.author_id,
            version,
            sent_at_us,
            edited_at: change.edited_at,
            is_deleted: core.is_deleted,
            text,
            payload,
            e2ee_state: None,
        },
    )?;
    Ok(())
}

/// A message as the `message` table holds it.
pub(crate) struct MessageRow {
    pub id: String,
    pub workspace_id: String,
    pub conversation_id: String,
    pub thread_id: Option<String>,
    pub author_id: String,
    pub version: i64,
    pub sent_at_us: i64,
    pub edited_at: Option<String>,
    pub is_deleted: bool,
    pub text: Option<String>,
    pub payload: String,
    /// For an encrypted message: `decrypted`, `invalid` (decrypted but breaks a rule),
    /// `placeholder` (this device cannot decrypt it) or `outgoing` (sent from this device,
    /// not yet acknowledged). `None` for plaintext rows and tombstones.
    pub e2ee_state: Option<String>,
}

/// Insert a message, or replace the cached copy only if `row` has a higher version (a tie
/// keeps the cached copy). The sync and the archive restore both write through here, so one
/// rule decides between the server's copy and the archive's. A row filed under another
/// conversation is never moved. Returns whether anything was written.
///
/// Encrypted rows add two exceptions: a placeholder never replaces a row this device could
/// read, and a readable row replaces a placeholder whatever their versions.
pub(crate) fn write_message(tx: &Transaction<'_>, row: &MessageRow) -> Result<bool, CacheError> {
    let changed = tx.execute(
        "INSERT INTO message (id, workspace_id, conversation_id, thread_id, author_id, version,
                              sent_at_us, edited_at, is_deleted, text, payload, e2ee_state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT (id) DO UPDATE SET
             thread_id  = excluded.thread_id,
             author_id  = excluded.author_id,
             version    = excluded.version,
             sent_at_us = excluded.sent_at_us,
             edited_at  = excluded.edited_at,
             is_deleted = excluded.is_deleted,
             text       = excluded.text,
             payload    = excluded.payload,
             e2ee_state = excluded.e2ee_state
         WHERE message.workspace_id = excluded.workspace_id
           AND message.conversation_id = excluded.conversation_id
           AND ((excluded.version > message.version
                 AND NOT (excluded.e2ee_state IS 'placeholder'
                          AND message.e2ee_state IN ('decrypted', 'invalid', 'outgoing')))
                OR (message.e2ee_state IS 'placeholder'
                    AND excluded.e2ee_state IN ('decrypted', 'invalid')))",
        params![
            row.id,
            row.workspace_id,
            row.conversation_id,
            row.thread_id,
            row.author_id,
            row.version,
            row.sent_at_us,
            row.edited_at,
            row.is_deleted,
            row.text,
            row.payload,
            row.e2ee_state,
        ],
    )?;
    Ok(changed > 0)
}

/// The message JSON to store: without `text` (it has its own column), and emptied of content
/// for a tombstone.
pub(crate) fn stored_payload(mut message: serde_json::Value, deleted: bool) -> String {
    if let Some(obj) = message.as_object_mut() {
        obj.remove("text");
        // The envelope is never stored: a decrypted row keeps its plaintext instead.
        obj.remove("encryption");
        if deleted {
            obj.remove("e2ee");
            for field in [
                "attachments",
                "linkPreviews",
                "reactions",
                "mentionedUserIds",
            ] {
                obj.insert(field.into(), serde_json::Value::Array(Vec::new()));
            }
            obj.insert("forwardedFrom".into(), serde_json::Value::Null);
            obj.insert("hasAttachments".into(), serde_json::Value::Bool(false));
        }
    }
    message.to_string()
}
