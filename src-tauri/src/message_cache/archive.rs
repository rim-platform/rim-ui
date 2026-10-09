//! The cache's side of the history archive (`docs/specs/history-archive-v1.md`): what changed
//! since this device's last export, and writing a restore back in.
//!
//! Every change of a message or of a conversation's sync state gets a `change_seq` (schema v3
//! in `store.rs`); `archive_export` remembers, per archive and device, how far the archive has
//! them. An export is a series of batches, each read in one transaction:
//!
//! - A batch holds at most `max_messages` messages. While more remain it holds no
//!   conversation states.
//! - The last batch also holds the states of the conversations that changed, read in the same
//!   transaction as its messages. So when a state reaches the archive, every message its cursor
//!   covers is in the archive too: in this batch or an earlier one.
//! - Rows restored from an archive are numbered like any change but carry `restored_from`, and
//!   are skipped when exporting to that same archive: it holds them already. Another archive
//!   (the user moved to a new folder) gets them like any other row.

use rusqlite::{params, OptionalExtension};

use super::store::CacheStore;
use super::sync::{stored_payload, write_message, MessageRow};
use super::CacheError;
use crate::history_archive::format::{ArchivedConversation, ArchivedMessage, Event};
use crate::history_archive::merge::RestorePlan;

/// One batch of an export.
#[derive(Debug)]
pub(crate) struct ExportBatch {
    pub events: Vec<Event>,
    pub messages: usize,
    pub conversations: usize,
    messages_through: i64,
    /// Set on the last batch only.
    conversations_through: Option<i64>,
}

/// What a restore wrote into the cache.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RestoreCounts {
    /// Messages inserted, or replaced because the archive had a higher version.
    pub messages: usize,
    /// Conversations the cache did not follow before.
    pub conversations: usize,
}

