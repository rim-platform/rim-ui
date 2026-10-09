//! The encrypted SQLite database behind the cache: opening it, its schema, and timeline reads.
//! Writes from the change feed live in `sync.rs`, local search in `search.rs`.

use std::path::Path;

use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::key::CacheKey;
use super::snapshot::SCHEMA_SNAPSHOT;
use super::{AccountId, CacheError};

/// Bump with a new arm in [`migrate`] when the schema changes.
pub(super) const SCHEMA_VERSION: i32 = 6;

/// Schema v1: the cache (PR 9).
///
/// `message` has the body in its own `text` column and an explicit `INTEGER PRIMARY KEY`
/// (`seq`, an alias of the rowid), so PR 10 can add an external-content FTS5 index
/// (`content='message', content_rowid='seq'`) without moving data. The alias matters: `VACUUM`
/// may renumber the rowids of a table without one, which would leave the index pointing at the
/// wrong rows. Writes upsert by `id` and never `REPLACE`, which keeps each message's `seq`.
pub(super) const SCHEMA_V1: &str = "
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- One row per conversation the cache follows: opened or recently viewed in this workspace.
CREATE TABLE conversation_sync (
    workspace_id    TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    -- Opaque change-feed cursor; NULL reads the conversation from the beginning.
    cursor          TEXT,
    -- 1 while the feed has more changes to fetch for this conversation.
    pending         INTEGER NOT NULL DEFAULT 0,
    -- 1 once the cache holds the whole history (a sync reached hasMore = false).
    complete        INTEGER NOT NULL DEFAULT 0,
    -- Unix milliseconds; picks which conversations a full sync covers.
    last_viewed_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workspace_id, conversation_id)
);

CREATE TABLE message (
    seq             INTEGER PRIMARY KEY,
    id              TEXT NOT NULL UNIQUE,
    workspace_id    TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    thread_id       TEXT,
    author_id       TEXT NOT NULL,
    -- The feed's version; an upsert only replaces a row with a higher one.
    version         INTEGER NOT NULL,
    sent_at_us      INTEGER NOT NULL,
    edited_at       TEXT,
    is_deleted      INTEGER NOT NULL,
    -- The body. NULL for a tombstone.
    text            TEXT,
    -- The rest of the message as the UI renders it (JSON, without `text`).
    payload         TEXT NOT NULL
);

CREATE INDEX message_timeline
    ON message (workspace_id, conversation_id, thread_id, sent_at_us, id);
";

