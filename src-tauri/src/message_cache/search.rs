//! Local full-text search over the cached messages.
//!
//! The FTS5 index (`message_fts`, schema v2 in `store.rs`) covers the text of every cached
//! message that is not a tombstone, in the conversations the cache follows. Results come in the
//! same order and with the same cursor as the server's `searchMessages` (`sentAt DESC, id DESC`),
//! so the UI can page through them, or mix them with the server's, the same way; `rank` is
//! informational, as on the server.
//!
//! The webview parses the query's operators (it knows channel names for `in:`) and passes the
//! free text and filters here; this module turns the free text into an FTS5 expression, so no
//! user input is ever FTS5 syntax.

use rusqlite::ToSql;
use serde::{Deserialize, Serialize};

use super::store::{parse_timestamp_us, CacheStore, TimelineCursor};
use super::CacheError;

/// Marks the snippet's matched terms before the snippet is HTML-escaped; replaced by
/// `<mark>`/`</mark>` afterwards. Private-use characters, which message text does not carry.
const MARK_OPEN: &str = "\u{E000}";
const MARK_CLOSE: &str = "\u{E001}";
/// Tokens of context in a snippet, as the server's headline gives about a sentence.
const SNIPPET_TOKENS: i32 = 16;
/// Most hits per page.
pub(crate) const MAX_SEARCH_LIMIT: u32 = 100;

/// The columns of a hit, `m` being the message. The thread root is looked up through the
/// `message_thread_root` index; the `+` drops `thread_id`'s TEXT affinity, without which SQLite
/// cannot compare through that expression index.
pub(super) const HIT_COLUMNS: &str = "
    m.id, m.conversation_id, m.thread_id, m.author_id, m.text, m.payload,
    (SELECT r.id FROM message r
     WHERE m.thread_id IS NOT NULL
       AND r.workspace_id = m.workspace_id
       AND r.conversation_id = m.conversation_id
       AND r.thread_id IS NULL
       AND json_extract(r.payload, '$.rootThreadId') = +m.thread_id
     LIMIT 1)";

/// A search as the UI parsed it. Every field narrows the result; at least one must be set.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct LocalSearchQuery {
    /// Free text: every word must match (as a prefix); `"quoted words"` match as a phrase.
    pub text: String,
    /// The scope chip or an `in:` operator.
    pub conversation_id: Option<String>,
    /// `from:`: a user id, or a username or handle (`name:domain`) with or without `@`
    /// (case-insensitive).
    pub from: Option<String>,
    /// `before:` / `after:` as RFC 3339 instants: sent strictly before / at or after.
    pub before: Option<String>,
    pub after: Option<String>,
    /// `has:link`: the text contains an `http://` or `https://` URL.
    pub has_link: bool,
    /// `has:attachment` / `has:file`.
    pub has_attachment: bool,
}

/// One hit, in the shape of the UI's `SearchMessageItem` minus the conversation's title and
/// type, which the cache does not know (the UI fills them in from its conversation lists).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSearchHit {
    pub id: String,
    pub server_id: String,
    pub conversation_id: String,
    pub thread_id: Option<String>,
    /// The thread's root message, for a hit inside a thread, when that root is cached.
    pub root_message_id: Option<String>,
    pub author_id: String,
    pub author: serde_json::Value,
    pub text: String,
    pub sent_at: String,
    /// Higher is a better match (`-bm25`); 0 without free text.
    pub rank: f64,
    /// HTML-escaped text around the matches with `<mark>…</mark>` around each, or `None`
    /// without free text (as the server's `headline`).
    pub headline: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSearchPage {
    /// Newest first.
    pub items: Vec<LocalSearchHit>,
    /// Older hits exist; continue from the last item.
    pub has_more: bool,
}