impl CacheStore {
    /// The next batch to export to `(archive_id, device_id)`, or `None` when the archive has
    /// every change. A batch may hold no events (the changes since were all deleted rows);
    /// [`Self::mark_archived`] still has to record it.
    pub(crate) fn archive_batch(
        &mut self,
        archive_id: &str,
        device_id: &str,
        max_messages: usize,
    ) -> Result<Option<ExportBatch>, CacheError> {
        let tx = self.conn.transaction()?;
        let (messages_from, conversations_from): (i64, i64) = tx
            .query_row(
                "SELECT messages_through, conversations_through FROM archive_export
                 WHERE archive_id = ?1 AND device_id = ?2",
                params![archive_id, device_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .unwrap_or((0, 0));
        let head: i64 =
            tx.query_row("SELECT value FROM change_counter WHERE id = 1", [], |row| {
                row.get(0)
            })?;
        if messages_from >= head && conversations_from >= head {
            return Ok(None);
        }

        let mut events = Vec::new();
        let mut last_seq = messages_from;
        {
            let mut stmt = tx.prepare_cached(
                "SELECT id, workspace_id, conversation_id, thread_id, author_id, version,
                        sent_at_us, edited_at, is_deleted, text, payload, change_seq
                 FROM message
                 WHERE change_seq > ?1 AND change_seq <= ?2 AND restored_from IS NOT ?4
                 ORDER BY change_seq
                 LIMIT ?3",
            )?;
            let mut rows = stmt.query(params![
                messages_from,
                head,
                max_messages as i64 + 1,
                archive_id
            ])?;
            // Rows read, not events: a row skipped below must still count, or a full batch
            // would end at `head` and leave the rows past the limit unexported for good.
            let mut read = 0;
            while let Some(row) = rows.next()? {
                if read == max_messages {
                    // There is one more: this batch stops at the previous message.
                    let messages = events.len();
                    return Ok(Some(ExportBatch {
                        events,
                        messages,
                        conversations: 0,
                        messages_through: last_seq,
                        conversations_through: None,
                    }));
                }
                read += 1;
                last_seq = row.get(11)?;
                let payload: String = row.get(10)?;
                let Ok(payload) = serde_json::from_str(&payload) else {
                    log::warn!(
                        "[message_cache] not archiving a message with an unreadable payload"
                    );
                    continue;
                };
                events.push(Event::Message(ArchivedMessage {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    conversation_id: row.get(2)?,
                    thread_id: row.get(3)?,
                    author_id: row.get(4)?,
                    version: row.get(5)?,
                    sent_at_us: row.get(6)?,
                    edited_at: row.get(7)?,
                    deleted: row.get(8)?,
                    text: row.get(9)?,
                    payload,
                    sig: None,
                }));
            }
        }
        let messages = events.len();

        {
            let mut stmt = tx.prepare_cached(
                "SELECT c.workspace_id, c.conversation_id, c.cursor, c.complete,
                        c.last_viewed_at, c.reset_at,
                        (SELECT coalesce(max(m.version), 0) FROM message m
                         WHERE m.workspace_id = c.workspace_id
                           AND m.conversation_id = c.conversation_id)
                 FROM conversation_sync c
                 WHERE c.change_seq > ?1 AND c.change_seq <= ?2 AND c.restored_from IS NOT ?3
                 ORDER BY c.change_seq",
            )?;
            let rows = stmt.query_map(params![conversations_from, head, archive_id], |row| {
                Ok(ArchivedConversation {
                    workspace_id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    cursor: row.get(2)?,
                    complete: row.get(3)?,
                    last_viewed_at: row.get(4)?,
                    reset_at: row.get(5)?,
                    max_version: row.get(6)?,
                })
            })?;
            for row in rows {
                events.push(Event::Conversation(row?));
            }
        }
        let conversations = events.len() - messages;
        Ok(Some(ExportBatch {
            events,
            messages,
            conversations,
            messages_through: head,
            conversations_through: Some(head),
        }))
    }

    /// Record that `batch` is in the archive. Call only once its segments and the device's
    /// head are written: a crash in between exports the batch again next time, which the
    /// archive's version rule makes harmless.
    pub(crate) fn mark_archived(
        &self,
        archive_id: &str,
        device_id: &str,
        batch: &ExportBatch,
    ) -> Result<(), CacheError> {
        self.conn.execute(
            "INSERT INTO archive_export
                 (archive_id, device_id, messages_through, conversations_through)
             VALUES (?1, ?2, ?3, coalesce(?4, 0))
             ON CONFLICT (archive_id, device_id) DO UPDATE SET
                 messages_through = max(messages_through, excluded.messages_through),
                 conversations_through =
                     CASE WHEN ?4 IS NULL THEN conversations_through
                          ELSE max(conversations_through, ?4) END",
            params![
                archive_id,
                device_id,
                batch.messages_through,
                batch.conversations_through
            ],
        )?;
        Ok(())
    }

    /// Write a restore into the cache in one transaction.
    ///
    /// - Messages go through the sync's own upsert: the higher version wins, and on a tie the
    ///   cached copy stays (both are the same server state). The next sync then brings anything
    ///   newer from the server the same way.
    /// - A conversation the cache does not follow yet is followed from the archive's cursor, so
    ///   its history shows before the server is asked and the next sync asks only for what is
    ///   newer. A conversation the cache already follows keeps its own sync state.
    /// - Every row written is marked as restored from `archive_id`, so exports to that archive
    ///   skip it (it is there already) and exports to another archive still carry it.
    pub(crate) fn restore_archive(
        &mut self,
        archive_id: &str,
        plan: &RestorePlan,
    ) -> Result<RestoreCounts, CacheError> {
        let tx = self.conn.transaction()?;
        let mut counts = RestoreCounts::default();
        for m in &plan.messages {
            // A tombstone keeps who and when, never what, whatever the archive says.
            let text = if m.deleted { None } else { m.text.clone() };
            let written = write_message(
                &tx,
                &MessageRow {
                    id: m.id.clone(),
                    workspace_id: m.workspace_id.clone(),
                    conversation_id: m.conversation_id.clone(),
                    thread_id: m.thread_id.clone(),
                    author_id: m.author_id.clone(),
                    version: m.version,
                    sent_at_us: m.sent_at_us,
                    edited_at: m.edited_at.clone(),
                    is_deleted: m.deleted,
                    text,
                    payload: stored_payload(m.payload.clone(), m.deleted),
                },
            )?;
            if written {
                tx.execute(
                    "UPDATE message SET restored_from = ?1 WHERE id = ?2",
                    params![archive_id, m.id],
                )?;
                counts.messages += 1;
            }
        }
        for c in &plan.conversations {
            let inserted = tx.execute(
                "INSERT INTO conversation_sync
                     (workspace_id, conversation_id, cursor, pending, complete, last_viewed_at,
                      reset_at)
                 VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)
                 ON CONFLICT (workspace_id, conversation_id) DO NOTHING",
                params![
                    c.workspace_id,
                    c.conversation_id,
                    c.cursor,
                    c.complete,
                    c.last_viewed_at,
                    c.reset_at
                ],
            )?;
            if inserted > 0 {
                tx.execute(
                    "UPDATE conversation_sync SET restored_from = ?1
                     WHERE workspace_id = ?2 AND conversation_id = ?3",
                    params![archive_id, c.workspace_id, c.conversation_id],
                )?;
                counts.conversations += 1;
            }
        }
        tx.commit()?;
        Ok(counts)
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::params;

    use super::super::tests::{open, state, sync, MockFeed};

    #[test]
    fn a_skipped_row_inside_a_full_batch_does_not_end_the_export() {
        let dir = tempfile::tempdir().unwrap();
        let cache = state(dir.path(), 1);
        let store = open(&cache, "alice");
        let mut store = store.lock().unwrap();
        let mut feed = MockFeed::new(1000);
        feed.send_many("c1", 6);
        store.track(super::super::tests::WS, "c1", 1).unwrap();
        sync(&mut store, &mut feed, None);

        // The second message's payload cannot be read; its number stays where it was. (The
        // thread index parses payloads, so it goes first.)
        store
            .conn
            .execute("DROP INDEX message_thread_root", [])
            .unwrap();
        let seq: i64 = store
            .conn
            .query_row(
                "SELECT change_seq FROM message WHERE id = 'c1-m001'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .conn
            .execute(
                "UPDATE message SET payload = 'not json' WHERE id = 'c1-m001'",
                [],
            )
            .unwrap();
        store
            .conn
            .execute(
                "UPDATE message SET change_seq = ?1 WHERE id = 'c1-m001'",
                params![seq],
            )
            .unwrap();

        let mut ids = Vec::new();
        while let Some(batch) = store.archive_batch("archive-1", "device-1", 4).unwrap() {
            for event in &batch.events {
                if let crate::history_archive::format::Event::Message(m) = event {
                    ids.push(m.id.clone());
                }
            }
            store
                .mark_archived("archive-1", "device-1", &batch)
                .unwrap();
        }
        assert_eq!(ids, ["c1-m000", "c1-m002", "c1-m003", "c1-m004", "c1-m005"]);
    }
}
