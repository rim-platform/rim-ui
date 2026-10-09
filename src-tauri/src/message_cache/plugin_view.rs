//! The cache as plugins read it through the client message service (`rim.chat.*`).
//!
//! A plugin gets each message as the person reads it, in one fixed shape, and nothing else:
//! no franking keys, attachment secrets or blob hashes, no MLS facts, no ciphertext, no raw
//! user ids (authors and `<@user>` mentions become principal ids). Rows this device could not
//! decrypt (placeholders), rows that could not be verified, tombstones and this device's
//! unacknowledged sends are left out.
//!
//! Encrypted conversations are readable only with `encrypted_allowed`: a conversation is
//! encrypted when the caller says so, when this device holds group state for it, or when any
//! of its cached rows is an encrypted message.

use std::collections::HashMap;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::search::LocalSearchQuery;
use super::store::{CacheStore, TimelineCursor};
use super::CacheError;
use crate::plugin_host::protocol::{is_key_principal_id, Principal};

/// Most messages one list or search answers.
pub(crate) const MAX_PLUGIN_LIMIT: u32 = 100;
/// Messages a list answers when the plugin names no limit.
pub(crate) const DEFAULT_PLUGIN_LIMIT: u32 = 50;
/// Search pages read while skipping hits the plugin may not see.
const MAX_SEARCH_PAGES: usize = 10;

/// A person as a plugin sees them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginAuthor {
    pub principal_id: String,
    pub display_name: String,
}

/// An attachment's name, type and size; plugins cannot fetch its bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct PluginAttachment {
    pub name: String,
    pub mime: String,
    pub size: u64,
}

/// A message as the client message service returns it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginMessage {
    pub id: String,
    pub conversation_id: String,
    pub thread_id: Option<String>,
    pub author: PluginAuthor,
    pub text: String,
    pub sent_at: String,
    pub edited_at: Option<String>,
    /// The message itself was end-to-end encrypted (not just its conversation).
    pub encrypted: bool,
    pub attachments: Vec<PluginAttachment>,
}

/// A page of a conversation, oldest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginMessagePage {
    pub messages: Vec<PluginMessage>,
    /// Older messages are cached too; ask again with `before` the first message's id.
    pub has_older: bool,
}

/// What the plugin may read.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct PluginReadScope {
    /// The plugin holds `chat.read.encrypted`.
    pub encrypted_allowed: bool,
    /// Conversations the caller knows to be encrypted, beyond what the cache shows.
    pub known_encrypted: Vec<String>,
}

/// The message columns a projection needs.
const COLUMNS: &str =
    "id, conversation_id, thread_id, author_id, text, payload, edited_at, e2ee_state";

/// Rows a plugin may see: live, with text, plaintext or decrypted.
const READABLE: &str = "is_deleted = 0 AND text IS NOT NULL
     AND (e2ee_state IS NULL OR e2ee_state = 'decrypted')";

struct Row {
    id: String,
    conversation_id: String,
    thread_id: Option<String>,
    author_id: String,
    text: String,
    payload: String,
    edited_at: Option<String>,
    e2ee_state: Option<String>,
}

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok(Row {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        thread_id: row.get(2)?,
        author_id: row.get(3)?,
        text: row.get(4)?,
        payload: row.get(5)?,
        edited_at: row.get(6)?,
        e2ee_state: row.get(7)?,
    })
}