/// Schema v2: local full-text search (PR 10).
///
/// An external-content FTS5 index over `message.text`: the index keeps only its token lists and
/// reads the text back from `message` by `seq`, so the text is stored once, and the index lives
/// in this SQLCipher file like every other table (no plaintext sidecar).
///
/// The triggers are FTS5's standard external-content ones and keep the index in step with every
/// write to `message`, whichever code path makes it: a create indexes the text, an edit replaces
/// the old entry with the new one, and a delete (`NO_ACCESS`, `RESET`) removes it. A tombstone's
/// text is NULL, which indexes no words, so a message deleted on the server leaves no searchable
/// trace. The `'delete'` command must be handed exactly what was indexed, which `old.text` is.
///
/// `message_thread_root` finds a thread's root message by the thread id in its payload, which
/// search does for each hit inside a thread; without it, that is a scan of the conversation.
///
/// The last statement is the one-time backfill of a cache created by an earlier build.
const SCHEMA_V2: &str = "
CREATE VIRTUAL TABLE message_fts USING fts5(
    text,
    content = 'message',
    content_rowid = 'seq',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER message_fts_insert AFTER INSERT ON message BEGIN
    INSERT INTO message_fts (rowid, text) VALUES (new.seq, new.text);
END;

CREATE TRIGGER message_fts_delete AFTER DELETE ON message BEGIN
    INSERT INTO message_fts (message_fts, rowid, text) VALUES ('delete', old.seq, old.text);
END;

CREATE TRIGGER message_fts_update AFTER UPDATE OF text ON message BEGIN
    INSERT INTO message_fts (message_fts, rowid, text) VALUES ('delete', old.seq, old.text);
    INSERT INTO message_fts (rowid, text) VALUES (new.seq, new.text);
END;

CREATE INDEX message_thread_root
    ON message (workspace_id, conversation_id, json_extract(payload, '$.rootThreadId'))
    WHERE thread_id IS NULL;

INSERT INTO message_fts (message_fts) VALUES ('rebuild');
";

/// Schema v3: what the history archive needs (Stage 2 drive archive, `archive.rs`).
///
/// - `change_counter` hands out a number to every change of a message or of a conversation's
///   sync state (`change_seq`), so an export picks up exactly what changed since the last one.
///   The triggers number every write, whichever code path makes it. An upsert that keeps the
///   cached copy (an older version) writes nothing and so is not a change.
/// - `archive_export` is how far each (archive, device) has exported, per table.
/// - `conversation_sync.reset_at` is when the server last answered `RESET` for a conversation:
///   the archive uses it to tell stale copies from current ones.
/// - `restored_from` names the archive a row was restored from. Export skips such a row for
///   that archive (it is there already) but not for another one, so a device that switches
///   to a new archive still carries its restored history over. Any later change of the row
///   (a sync) renumbers it and clears the mark.
///
/// Rows cached by an earlier build are numbered once, so the first export covers them.
pub(super) const SCHEMA_V3: &str = "
ALTER TABLE message ADD COLUMN change_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_sync ADD COLUMN change_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_sync ADD COLUMN reset_at INTEGER;
ALTER TABLE message ADD COLUMN restored_from TEXT;
ALTER TABLE conversation_sync ADD COLUMN restored_from TEXT;

CREATE TABLE change_counter (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    value INTEGER NOT NULL
);

CREATE TABLE archive_export (
    archive_id                   TEXT NOT NULL,
    device_id                    TEXT NOT NULL,
    -- Highest message change_seq in the archive.
    messages_through             INTEGER NOT NULL DEFAULT 0,
    -- Highest conversation_sync change_seq in the archive.
    conversations_through        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (archive_id, device_id)
);

UPDATE message SET change_seq = seq;
INSERT INTO change_counter (id, value) VALUES (1, (SELECT coalesce(max(seq), 0) FROM message) + 1);
UPDATE conversation_sync SET change_seq = (SELECT value FROM change_counter);

CREATE INDEX message_change ON message (change_seq);
CREATE INDEX conversation_sync_change ON conversation_sync (change_seq);

CREATE TRIGGER message_change_insert AFTER INSERT ON message
BEGIN
    UPDATE change_counter SET value = value + 1 WHERE id = 1;
    UPDATE message
    SET change_seq = (SELECT value FROM change_counter WHERE id = 1), restored_from = NULL
    WHERE seq = new.seq;
END;

CREATE TRIGGER message_change_update
AFTER UPDATE OF version, is_deleted, text, payload, thread_id, edited_at ON message
BEGIN
    UPDATE change_counter SET value = value + 1 WHERE id = 1;
    UPDATE message
    SET change_seq = (SELECT value FROM change_counter WHERE id = 1), restored_from = NULL
    WHERE seq = new.seq;
END;

CREATE TRIGGER conversation_change_insert AFTER INSERT ON conversation_sync
BEGIN
    UPDATE change_counter SET value = value + 1 WHERE id = 1;
    UPDATE conversation_sync
    SET change_seq = (SELECT value FROM change_counter WHERE id = 1), restored_from = NULL
    WHERE workspace_id = new.workspace_id AND conversation_id = new.conversation_id;
END;

CREATE TRIGGER conversation_change_update
AFTER UPDATE OF cursor, complete, reset_at ON conversation_sync
WHEN old.cursor IS NOT new.cursor
     OR old.complete IS NOT new.complete
     OR old.reset_at IS NOT new.reset_at
BEGIN
    UPDATE change_counter SET value = value + 1 WHERE id = 1;
    UPDATE conversation_sync
    SET change_seq = (SELECT value FROM change_counter WHERE id = 1), restored_from = NULL
    WHERE workspace_id = new.workspace_id AND conversation_id = new.conversation_id;
END;
";

/// Schema v5: MLS group state of the end-to-end encrypted conversations (`rim_mls`), in the same
/// encrypted file as the messages, so decrypting a message, storing its plaintext and advancing
/// the group's ratchet commit in one transaction. Never archived.
const SCHEMA_MLS: &str = rim_mls::SCHEMA;

/// An open cache database of one account.
pub(crate) struct CacheStore {
    pub(crate) conn: Connection,
}

/// A page of a conversation's timeline served from the cache, oldest first.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimelinePage {
    pub items: Vec<serde_json::Value>,
    /// Older messages than the first item are cached too.
    pub has_older: bool,
}