impl CacheStore {
    /// One page of the hits for `query` in `workspace_id`, newest first, older than `after`
    /// (the last hit of the previous page) when given.
    ///
    /// Only live messages of conversations the cache follows are found: tombstones have no
    /// indexed text, and a conversation the user lost access to (`NO_ACCESS`) is dropped from
    /// the cache with its index entries.
    pub(crate) fn search(
        &self,
        workspace_id: &str,
        query: &LocalSearchQuery,
        after: Option<&TimelineCursor>,
        limit: u32,
    ) -> Result<LocalSearchPage, CacheError> {
        let empty = LocalSearchPage {
            items: Vec::new(),
            has_more: false,
        };
        let fts = fts_expression(&query.text);
        let has_filter = query.conversation_id.is_some()
            || query.from.is_some()
            || query.before.is_some()
            || query.after.is_some()
            || query.has_link
            || query.has_attachment;
        if fts.is_none() && (!query.text.trim().is_empty() || !has_filter) {
            // Free text with nothing searchable in it (punctuation only) matches nothing, as
            // does an empty query.
            return Ok(empty);
        }

        let (cursor_us, cursor_id) = match after {
            Some(cursor) => (
                parse_timestamp_us(&cursor.sent_at)?,
                cursor.message_id.clone(),
            ),
            None => (i64::MAX, String::new()),
        };
        let before_us = query
            .before
            .as_deref()
            .map(parse_timestamp_us)
            .transpose()?;
        let after_us = query.after.as_deref().map(parse_timestamp_us).transpose()?;
        let from = query
            .from
            .as_deref()
            .map(|f| f.trim().trim_start_matches('@').to_string());
        let limit = limit.clamp(1, MAX_SEARCH_LIMIT);

        // Filters shared by both shapes; ?1..?9 are bound the same way in each.
        const FILTERS: &str = "
            m.workspace_id = ?1
            AND m.is_deleted = 0
            AND m.text IS NOT NULL
            AND EXISTS (SELECT 1 FROM conversation_sync s
                        WHERE s.workspace_id = m.workspace_id
                          AND s.conversation_id = m.conversation_id)
            AND (?2 IS NULL OR m.conversation_id = ?2)
            AND (?3 IS NULL OR m.author_id = ?3
                 OR lower(json_extract(m.payload, '$.author.username')) = lower(?3)
                 OR lower(json_extract(m.payload, '$.author.handle')) = lower('@' || ?3))
            AND (?4 IS NULL OR m.sent_at_us < ?4)
            AND (?5 IS NULL OR m.sent_at_us >= ?5)
            AND (?6 = 0 OR m.text LIKE '%http://%' OR m.text LIKE '%https://%')
            AND (?7 = 0 OR json_extract(m.payload, '$.hasAttachments') = 1)
            AND (m.sent_at_us, m.id) < (?8, ?9)";

        let sql = if fts.is_some() {
            format!(
                "SELECT {HIT_COLUMNS}, -bm25(message_fts),
                        snippet(message_fts, 0, ?11, ?12, '…', ?13)
                 FROM message_fts JOIN message m ON m.seq = message_fts.rowid
                 WHERE message_fts MATCH ?14 AND {FILTERS}
                 ORDER BY m.sent_at_us DESC, m.id DESC
                 LIMIT ?10"
            )
        } else {
            format!(
                "SELECT {HIT_COLUMNS}, 0.0, NULL
                 FROM message m
                 WHERE {FILTERS}
                 ORDER BY m.sent_at_us DESC, m.id DESC
                 LIMIT ?10"
            )
        };

        let fetch = i64::from(limit) + 1;
        let mut args: Vec<&dyn ToSql> = vec![
            &workspace_id,
            &query.conversation_id,
            &from,
            &before_us,
            &after_us,
            &query.has_link,
            &query.has_attachment,
            &cursor_us,
            &cursor_id,
            &fetch,
        ];
        let snippet_tokens = SNIPPET_TOKENS;
        if let Some(fts) = fts.as_ref() {
            args.extend_from_slice(&[&MARK_OPEN, &MARK_CLOSE, &snippet_tokens, fts]);
        }

        let mut stmt = self.conn.prepare_cached(&sql)?;
        let rows = stmt.query_map(args.as_slice(), |row| {
            Ok(Row {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                thread_id: row.get(2)?,
                author_id: row.get(3)?,
                text: row.get(4)?,
                payload: row.get(5)?,
                root_message_id: row.get(6)?,
                rank: row.get(7)?,
                snippet: row.get(8)?,
            })
        })?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row?.into_hit(workspace_id)?);
        }
        let has_more = items.len() > limit as usize;
        items.truncate(limit as usize);
        Ok(LocalSearchPage { items, has_more })
    }
}