impl CacheStore {
    /// Whether `conversation_id` is end-to-end encrypted, as far as this device knows.
    pub(crate) fn conversation_encrypted(
        &self,
        workspace_id: &str,
        conversation_id: &str,
        scope: &PluginReadScope,
    ) -> Result<bool, CacheError> {
        if scope.known_encrypted.iter().any(|c| c == conversation_id) {
            return Ok(true);
        }
        let encrypted: bool = self.conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM e2ee_conversation
                            WHERE workspace_id = ?1 AND conversation_id = ?2)
                 OR EXISTS (SELECT 1 FROM message
                            WHERE workspace_id = ?1 AND conversation_id = ?2
                              AND e2ee_state IS NOT NULL)",
            params![workspace_id, conversation_id],
            |row| row.get(0),
        )?;
        Ok(encrypted)
    }

    fn check_readable(
        &self,
        workspace_id: &str,
        conversation_id: &str,
        scope: &PluginReadScope,
    ) -> Result<(), CacheError> {
        if !scope.encrypted_allowed
            && self.conversation_encrypted(workspace_id, conversation_id, scope)?
        {
            return Err(CacheError::EncryptedDenied);
        }
        Ok(())
    }

    /// The newest `limit` messages of a conversation older than the message `before`, oldest
    /// first, thread replies included. `None` while the conversation's history is not fully
    /// cached on this device.
    pub(crate) fn plugin_messages(
        &self,
        workspace_id: &str,
        conversation_id: &str,
        before: Option<&str>,
        limit: Option<u32>,
        scope: &PluginReadScope,
    ) -> Result<Option<PluginMessagePage>, CacheError> {
        self.check_readable(workspace_id, conversation_id, scope)?;
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
            Some(id) => self
                .conn
                .query_row(
                    "SELECT sent_at_us, id FROM message
                     WHERE id = ?1 AND workspace_id = ?2 AND conversation_id = ?3",
                    params![id, workspace_id, conversation_id],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
                .ok_or_else(|| {
                    CacheError::Invalid(format!(
                        "before names no message of the conversation: {id}"
                    ))
                })?,
            None => (i64::MAX, String::new()),
        };
        let limit = limit
            .unwrap_or(DEFAULT_PLUGIN_LIMIT)
            .clamp(1, MAX_PLUGIN_LIMIT);

        let mut stmt = self.conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM message
             WHERE workspace_id = ?1 AND conversation_id = ?2 AND {READABLE}
               AND (sent_at_us, id) < (?3, ?4)
             ORDER BY sent_at_us DESC, id DESC
             LIMIT ?5"
        ))?;
        let rows = stmt.query_map(
            params![
                workspace_id,
                conversation_id,
                before_us,
                before_id,
                limit + 1
            ],
            read_row,
        )?;
        let mut messages = Vec::new();
        for row in rows {
            messages.push(project(row?)?);
        }
        let has_older = messages.len() > limit as usize;
        messages.truncate(limit as usize);
        messages.reverse();
        Ok(Some(PluginMessagePage {
            messages,
            has_older,
        }))
    }

    /// One message, or `None` when it is not cached or not one a plugin may see.
    pub(crate) fn plugin_message(
        &self,
        workspace_id: &str,
        message_id: &str,
        scope: &PluginReadScope,
    ) -> Result<Option<PluginMessage>, CacheError> {
        let row = self
            .conn
            .query_row(
                &format!(
                    "SELECT {COLUMNS} FROM message
                     WHERE id = ?1 AND workspace_id = ?2 AND {READABLE}"
                ),
                params![message_id, workspace_id],
                read_row,
            )
            .optional()?;
        let Some(row) = row else {
            return Ok(None);
        };
        self.check_readable(workspace_id, &row.conversation_id, scope)?;
        project(row).map(Some)
    }

    /// Local full-text search for a plugin, newest first. Hits in encrypted conversations
    /// are left out without `encrypted_allowed`; naming an encrypted conversation without it
    /// is refused.
    pub(crate) fn plugin_search(
        &self,
        workspace_id: &str,
        text: &str,
        conversation_id: Option<&str>,
        limit: Option<u32>,
        scope: &PluginReadScope,
    ) -> Result<Vec<PluginMessage>, CacheError> {
        if let Some(conversation_id) = conversation_id {
            self.check_readable(workspace_id, conversation_id, scope)?;
        }
        let limit = limit
            .unwrap_or(DEFAULT_PLUGIN_LIMIT)
            .clamp(1, MAX_PLUGIN_LIMIT) as usize;
        let query = LocalSearchQuery {
            text: text.to_string(),
            conversation_id: conversation_id.map(str::to_string),
            ..LocalSearchQuery::default()
        };
        let mut encrypted: HashMap<String, bool> = HashMap::new();
        let mut found = Vec::new();
        let mut after: Option<TimelineCursor> = None;
        for _ in 0..MAX_SEARCH_PAGES {
            let page = self.search(workspace_id, &query, after.as_ref(), limit as u32)?;
            for hit in &page.items {
                if !scope.encrypted_allowed {
                    let hidden = match encrypted.get(&hit.conversation_id) {
                        Some(known) => *known,
                        None => {
                            let known = self.conversation_encrypted(
                                workspace_id,
                                &hit.conversation_id,
                                scope,
                            )?;
                            encrypted.insert(hit.conversation_id.clone(), known);
                            known
                        }
                    };
                    if hidden {
                        continue;
                    }
                }
                if let Some(message) = self.plugin_message(workspace_id, &hit.id, scope)? {
                    found.push(message);
                }
                if found.len() == limit {
                    return Ok(found);
                }
            }
            let Some(last) = page.items.last().filter(|_| page.has_more) else {
                break;
            };
            after = Some(TimelineCursor {
                sent_at: last.sent_at.clone(),
                message_id: last.id.clone(),
            });
        }
        Ok(found)
    }
}