/// The UI's `MessageCursor`: page from messages older than this one.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TimelineCursor {
    pub sent_at: String,
    pub message_id: String,
}

impl CacheStore {
    /// Open (or create) the database at `path` with `key`. A file the key cannot read (the
    /// stored key was lost, or the file is damaged) is a cache with nothing worth
    /// keeping: it is deleted and created again, and the feed refills it.
    pub(crate) fn open(
        path: &Path,
        key: &CacheKey,
        account: &AccountId,
    ) -> Result<Self, CacheError> {
        let conn = match open_keyed(path, key) {
            Ok(conn) => conn,
            Err(CacheError::Unreadable) => {
                log::warn!(
                    "[message_cache] cache file is unreadable with the current key; recreating it"
                );
                remove_database_files(path)?;
                open_keyed(path, key)?
            }
            Err(e) => return Err(e),
        };
        let store = Self { conn };
        store.migrate()?;
        store.check_account(account)?;
        Ok(store)
    }

    fn migrate(&self) -> Result<(), CacheError> {
        let version: i32 = self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(CacheError::Schema(format!(
                "cache schema {version} is newer than this build ({SCHEMA_VERSION})"
            )));
        }
        // Each step commits with its version, so an interrupted upgrade resumes at that step.
        for (target, sql) in [
            (1, SCHEMA_V1),
            (2, SCHEMA_V2),
            (3, SCHEMA_V3),
            (4, SCHEMA_SNAPSHOT),
            (5, SCHEMA_MLS),
            (6, crate::e2ee::SCHEMA),
        ] {
            if version < target {
                let tx = self.conn.unchecked_transaction()?;
                tx.execute_batch(sql)?;
                tx.pragma_update(None, "user_version", target)?;
                tx.commit()?;
            }
        }
        Ok(())
    }

    /// The file is named after a hash of the account; the account is also written inside it,
    /// so a file can never be served to a different account.
    fn check_account(&self, account: &AccountId) -> Result<(), CacheError> {
        let stored: Option<String> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key = 'account'", [], |row| {
                row.get(0)
            })
            .optional()?;
        match stored {
            Some(stored) if stored == account.label() => Ok(()),
            Some(_) => Err(CacheError::AccountMismatch),
            None => {
                self.conn.execute(
                    "INSERT INTO meta (key, value) VALUES ('account', ?1)",
                    params![account.label()],
                )?;
                Ok(())
            }
        }
    }

    /// Start following a conversation, or note that it was viewed again.
    pub(crate) fn track(
        &self,
        workspace_id: &str,
        conversation_id: &str,
        now_ms: i64,
    ) -> Result<(), CacheError> {
        self.conn.execute(
            "INSERT INTO conversation_sync (workspace_id, conversation_id, last_viewed_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT (workspace_id, conversation_id)
             DO UPDATE SET last_viewed_at = excluded.last_viewed_at",
            params![workspace_id, conversation_id, now_ms],
        )?;
        Ok(())
    }

    /// The newest `limit` timeline messages (no thread replies, no tombstones) older than
    /// `before`, oldest first. `None` until the conversation's history is fully cached: a
    /// partial initial sync holds the *oldest* messages, which must not pass for the latest.
    pub(crate) fn timeline(
        &self,
        workspace_id: &str,
        conversation_id: &str,
        before: Option<&TimelineCursor>,
        limit: u32,
    ) -> Result<Option<TimelinePage>, CacheError> {
        let complete: Option<bool> = self
            .conn
            .query_row(
                "SELECT complete FROM conversation_sync
                 WHERE workspace_id = ?1 AND conversation_id = ?2",
                params![workspace_id, conversation_id],
                |row| row.get(0),
            )
            .optional()?;
        if complete != Some(true) {
            return Ok(None);
        }

        let (before_us, before_id) = match before {
            Some(cursor) => (
                parse_timestamp_us(&cursor.sent_at)?,
                cursor.message_id.clone(),
            ),
            None => (i64::MAX, String::new()),
        };
        let limit = limit.clamp(1, 200);

        let mut stmt = self.conn.prepare_cached(
            "SELECT text, payload FROM message
             WHERE workspace_id = ?1 AND conversation_id = ?2 AND thread_id IS NULL
               AND is_deleted = 0
               AND (sent_at_us, id) < (?3, ?4)
             ORDER BY sent_at_us DESC, id DESC
             LIMIT ?5",
        )?;
        let rows = stmt.query_map(
            params![
                workspace_id,
                conversation_id,
                before_us,
                before_id,
                limit + 1
            ],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )?;

        let mut items = Vec::new();
        for row in rows {
            let (text, payload) = row?;
            items.push(render(text, &payload)?);
        }
        let has_older = items.len() > limit as usize;
        items.truncate(limit as usize);
        items.reverse();
        Ok(Some(TimelinePage { items, has_older }))
    }
}