struct Row {
    id: String,
    conversation_id: String,
    thread_id: Option<String>,
    author_id: String,
    text: String,
    payload: String,
    root_message_id: Option<String>,
    rank: f64,
    snippet: Option<String>,
}

impl Row {
    fn into_hit(self, workspace_id: &str) -> Result<LocalSearchHit, CacheError> {
        let payload: serde_json::Value = serde_json::from_str(&self.payload)?;
        let sent_at = payload
            .get("sentAt")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let author = payload
            .get("author")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        Ok(LocalSearchHit {
            id: self.id,
            server_id: workspace_id.to_string(),
            conversation_id: self.conversation_id,
            thread_id: self.thread_id,
            root_message_id: self.root_message_id,
            author_id: self.author_id,
            author,
            text: self.text,
            sent_at,
            rank: self.rank,
            headline: self.snippet.as_deref().map(highlight_html),
        })
    }
}

/// The FTS5 expression for free text, or `None` when it has nothing to search for.
///
/// Every word becomes a quoted string, so FTS5 syntax typed by the user (`OR`, `NEAR`, `*`,
/// `col:`) is only ever text. Words match as prefixes (`depl` finds `deploy`), all of them
/// required; a `"quoted phrase"` matches those words in order. Words with no letter or digit
/// are dropped: the tokenizer would find nothing in them.
pub(crate) fn fts_expression(text: &str) -> Option<String> {
    let mut terms = Vec::new();
    for (i, part) in text.split('"').enumerate() {
        // Odd parts were inside quotes.
        if i % 2 == 1 {
            let words: Vec<&str> = part.split_whitespace().filter(|w| searchable(w)).collect();
            if !words.is_empty() {
                terms.push(format!("\"{}\"", words.join(" ")));
            }
        } else {
            for word in part.split_whitespace().filter(|w| searchable(w)) {
                terms.push(format!("\"{word}\"*"));
            }
        }
    }
    (!terms.is_empty()).then(|| terms.join(" "))
}

fn searchable(word: &str) -> bool {
    word.chars().any(char::is_alphanumeric)
}

/// The snippet as safe HTML: everything escaped, then the match markers turned into `<mark>`.
fn highlight_html(snippet: &str) -> String {
    let mut out = String::with_capacity(snippet.len() + 16);
    for c in snippet.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out.replace(MARK_OPEN, "<mark>")
        .replace(MARK_CLOSE, "</mark>")
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn free_text_never_reaches_fts5_as_syntax() {
        assert_eq!(fts_expression("deploy"), Some("\"deploy\"*".into()));
        assert_eq!(
            fts_expression("deploy OR NEAR(x y) text:z"),
            Some("\"deploy\"* \"OR\"* \"NEAR(x\"* \"y)\"* \"text:z\"*".into())
        );
        assert_eq!(
            fts_expression("the \"launch code\" now"),
            Some("\"the\"* \"launch code\" \"now\"*".into())
        );
        assert_eq!(fts_expression("  !!! -- "), None);
        assert_eq!(fts_expression(""), None);
        // An unbalanced quote: the rest is a phrase.
        assert_eq!(fts_expression("a \"b c"), Some("\"a\"* \"b c\"".into()));
    }

    #[test]
    fn snippets_escape_everything_but_the_marks() {
        assert_eq!(
            highlight_html("<img src=x onerror=alert(1)> \u{E000}deploy\u{E001} & \"go\""),
            "&lt;img src=x onerror=alert(1)&gt; <mark>deploy</mark> &amp; &quot;go&quot;"
        );
    }
}