fn project(row: Row) -> Result<PluginMessage, CacheError> {
    let payload: serde_json::Value = serde_json::from_str(&row.payload)?;
    let author = payload.get("author");
    let author_field = |name: &str| {
        author
            .and_then(|a| a.get(name))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
    };
    let display_name = author_field("displayName")
        .or_else(|| author_field("username"))
        .unwrap_or("Someone")
        .to_string();
    let principal_id = match author_field("principalId") {
        Some(id) if is_key_principal_id(id) => id.to_string(),
        _ => Principal::provisional(&row.author_id, "").principal_id,
    };
    let attachments = payload
        .get("attachments")
        .and_then(|a| a.as_array())
        .map(|list| {
            list.iter()
                .map(|a| PluginAttachment {
                    name: a
                        .get("filename")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    mime: a
                        .get("contentType")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    size: a.get("sizeBytes").and_then(|v| v.as_u64()).unwrap_or(0),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(PluginMessage {
        id: row.id,
        conversation_id: row.conversation_id,
        thread_id: row.thread_id,
        author: PluginAuthor {
            principal_id,
            display_name,
        },
        text: principal_mentions(&row.text),
        sent_at: payload
            .get("sentAt")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        edited_at: row.edited_at,
        encrypted: row.e2ee_state.is_some(),
        attachments,
    })
}

/// `text` with every `<@user-id>` mention as `<@principal-id>`, so no account id reaches a
/// plugin; `<@rimp1_…>` mentions of encrypted messages stay as they are.
fn principal_mentions(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<@") {
        out.push_str(&rest[..start]);
        let token = &rest[start..];
        match token.find('>') {
            Some(end) => {
                let inner = &token[2..end];
                if uuid::Uuid::parse_str(inner).is_ok() {
                    out.push_str("<@");
                    out.push_str(&Principal::provisional(inner, "").principal_id);
                    out.push('>');
                } else {
                    out.push_str(&token[..=end]);
                }
                rest = &token[end + 1..];
            }
            None => {
                out.push_str(token);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message_cache::store::parse_timestamp_us;
    use crate::message_cache::tests::{open, state};
    use serde_json::{json, Value};
    use std::sync::LazyLock;

    static VECTORS: LazyLock<Value> = LazyLock::new(|| {
        serde_json::from_str(include_str!("../../../protocol/plugin-chat-vectors.json"))
            .expect("plugin-chat-vectors.json is JSON")
    });

    fn ws() -> &'static str {
        VECTORS["workspaceId"].as_str().unwrap()
    }

    fn conv() -> &'static str {
        VECTORS["conversationId"].as_str().unwrap()
    }

    fn row_id(n: usize) -> String {
        VECTORS["rows"][n]["id"].as_str().unwrap().to_string()
    }

    fn insert(store: &CacheStore, workspace: &str, conversation: &str, row: &Value) {
        store
            .conn
            .execute(
                "INSERT INTO message (id, workspace_id, conversation_id, thread_id, author_id,
                     version, sent_at_us, edited_at, is_deleted, text, payload, e2ee_state)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    row["id"].as_str().unwrap(),
                    workspace,
                    conversation,
                    row["threadId"].as_str(),
                    row["authorId"].as_str().unwrap(),
                    parse_timestamp_us(row["sentAt"].as_str().unwrap()).unwrap(),
                    row["editedAt"].as_str(),
                    row["isDeleted"].as_bool().unwrap(),
                    row["text"].as_str(),
                    row["payload"].to_string(),
                    row["e2eeState"].as_str(),
                ],
            )
            .unwrap();
    }

    fn follow(store: &CacheStore, workspace: &str, conversation: &str, complete: bool) {
        store
            .conn
            .execute(
                "INSERT INTO conversation_sync (workspace_id, conversation_id, complete)
                 VALUES (?1, ?2, ?3)",
                params![workspace, conversation, complete],
            )
            .unwrap();
    }

    /// A cache holding the vector's encrypted group, with this device in its group.
    fn vector_store() -> (
        tempfile::TempDir,
        std::sync::Arc<std::sync::Mutex<CacheStore>>,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let store = open(&state(dir.path(), 9), "user-1");
        {
            let s = store.lock().unwrap();
            follow(&s, ws(), conv(), true);
            for row in VECTORS["rows"].as_array().unwrap() {
                insert(&s, ws(), conv(), row);
            }
            s.conn
                .execute(
                    "INSERT INTO e2ee_conversation (workspace_id, conversation_id, incarnation)
                     VALUES (?1, ?2, 1)",
                    params![ws(), conv()],
                )
                .unwrap();
        }
        (dir, store)
    }

    fn reader() -> PluginReadScope {
        PluginReadScope {
            encrypted_allowed: true,
            known_encrypted: vec![],
        }
    }

    fn plain_reader() -> PluginReadScope {
        PluginReadScope::default()
    }

    #[test]
    fn user_mentions_become_provisional_principals() {
        let user = "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b";
        let principal = Principal::provisional(user, "").principal_id;
        assert_eq!(
            principal_mentions(&format!("hi <@{user}> and <@rimp1_abc>, <@nope> <@")),
            format!("hi <@{principal}> and <@rimp1_abc>, <@nope> <@")
        );
    }

    #[test]
    fn a_list_is_the_shared_vector() {
        let (_dir, store) = vector_store();
        let store = store.lock().unwrap();
        let page = store
            .plugin_messages(ws(), conv(), None, Some(50), &reader())
            .unwrap()
            .expect("the conversation is fully cached");
        assert_eq!(
            serde_json::to_value(&page).unwrap(),
            VECTORS["listMessages"]["result"]
        );
    }

    #[test]
    fn nothing_secret_or_unverified_reaches_a_plugin() {
        let (_dir, store) = vector_store();
        let store = store.lock().unwrap();
        let mut seen = vec![serde_json::to_value(
            store
                .plugin_messages(ws(), conv(), None, None, &reader())
                .unwrap(),
        )
        .unwrap()];
        for n in 0..VECTORS["rows"].as_array().unwrap().len() {
            seen.push(
                serde_json::to_value(store.plugin_message(ws(), &row_id(n), &reader()).unwrap())
                    .unwrap(),
            );
        }
        for query in ["plan", "still", "shall", "edited"] {
            seen.push(
                serde_json::to_value(
                    store
                        .plugin_search(ws(), query, None, None, &reader())
                        .unwrap(),
                )
                .unwrap(),
            );
        }
        let text = Value::Array(seen).to_string();
        for forbidden in VECTORS["forbiddenStrings"].as_array().unwrap() {
            let forbidden = forbidden.as_str().unwrap();
            assert!(!text.contains(forbidden), "`{forbidden}` reached a plugin");
        }
        for key in [
            "frankingKey",
            "secret",
            "blobSha256",
            "e2ee",
            "ciphertext",
            "epoch",
        ] {
            assert!(!text.contains(key), "`{key}` reached a plugin");
        }
    }

    #[test]
    fn placeholders_unverified_tombstones_and_unsent_rows_are_not_found() {
        let (_dir, store) = vector_store();
        let store = store.lock().unwrap();
        for n in [2, 3, 4, 5] {
            assert_eq!(
                store.plugin_message(ws(), &row_id(n), &reader()).unwrap(),
                None,
                "row {n}"
            );
        }
        assert!(store
            .plugin_search(ws(), "still", None, None, &reader())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn an_encrypted_conversation_needs_the_encrypted_grant() {
        let (_dir, store) = vector_store();
        let store = store.lock().unwrap();
        assert!(matches!(
            store.plugin_messages(ws(), conv(), None, None, &plain_reader()),
            Err(CacheError::EncryptedDenied)
        ));
        // Even its plaintext from before the upgrade.
        for n in [0, 1] {
            assert!(matches!(
                store.plugin_message(ws(), &row_id(n), &plain_reader()),
                Err(CacheError::EncryptedDenied)
            ));
        }
        assert!(matches!(
            store.plugin_search(ws(), "plan", Some(conv()), None, &plain_reader()),
            Err(CacheError::EncryptedDenied)
        ));
        // Across conversations its hits are left out.
        assert!(store
            .plugin_search(ws(), "plan", None, None, &plain_reader())
            .unwrap()
            .is_empty());
        assert_eq!(
            store
                .plugin_search(ws(), "plan", None, None, &reader())
                .unwrap()
                .iter()
                .map(|m| m.id.clone())
                .collect::<Vec<_>>(),
            vec![row_id(1)]
        );
    }

    #[test]
    fn a_plaintext_conversation_reads_with_chat_read_unless_known_encrypted() {
        let (_dir, store) = vector_store();
        let store = store.lock().unwrap();
        let plain = "0192f000-0000-7000-8000-00000000c0b2";
        follow(&store, ws(), plain, true);
        let mut row = VECTORS["rows"][0].clone();
        row["id"] = json!("0192f000-0000-7000-8000-0000000000f1");
        row["payload"]["conversationId"] = json!(plain);
        insert(&store, ws(), plain, &row);

        let page = store
            .plugin_messages(ws(), plain, None, None, &plain_reader())
            .unwrap()
            .unwrap();
        assert_eq!(page.messages.len(), 1);
        assert!(!page.messages[0].encrypted);
        let hits = store
            .plugin_search(ws(), "encrypt", None, None, &plain_reader())
            .unwrap();
        assert_eq!(hits.len(), 1, "only the plaintext conversation's copy");
        assert_eq!(hits[0].conversation_id, plain);

        let told = PluginReadScope {
            encrypted_allowed: false,
            known_encrypted: vec![plain.to_string()],
        };
        assert!(matches!(
            store.plugin_messages(ws(), plain, None, None, &told),
            Err(CacheError::EncryptedDenied)
        ));
    }

    #[test]
    fn lists_page_with_before_and_wait_for_a_complete_history() {
        let (_dir, store) = vector_store();
        let store = store.lock().unwrap();
        let newest = store
            .plugin_messages(ws(), conv(), None, Some(1), &reader())
            .unwrap()
            .unwrap();
        assert_eq!(newest.messages[0].id, row_id(6));
        assert!(newest.has_older);
        let older = store
            .plugin_messages(ws(), conv(), Some(&row_id(6)), Some(5), &reader())
            .unwrap()
            .unwrap();
        assert_eq!(
            older
                .messages
                .iter()
                .map(|m| m.id.clone())
                .collect::<Vec<_>>(),
            vec![row_id(0), row_id(1)]
        );
        assert!(!older.has_older);
        assert!(matches!(
            store.plugin_messages(ws(), conv(), Some("nope"), None, &reader()),
            Err(CacheError::Invalid(_))
        ));

        let partial = "0192f000-0000-7000-8000-00000000c0c3";
        follow(&store, ws(), partial, false);
        assert_eq!(
            store
                .plugin_messages(ws(), partial, None, None, &reader())
                .unwrap(),
            None
        );
        // Another workspace's conversation is not this one's.
        assert_eq!(
            store
                .plugin_message("ws-other", &row_id(0), &reader())
                .unwrap(),
            None
        );
    }

    /// A local-process plugin asking over its stdio pipe gets the vector, through the
    /// broker, the relay and a UI that answers from the cache.
    #[tokio::test]
    async fn a_local_process_plugin_gets_the_same_list() {
        use crate::plugin_host::broker::{
            run_broker_loop, BrokerConfig, PluginBroker, PluginClient,
        };
        use crate::plugin_host::capability::CapabilityGate;
        use crate::plugin_host::chat_relay::ChatRelay;
        use crate::plugin_host::wire::{self, JsonRpcRequest};

        let (_dir, store) = vector_store();
        let relay = std::sync::Arc::new(ChatRelay::default());
        let mut ui = relay.subscribe();
        let (host_end, mut plugin) = tokio::io::duplex(64 * 1024);
        let (reader_half, writer_half) = tokio::io::split(host_end);
        let (_client, outbound_rx) = PluginClient::channel();
        let (_shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
        let granted: Vec<String> =
            serde_json::from_value(VECTORS["listMessages"]["grantedCapabilities"].clone()).unwrap();
        let broker = PluginBroker::new(
            "dev.example.reader".into(),
            CapabilityGate::new(granted.clone()),
            BrokerConfig::default(),
        )
        .with_chat_relay(relay.clone());
        tokio::spawn(run_broker_loop(
            broker,
            reader_half,
            writer_half,
            outbound_rx,
            shutdown_rx,
        ));

        let answering = {
            let relay = relay.clone();
            tokio::spawn(async move {
                let request = ui.recv().await.unwrap();
                assert_eq!(request.granted_capabilities, granted);
                let scope = PluginReadScope {
                    encrypted_allowed: request
                        .granted_capabilities
                        .iter()
                        .any(|c| c == "chat.read.encrypted"),
                    known_encrypted: vec![],
                };
                let conversation = request.params["conversationId"].as_str().unwrap();
                let page = store
                    .lock()
                    .unwrap()
                    .plugin_messages(ws(), conversation, None, None, &scope)
                    .unwrap();
                relay.respond(request.request_id, Ok(serde_json::to_value(page).unwrap()));
            })
        };

        let request = JsonRpcRequest::new(
            "rim.chat.list_messages",
            Some(VECTORS["listMessages"]["params"].clone()),
            7,
        );
        wire::write_frame(&mut plugin, &request).await.unwrap();
        let answer: Value = wire::read_raw_frame(&mut plugin).await.unwrap();
        assert_eq!(answer["id"], 7);
        assert_eq!(answer["result"], VECTORS["listMessages"]["result"]);
        answering.await.unwrap();
    }
}