impl CacheStore {
    /// A thread's replies (live ones, oldest first, at most 500), after its root message when
    /// `root_message_id` is cached.
    pub(crate) fn thread(
        &self,
        workspace_id: &str,
        conversation_id: &str,
        thread_id: &str,
        root_message_id: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, CacheError> {
        let mut items = Vec::new();
        if let Some(root) = root_message_id {
            if let Some(item) = self.message(root)? {
                items.push(item);
            }
        }
        let mut stmt = self.conn.prepare_cached(
            "SELECT text, payload FROM message
             WHERE workspace_id = ?1 AND conversation_id = ?2 AND thread_id = ?3
               AND is_deleted = 0
             ORDER BY sent_at_us, id
             LIMIT 500",
        )?;
        let rows = stmt.query_map(params![workspace_id, conversation_id, thread_id], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (text, payload) = row?;
            items.push(render(text, &payload)?);
        }
        Ok(items)
    }

    /// One cached message, or `None`.
    pub(crate) fn message(&self, id: &str) -> Result<Option<serde_json::Value>, CacheError> {
        let row: Option<(Option<String>, String)> = self
            .conn
            .query_row(
                "SELECT text, payload FROM message WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        row.map(|(text, payload)| render(text, &payload))
            .transpose()
    }
}

/// The stored payload with its text put back, as the UI's `MessageItem`.
fn render(text: Option<String>, payload: &str) -> Result<serde_json::Value, CacheError> {
    let mut value: serde_json::Value = serde_json::from_str(payload)?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "text".into(),
            serde_json::Value::String(text.unwrap_or_default()),
        );
    }
    Ok(value)
}

/// RFC 3339 to microseconds since the epoch, the precision the server stores.
pub(crate) fn parse_timestamp_us(value: &str) -> Result<i64, CacheError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|t| t.timestamp_micros())
        .map_err(|_| CacheError::Invalid(format!("not an RFC 3339 timestamp: {value}")))
}

pub(super) fn open_keyed(path: &Path, key: &CacheKey) -> Result<Connection, CacheError> {
    let conn = Connection::open(path)?;
    // Must be the first statement on the connection.
    conn.execute_batch(&format!(
        "PRAGMA key = \"{}\";",
        key.sqlcipher_literal().as_str()
    ))?;
    // The first read is where SQLCipher finds out whether the key fits.
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    }) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == ErrorCode::NotADatabase => {
            return Err(CacheError::Unreadable)
        }
        Err(e) => return Err(e.into()),
    }
    // Sorts and other temporary results (search orders its matches) stay in memory, never in a
    // temporary file outside the encrypted database.
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(conn)
}

fn remove_database_files(path: &Path) -> Result<(), CacheError> {
    for suffix in ["", "-wal", "-shm"] {
        let mut name = path.as_os_str().to_owned();
        name.push(suffix);
        match std::fs::remove_file(&name) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(CacheError::Io(e.to_string())),
        }
    }
    Ok(())
}
