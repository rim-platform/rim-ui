//! The sync loop against a mocked change feed that follows the server contract
//! (rim-server `docs/message-change-feed.md`): per-conversation versions, a change budget per
//! request, `hasMore`, `RESET` when a cursor is ahead of the counters, and `NO_ACCESS`.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::json;

use super::feed::{ChangesRequest, ChangesStatus, ConversationChanges, MessageChange};
use super::key::{CacheKey, KeySource};
use super::search::{LocalSearchPage, LocalSearchQuery};
use super::store::{CacheStore, TimelineCursor, TimelinePage};
use super::{AccountId, CacheError, MessageCacheState};

pub(crate) const WS: &str = "ws-1";

pub(crate) struct FixedKey([u8; 32]);

impl KeySource for FixedKey {
    fn load_or_create(&self) -> Result<CacheKey, CacheError> {
        Ok(CacheKey::from_bytes(self.0))
    }
}

pub(crate) fn state(dir: &Path, key: u8) -> MessageCacheState {
    MessageCacheState::new(dir.to_path_buf(), Box::new(FixedKey([key; 32])))
}

pub(crate) fn account(user: &str) -> AccountId {
    AccountId {
        endpoint: "http://localhost:8080/api".into(),
        user_id: user.into(),
    }
}

// ─── Mock feed ──────────────────────────────────────────────────────────────

#[derive(Clone)]
struct ServerMessage {
    version: i64,
    text: Option<String>,
    thread_id: Option<String>,
    deleted: bool,
    edited: bool,
    sent_at: String,
}

#[derive(Default)]
struct ServerConversation {
    counter: i64,
    messages: BTreeMap<String, ServerMessage>,
    no_access: bool,
}

pub(crate) struct MockFeed {
    budget: usize,
    conversations: HashMap<String, ServerConversation>,
    pub(crate) requests: usize,
}

impl MockFeed {
    pub(crate) fn new(budget: usize) -> Self {
        Self {
            budget,
            conversations: HashMap::new(),
            requests: 0,
        }
    }

    fn conversation(&mut self, id: &str) -> &mut ServerConversation {
        self.conversations.entry(id.to_string()).or_default()
    }

    pub(crate) fn send(
        &mut self,
        conversation: &str,
        id: &str,
        text: &str,
        thread_id: Option<&str>,
    ) {
        let conv = self.conversation(conversation);
        conv.counter += 1;
        let n = conv.messages.len();
        conv.messages.insert(
            id.to_string(),
            ServerMessage {
                version: conv.counter,
                text: Some(text.to_string()),
                thread_id: thread_id.map(str::to_string),
                deleted: false,
                edited: false,
                // One second apart, in send order.
                sent_at: format!("2026-10-08T10:{:02}:{:02}.5Z", n / 60, n % 60),
            },
        );
    }

    pub(crate) fn send_many(&mut self, conversation: &str, count: usize) {
        for i in 0..count {
            self.send(
                conversation,
                &format!("{conversation}-m{i:03}"),
                &format!("hello {i}"),
                None,
            );
        }
    }

    pub(crate) fn edit(&mut self, conversation: &str, id: &str, text: &str) {
        let conv = self.conversation(conversation);
        conv.counter += 1;
        let version = conv.counter;
        let message = conv.messages.get_mut(id).unwrap();
        message.version = version;
        message.text = Some(text.to_string());
        message.edited = true;
    }

    pub(crate) fn delete(&mut self, conversation: &str, id: &str) {
        let conv = self.conversation(conversation);
        conv.counter += 1;
        let version = conv.counter;
        let message = conv.messages.get_mut(id).unwrap();
        message.version = version;
        message.deleted = true;
    }

    /// The server's database is restored from an older backup: `id` never existed and the
    /// counters start over, so the client's stored cursor is now ahead of them.
    pub(crate) fn restore_backup_without(&mut self, conversation: &str, id: &str) {
        let conv = self.conversation(conversation);
        conv.messages.remove(id);
        let mut ordered: Vec<_> = conv.messages.iter_mut().collect();
        ordered.sort_by(|a, b| a.1.sent_at.cmp(&b.1.sent_at));
        for (i, (_, message)) in ordered.into_iter().enumerate() {
            message.version = i as i64 + 1;
        }
        conv.counter = conv.messages.len() as i64;
    }

    pub(crate) fn respond(&mut self, request: &ChangesRequest) -> Vec<ConversationChanges> {
        self.requests += 1;
        assert!(
            request.conversations.len() <= 100,
            "the server takes at most 100 conversations"
        );
        let limit = request.limit.unwrap_or(100).clamp(1, 200) as usize;
        let limit = limit.min((self.budget / request.conversations.len()).max(1));

        request
            .conversations
            .iter()
            .map(|cursor| {
                let echo = cursor.after.clone().unwrap_or_else(|| "0".into());
                let conv = self
                    .conversations
                    .entry(cursor.conversation_id.clone())
                    .or_default();
                if conv.no_access {
                    return ConversationChanges {
                        conversation_id: cursor.conversation_id.clone(),
                        status: ChangesStatus::NoAccess,
                        changes: Vec::new(),
                        cursor: echo,
                        has_more: false,
                    };
                }
                let mut after: i64 = echo.parse().expect("cursor is a version");
                let mut status = ChangesStatus::Ok;
                if after > conv.counter {
                    status = ChangesStatus::Reset;
                    after = 0;
                }
                let mut newer: Vec<_> = conv
                    .messages
                    .iter()
                    .filter(|(_, m)| m.version > after)
                    .collect();
                newer.sort_by_key(|(_, m)| m.version);
                let has_more = newer.len() > limit;
                newer.truncate(limit);
                let next_cursor = newer
                    .last()
                    .map(|(_, m)| m.version.to_string())
                    .unwrap_or_else(|| after.to_string());
                ConversationChanges {
                    conversation_id: cursor.conversation_id.clone(),
                    status,
                    changes: newer
                        .into_iter()
                        .map(|(id, m)| change(&cursor.conversation_id, id, m))
                        .collect(),
                    cursor: next_cursor,
                    has_more,
                }
            })
            .collect()
    }
}

fn change(conversation_id: &str, id: &str, m: &ServerMessage) -> MessageChange {
    let text = if m.deleted { None } else { m.text.clone() };
    MessageChange {
        version: m.version.to_string(),
        edited_at: m.edited.then(|| "2026-10-08T12:00:00Z".to_string()),
        message: message_json(
            conversation_id,
            id,
            text,
            m.thread_id.as_deref(),
            m.deleted,
            &m.sent_at,
        ),
    }
}

fn message_json(
    conversation_id: &str,
    id: &str,
    text: Option<String>,
    thread_id: Option<&str>,
    deleted: bool,
    sent_at: &str,
) -> serde_json::Value {
    json!({
        "id": id,
        "serverId": WS,
        "conversationId": conversation_id,
        "threadId": thread_id,
        "rootThreadId": null,
        "authorId": "user-1",
        "author": { "id": "user-1", "username": "ada", "displayName": "Ada", "avatarUrl": null },
        "text": text,
        "hasAttachments": !deleted,
        "parentMessageId": null,
        "isPinned": false,
        "isDeleted": deleted,
        "mentionedUserIds": [],
        "forwardedFromMessageId": null,
        "forwardedFrom": null,
        "sentAt": sent_at,
        // The server sends none for a tombstone; a misbehaving one would not get them stored.
        "attachments": [{ "id": "att-1", "filename": "secret.pdf", "contentType": "application/pdf", "sizeBytes": 10, "status": "READY" }],
        "linkPreviews": [],
        "reactions": [],
    })
}

/// The webview's loop, verbatim: begin, then fetch and apply until there is no next request.
pub(crate) fn sync(store: &mut CacheStore, feed: &mut MockFeed, ids: Option<&[String]>) {
    let mut request = store.begin_sync(WS, ids).unwrap();
    let mut rounds = 0;
    while let Some(r) = request {
        rounds += 1;
        assert!(rounds < 1000, "sync loop did not terminate");
        let response = feed.respond(&r);
        request = store.apply_changes(WS, response).unwrap();
    }
}

pub(crate) fn texts(page: &TimelinePage) -> Vec<String> {
    page.items
        .iter()
        .map(|m| m["text"].as_str().unwrap().to_string())
        .collect()
}

pub(crate) fn cached_ids(store: &CacheStore, conversation: &str) -> Vec<String> {
    let mut stmt = store
        .conn
        .prepare("SELECT id FROM message WHERE conversation_id = ?1 ORDER BY id")
        .unwrap();
    stmt.query_map([conversation], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn seqs(store: &CacheStore, conversation: &str) -> Vec<(String, i64)> {
    let mut stmt = store
        .conn
        .prepare("SELECT id, seq FROM message WHERE conversation_id = ?1 ORDER BY id")
        .unwrap();
    stmt.query_map([conversation], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

pub(crate) fn open(state: &MessageCacheState, user: &str) -> Arc<Mutex<CacheStore>> {
    state.store(&account(user)).unwrap()
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[test]
fn initial_sync_pages_through_the_budget_and_serves_the_timeline() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(10);
    feed.send_many("c1", 25);
    store.track(WS, "c1", 1).unwrap();

    sync(&mut store, &mut feed, None);

    assert_eq!(
        feed.requests, 3,
        "25 changes at 10 per request take three requests"
    );
    let page = store.timeline(WS, "c1", None, 10).unwrap().unwrap();
    assert_eq!(texts(&page).first().unwrap(), "hello 15");
    assert_eq!(texts(&page).last().unwrap(), "hello 24");
    assert!(page.has_older);

    let first = &page.items[0];
    let before = TimelineCursor {
        sent_at: first["sentAt"].as_str().unwrap().into(),
        message_id: first["id"].as_str().unwrap().into(),
    };
    let older = store
        .timeline(WS, "c1", Some(&before), 20)
        .unwrap()
        .unwrap();
    assert_eq!(older.items.len(), 15);
    assert_eq!(texts(&older).first().unwrap(), "hello 0");
    assert!(!older.has_older);
}

#[test]
fn timeline_is_withheld_until_the_history_is_complete() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(10);
    feed.send_many("c1", 25);
    store.track(WS, "c1", 1).unwrap();

    // One page, then the app quits mid-sync.
    let request = store.begin_sync(WS, None).unwrap().unwrap();
    let next = store.apply_changes(WS, feed.respond(&request)).unwrap();
    assert!(next.is_some(), "hasMore keeps the conversation pending");
    assert!(
        store.timeline(WS, "c1", None, 10).unwrap().is_none(),
        "a partial initial sync holds the oldest messages; never show them as the latest"
    );

    // The next run resumes from the stored cursor instead of starting over.
    let resumed = store.next_request(WS).unwrap().unwrap();
    assert_eq!(resumed.conversations[0].after.as_deref(), Some("10"));
    sync(&mut store, &mut feed, None);
    assert_eq!(
        store
            .timeline(WS, "c1", None, 50)
            .unwrap()
            .unwrap()
            .items
            .len(),
        25
    );
}

#[test]
fn edits_apply_and_deletes_become_tombstones() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 3);
    store.track(WS, "c1", 1).unwrap();
    sync(&mut store, &mut feed, None);
    let seqs_before = seqs(&store, "c1");

    feed.edit("c1", "c1-m001", "edited");
    feed.delete("c1", "c1-m002");
    // A real-time signal for c1.
    sync(&mut store, &mut feed, Some(&["c1".to_string()]));

    let page = store.timeline(WS, "c1", None, 10).unwrap().unwrap();
    assert_eq!(texts(&page), vec!["hello 0", "edited"]);
    // Upserts keep each row's `seq`, the rowid PR 10's FTS5 index points at.
    assert_eq!(seqs(&store, "c1"), seqs_before);

    let (text, payload, deleted): (Option<String>, String, bool) = store
        .conn
        .query_row(
            "SELECT text, payload, is_deleted FROM message WHERE id = 'c1-m002'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert!(deleted);
    assert_eq!(text, None);
    assert!(
        !payload.contains("secret.pdf"),
        "a tombstone keeps no attachments"
    );
    assert!(!payload.contains("hello 2"));
}

#[test]
fn an_edit_arriving_before_its_create_keeps_the_edit() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    store.track(WS, "c1", 1).unwrap();
    let sent_at = "2026-10-08T10:00:00Z";
    let entry = |version: &str, text: &str| ConversationChanges {
        conversation_id: "c1".into(),
        status: ChangesStatus::Ok,
        changes: vec![MessageChange {
            version: version.into(),
            edited_at: None,
            message: message_json("c1", "m1", Some(text.into()), None, false, sent_at),
        }],
        cursor: version.into(),
        has_more: false,
    };

    store.apply_changes(WS, vec![entry("5", "edited")]).unwrap();
    store
        .apply_changes(WS, vec![entry("2", "original")])
        .unwrap();

    let page = store.timeline(WS, "c1", None, 10).unwrap().unwrap();
    assert_eq!(
        texts(&page),
        vec!["edited"],
        "the higher version wins, not the later arrival"
    );
}

#[test]
fn reset_drops_the_cached_conversation_and_refetches_it() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(4);
    feed.send_many("c1", 6);
    feed.edit("c1", "c1-m000", "edited once");
    store.track(WS, "c1", 1).unwrap();
    sync(&mut store, &mut feed, None);
    assert_eq!(cached_ids(&store, "c1").len(), 6);

    // The server comes back from an older backup: m005 is gone and its counters restarted
    // below the cursor we stored, so the feed answers RESET.
    feed.restore_backup_without("c1", "c1-m005");
    sync(&mut store, &mut feed, None);

    let ids = cached_ids(&store, "c1");
    assert_eq!(
        ids.len(),
        5,
        "the cached copy was dropped and rebuilt from the server"
    );
    assert!(!ids.contains(&"c1-m005".to_string()));
    let page = store.timeline(WS, "c1", None, 10).unwrap().unwrap();
    assert_eq!(texts(&page).len(), 5);
    let cursor = store.next_request(WS).unwrap();
    assert!(
        cursor.is_none(),
        "the RESET sync completed, paging included"
    );
}

#[test]
fn no_access_drops_that_conversation_and_keeps_syncing_the_others() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 2);
    feed.send_many("c2", 2);
    store.track(WS, "c1", 1).unwrap();
    store.track(WS, "c2", 2).unwrap();
    sync(&mut store, &mut feed, None);

    feed.conversation("c1").no_access = true;
    feed.send("c2", "c2-new", "still here", None);
    sync(&mut store, &mut feed, None);

    assert!(cached_ids(&store, "c1").is_empty());
    assert!(store.timeline(WS, "c1", None, 10).unwrap().is_none());
    assert_eq!(cached_ids(&store, "c2").len(), 3);
    assert!(
        store
            .begin_sync(WS, Some(&["c1".to_string()]))
            .unwrap()
            .is_none(),
        "c1 is no longer followed"
    );
}

#[test]
fn signals_for_unfollowed_conversations_change_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send_many("never-opened", 3);

    assert!(store
        .begin_sync(WS, Some(&["never-opened".to_string()]))
        .unwrap()
        .is_none());

    // A stray answer for it is ignored too.
    let request = ChangesRequest {
        server_id: WS.into(),
        conversations: vec![super::feed::CursorInput {
            conversation_id: "never-opened".into(),
            after: None,
        }],
        limit: None,
    };
    store.apply_changes(WS, feed.respond(&request)).unwrap();
    assert!(cached_ids(&store, "never-opened").is_empty());
}

#[test]
fn thread_replies_are_cached_but_kept_out_of_the_timeline() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send("c1", "root", "root message", None);
    feed.send("c1", "reply", "a reply", Some("thread-1"));
    store.track(WS, "c1", 1).unwrap();
    sync(&mut store, &mut feed, None);

    assert_eq!(cached_ids(&store, "c1"), vec!["reply", "root"]);
    let page = store.timeline(WS, "c1", None, 10).unwrap().unwrap();
    assert_eq!(texts(&page), vec!["root message"]);
}

#[test]
fn accounts_never_share_a_database() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 2);
    {
        let store = open(&state, "alice");
        let mut store = store.lock().unwrap();
        store.track(WS, "c1", 1).unwrap();
        sync(&mut store, &mut feed, None);
    }

    let bob = open(&state, "bob");
    assert!(bob
        .lock()
        .unwrap()
        .timeline(WS, "c1", None, 10)
        .unwrap()
        .is_none());

    let other_server = AccountId {
        endpoint: "https://rim.example.org/api".into(),
        user_id: "alice".into(),
    };
    let elsewhere = state.store(&other_server).unwrap();
    assert!(elsewhere
        .lock()
        .unwrap()
        .timeline(WS, "c1", None, 10)
        .unwrap()
        .is_none());

    assert_eq!(
        std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|x| x == "db")
            })
            .count(),
        3
    );

    // A trailing slash is the same server.
    let alice_again = AccountId {
        endpoint: "http://localhost:8080/api/".into(),
        user_id: "alice".into(),
    };
    let store = state.store(&alice_again).unwrap();
    assert!(store
        .lock()
        .unwrap()
        .timeline(WS, "c1", None, 10)
        .unwrap()
        .is_some());
}

#[test]
fn the_database_files_hold_no_plaintext() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let mut feed = MockFeed::new(1000);
    feed.send("c1", "m1", "the launch code is swordfish", None);
    let store = open(&state, "alice");
    {
        let mut store = store.lock().unwrap();
        store.track(WS, "c1", 1).unwrap();
        sync(&mut store, &mut feed, None);
    }

    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let bytes = std::fs::read(entry.unwrap().path()).unwrap();
        let haystack = String::from_utf8_lossy(&bytes);
        assert!(!haystack.contains("swordfish"));
        assert!(!haystack.contains("SQLite format 3"));
        assert!(!haystack.contains("localhost"));
    }
}

#[test]
fn a_file_the_key_cannot_read_is_recreated_empty() {
    let dir = tempfile::tempdir().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 2);
    {
        let state = state(dir.path(), 1);
        let store = open(&state, "alice");
        let mut store = store.lock().unwrap();
        store.track(WS, "c1", 1).unwrap();
        sync(&mut store, &mut feed, None);
    }

    // The keyring entry was lost and a new key generated.
    let state = state(dir.path(), 2);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    assert!(store.timeline(WS, "c1", None, 10).unwrap().is_none());
    store.track(WS, "c1", 1).unwrap();
    sync(&mut store, &mut feed, None);
    assert_eq!(
        store
            .timeline(WS, "c1", None, 10)
            .unwrap()
            .unwrap()
            .items
            .len(),
        2
    );
}

#[test]
fn full_sync_covers_recent_conversations_and_batches_them() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    for i in 0..60 {
        store.track(WS, &format!("c{i:02}"), i).unwrap();
    }
    let request = store.begin_sync(WS, None).unwrap().unwrap();
    assert_eq!(
        request.conversations.len(),
        super::sync::RECENT_CONVERSATIONS
    );
    assert_eq!(
        request.conversations[0].conversation_id, "c59",
        "most recently viewed first"
    );
    assert!(request.conversations.iter().all(|c| c.after.is_none()));
    assert_eq!(request.limit, Some(super::sync::PER_CONVERSATION_LIMIT));
}

#[test]
fn malformed_changes_are_skipped_without_failing_the_page() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    store.track(WS, "c1", 1).unwrap();
    let good = message_json(
        "c1",
        "good",
        Some("ok".into()),
        None,
        false,
        "2026-10-08T10:00:00Z",
    );
    let wrong_conversation = message_json(
        "c2",
        "stray",
        Some("no".into()),
        None,
        false,
        "2026-10-08T10:00:01Z",
    );
    let entry = ConversationChanges {
        conversation_id: "c1".into(),
        status: ChangesStatus::Ok,
        changes: vec![
            MessageChange {
                version: "x".into(),
                edited_at: None,
                message: good.clone(),
            },
            MessageChange {
                version: "2".into(),
                edited_at: None,
                message: json!({ "id": 1 }),
            },
            MessageChange {
                version: "3".into(),
                edited_at: None,
                message: wrong_conversation,
            },
            MessageChange {
                version: "4".into(),
                edited_at: None,
                message: good,
            },
        ],
        cursor: "4".into(),
        has_more: false,
    };
    store.apply_changes(WS, vec![entry]).unwrap();
    assert_eq!(cached_ids(&store, "c1"), vec!["good"]);
    assert!(cached_ids(&store, "c2").is_empty());
}

// ─── Local search (PR 10) ───────────────────────────────────────────────────

fn text_query(text: &str) -> LocalSearchQuery {
    LocalSearchQuery {
        text: text.into(),
        ..Default::default()
    }
}

fn search(store: &CacheStore, text: &str) -> LocalSearchPage {
    store.search(WS, &text_query(text), None, 50).unwrap()
}

fn hit_ids(page: &LocalSearchPage) -> Vec<String> {
    page.items.iter().map(|h| h.id.clone()).collect()
}

/// FTS5's own checks: the index is sound, and it holds exactly what the `message` rows it
/// covers would produce (tombstones included, as entries without words).
fn assert_index_consistent(store: &CacheStore) {
    store
        .conn
        .execute_batch(
            "INSERT INTO message_fts (message_fts) VALUES ('integrity-check');
             INSERT INTO message_fts (message_fts, rank) VALUES ('integrity-check', 1);",
        )
        .unwrap();
}

#[test]
fn search_finds_created_messages_with_a_highlighted_snippet() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send("c1", "m1", "the deploy failed on <b>staging</b>", None);
    feed.send("c1", "m2", "lunch?", None);
    feed.send("c1", "m3", "Déploiement prévu", None);
    feed.send(
        "c1",
        "m4",
        "redeploy tomorrow, deployment notes attached",
        None,
    );
    store.track(WS, "c1", 1).unwrap();
    sync(&mut store, &mut feed, None);

    let page = search(&store, "deploy");
    assert_eq!(
        hit_ids(&page),
        vec!["m4", "m1"],
        "newest first; words match as prefixes, not infixes"
    );
    let hit = &page.items[1];
    assert_eq!(hit.conversation_id, "c1");
    assert_eq!(hit.server_id, WS);
    assert_eq!(hit.author_id, "user-1");
    assert_eq!(hit.author["username"], "ada");
    assert_eq!(hit.sent_at, "2026-10-08T10:00:00.5Z");
    assert_eq!(hit.text, "the deploy failed on <b>staging</b>");
    assert_eq!(
        hit.headline.as_deref(),
        Some("the <mark>deploy</mark> failed on &lt;b&gt;staging&lt;/b&gt;"),
        "the snippet is escaped HTML with only the marks as tags"
    );
    assert!(hit.rank > 0.0);

    assert_eq!(hit_ids(&search(&store, "DEPLOY")), vec!["m4", "m1"]);
    assert_eq!(
        hit_ids(&search(&store, "depl")),
        vec!["m4", "m3", "m1"],
        "a prefix matches across diacritics"
    );
    assert_eq!(
        hit_ids(&search(&store, "deploiement")),
        vec!["m3"],
        "diacritics fold"
    );
    assert_eq!(hit_ids(&search(&store, "deploy staging")), vec!["m1"]);
    assert_eq!(hit_ids(&search(&store, "\"deploy failed\"")), vec!["m1"]);
    assert!(search(&store, "\"failed deploy\"").items.is_empty());
    assert!(search(&store, "nothing-like-this").items.is_empty());
    // FTS5 syntax typed by a user is text, never an error.
    assert!(search(&store, "deploy OR NEAR( * ^ \"").items.is_empty());
    assert!(search(&store, "!!!").items.is_empty());
    assert!(search(&store, "").items.is_empty());
    assert_index_consistent(&store);
}

#[test]
fn an_edit_reindexes_and_a_delete_removes_the_entry() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send("c1", "m1", "original wording", None);
    feed.send("c1", "m2", "soon to be removed", None);
    store.track(WS, "c1", 1).unwrap();
    sync(&mut store, &mut feed, None);
    assert_eq!(hit_ids(&search(&store, "original")), vec!["m1"]);
    assert_eq!(hit_ids(&search(&store, "removed")), vec!["m2"]);

    feed.edit("c1", "m1", "revised wording");
    feed.delete("c1", "m2");
    sync(&mut store, &mut feed, Some(&["c1".to_string()]));

    assert!(search(&store, "original").items.is_empty());
    assert_eq!(hit_ids(&search(&store, "revised")), vec!["m1"]);
    assert_eq!(hit_ids(&search(&store, "wording")), vec!["m1"]);
    assert!(
        search(&store, "removed").items.is_empty(),
        "a tombstone is not searchable"
    );
    // Nor by operators alone: a tombstone is no hit of any kind.
    let all = store
        .search(
            WS,
            &LocalSearchQuery {
                conversation_id: Some("c1".into()),
                ..Default::default()
            },
            None,
            50,
        )
        .unwrap();
    assert_eq!(hit_ids(&all), vec!["m1"]);
    assert_index_consistent(&store);

    // A stale lower version of the edit changes nothing, in the index either.
    store
        .apply_changes(
            WS,
            vec![ConversationChanges {
                conversation_id: "c1".into(),
                status: ChangesStatus::Ok,
                changes: vec![MessageChange {
                    version: "1".into(),
                    edited_at: None,
                    message: message_json(
                        "c1",
                        "m1",
                        Some("original wording".into()),
                        None,
                        false,
                        "2026-10-08T10:00:00.5Z",
                    ),
                }],
                cursor: "4".into(),
                has_more: false,
            }],
        )
        .unwrap();
    assert!(search(&store, "original").items.is_empty());
    assert_index_consistent(&store);
}

#[test]
fn lost_access_and_reset_take_messages_out_of_the_index() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send("c1", "c1-a", "quarterly numbers", None);
    feed.send("c2", "c2-a", "quarterly plan", None);
    feed.send("c2", "c2-b", "quarterly draft", None);
    store.track(WS, "c1", 1).unwrap();
    store.track(WS, "c2", 2).unwrap();
    sync(&mut store, &mut feed, None);
    assert_eq!(search(&store, "quarterly").items.len(), 3);

    feed.conversation("c1").no_access = true;
    feed.restore_backup_without("c2", "c2-b");
    sync(&mut store, &mut feed, None);

    assert_eq!(
        hit_ids(&search(&store, "quarterly")),
        vec!["c2-a"],
        "c1 is gone with the access to it; c2 was rebuilt without c2-b"
    );
    assert_index_consistent(&store);
}

#[test]
fn search_is_scoped_to_the_workspace_and_its_filters() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send("c1", "m1", "release notes https://example.org/r1", None);
    feed.send("c1", "m2", "release party", Some("thread-1"));
    feed.send("c2", "m3", "release checklist", None);
    store.track(WS, "c1", 1).unwrap();
    store.track(WS, "c2", 2).unwrap();
    sync(&mut store, &mut feed, None);

    let query = |f: &dyn Fn(&mut LocalSearchQuery)| {
        let mut q = text_query("release");
        f(&mut q);
        hit_ids(&store.search(WS, &q, None, 50).unwrap())
    };
    // The mock spaces messages a second apart per conversation: m1 and m3 at 10:00:00.5
    // (the id breaks the tie), m2 at 10:00:01.5.
    assert_eq!(query(&|_| {}), vec!["m2", "m3", "m1"]);
    assert_eq!(
        query(&|q| q.conversation_id = Some("c1".into())),
        vec!["m2", "m1"]
    );
    assert_eq!(query(&|q| q.has_link = true), vec!["m1"]);
    assert_eq!(
        query(&|q| q.from = Some("@ADA".into())),
        vec!["m2", "m3", "m1"]
    );
    assert_eq!(query(&|q| q.from = Some("user-1".into())).len(), 3);
    assert!(query(&|q| q.from = Some("@bob".into())).is_empty());
    assert_eq!(
        query(&|q| q.before = Some("2026-10-08T10:00:01Z".into())),
        vec!["m3", "m1"]
    );
    assert_eq!(
        query(&|q| q.after = Some("2026-10-08T10:00:01Z".into())),
        vec!["m2"]
    );
    // The mock's messages all carry an attachment.
    assert_eq!(query(&|q| q.has_attachment = true).len(), 3);

    // Another workspace on the same account sees none of it.
    assert!(store
        .search("ws-2", &text_query("release"), None, 50)
        .unwrap()
        .items
        .is_empty());
}

#[test]
fn search_pages_with_the_timeline_cursor() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 7);
    store.track(WS, "c1", 1).unwrap();
    sync(&mut store, &mut feed, None);

    let mut seen = Vec::new();
    let mut after: Option<TimelineCursor> = None;
    loop {
        let page = store
            .search(WS, &text_query("hello"), after.as_ref(), 3)
            .unwrap();
        seen.extend(hit_ids(&page));
        if !page.has_more {
            break;
        }
        let last = page.items.last().unwrap();
        after = Some(TimelineCursor {
            sent_at: last.sent_at.clone(),
            message_id: last.id.clone(),
        });
    }
    let expected: Vec<String> = (0..7).rev().map(|i| format!("c1-m{i:03}")).collect();
    assert_eq!(seen, expected);
}

#[test]
fn a_thread_reply_hit_names_its_cached_root_message() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    store.track(WS, "c1", 1).unwrap();
    let mut root = message_json(
        "c1",
        "root",
        Some("kickoff".into()),
        None,
        false,
        "2026-10-08T10:00:00Z",
    );
    root["rootThreadId"] = json!("thread-1");
    let reply = message_json(
        "c1",
        "reply",
        Some("agenda attached".into()),
        Some("thread-1"),
        false,
        "2026-10-08T10:00:01Z",
    );
    let changes = [root, reply]
        .into_iter()
        .enumerate()
        .map(|(i, message)| MessageChange {
            version: (i + 1).to_string(),
            edited_at: None,
            message,
        })
        .collect();
    store
        .apply_changes(
            WS,
            vec![ConversationChanges {
                conversation_id: "c1".into(),
                status: ChangesStatus::Ok,
                changes,
                cursor: "2".into(),
                has_more: false,
            }],
        )
        .unwrap();

    let hit = &search(&store, "agenda").items[0];
    assert_eq!(hit.thread_id.as_deref(), Some("thread-1"));
    assert_eq!(hit.root_message_id.as_deref(), Some("root"));
    assert_eq!(search(&store, "kickoff").items[0].root_message_id, None);

    // The root is found through its index, not by scanning the conversation.
    let plan: Vec<String> = store
        .conn
        .prepare(&format!(
            "EXPLAIN QUERY PLAN SELECT {} FROM message m",
            super::search::HIT_COLUMNS
        ))
        .unwrap()
        .query_map([], |row| row.get(3))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(
        plan.iter()
            .any(|step| step.contains("USING INDEX message_thread_root")),
        "{plan:?}"
    );
}

#[test]
fn accounts_never_see_each_others_search_hits() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let mut feed = MockFeed::new(1000);
    feed.send("c1", "m1", "alice's private plans", None);
    {
        let store = open(&state, "alice");
        let mut store = store.lock().unwrap();
        store.track(WS, "c1", 1).unwrap();
        sync(&mut store, &mut feed, None);
        assert_eq!(hit_ids(&search(&store, "private")), vec!["m1"]);
    }

    let bob = open(&state, "bob");
    let bob = bob.lock().unwrap();
    assert!(search(&bob, "private").items.is_empty());
    let all = bob
        .search(
            WS,
            &LocalSearchQuery {
                conversation_id: Some("c1".into()),
                ..Default::default()
            },
            None,
            50,
        )
        .unwrap();
    assert!(all.items.is_empty());
}

#[test]
fn an_existing_cache_is_backfilled_once_on_upgrade() {
    let dir = tempfile::tempdir().unwrap();
    let key = CacheKey::from_bytes([1; 32]);
    let alice = account("alice");
    let path = dir.path().join(alice.file_name());

    // A schema v1 cache as PR 9 left it: two live messages and a tombstone.
    {
        let conn = super::store::open_keyed(&path, &key).unwrap();
        conn.execute_batch(super::store::SCHEMA_V1).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute(
            "INSERT INTO meta (key, value) VALUES ('account', ?1)",
            [alice.label()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversation_sync (workspace_id, conversation_id, complete)
             VALUES (?1, 'c1', 1)",
            [WS],
        )
        .unwrap();
        for (id, text, deleted) in [
            ("m1", Some("backfilled before upgrade"), false),
            ("m2", Some("also before"), false),
            ("m3", None, true),
        ] {
            let payload = message_json("c1", id, None, None, deleted, "2026-10-08T10:00:00Z");
            conn.execute(
                "INSERT INTO message (id, workspace_id, conversation_id, author_id, version,
                                      sent_at_us, is_deleted, text, payload)
                 VALUES (?1, ?2, 'c1', 'user-1', 1, 0, ?3, ?4, ?5)",
                rusqlite::params![id, WS, deleted, text, payload.to_string()],
            )
            .unwrap();
        }
    }

    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let store = store.lock().unwrap();
    let version: i32 = store
        .conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(version, 3);
    assert_eq!(hit_ids(&search(&store, "before")), vec!["m2", "m1"]);
    assert_index_consistent(&store);

    // Schema v3 numbers what was cached before it, so the first archive export has it all.
    let mut store = store;
    let batch = store
        .archive_batch("archive-1", "device-1", 100)
        .unwrap()
        .unwrap();
    assert_eq!((batch.messages, batch.conversations), (3, 1));
    store
        .mark_archived("archive-1", "device-1", &batch)
        .unwrap();
    assert!(store
        .archive_batch("archive-1", "device-1", 100)
        .unwrap()
        .is_none());

    // Reopening does not backfill a second time.
    drop(store);
    let again = CacheStore::open(&path, &key, &alice).unwrap();
    assert_eq!(hit_ids(&search(&again, "before")), vec!["m2", "m1"]);
    assert_index_consistent(&again);
}

#[test]
fn the_index_survives_vacuum() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let store = open(&state, "alice");
    let mut store = store.lock().unwrap();
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 20);
    for i in 0..15 {
        feed.delete("c1", &format!("c1-m{i:03}"));
    }
    store.track(WS, "c1", 1).unwrap();
    sync(&mut store, &mut feed, None);
    store.conn.execute_batch("VACUUM").unwrap();

    let page = search(&store, "hello");
    assert_eq!(page.items.len(), 5);
    for hit in &page.items {
        assert!(hit.headline.as_deref().unwrap().contains(&hit.text[6..]));
    }
    assert_index_consistent(&store);
}

#[test]
fn the_search_index_holds_no_plaintext_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    let state = state(dir.path(), 1);
    let mut feed = MockFeed::new(1000);
    feed.send("c1", "m1", "zanzibarquokka rendezvous", None);
    let store = open(&state, "alice");
    {
        let mut store = store.lock().unwrap();
        store.track(WS, "c1", 1).unwrap();
        sync(&mut store, &mut feed, None);
        assert_eq!(hit_ids(&search(&store, "zanzibar")), vec!["m1"]);
        // Push everything out of the WAL into the main file too.
        store
            .conn
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
    }

    let mut files = 0;
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        let path = entry.unwrap().path();
        let bytes = std::fs::read(&path).unwrap();
        files += 1;
        for needle in ["zanzibarquokka", "zanzibar", "rendezvous", "message_fts"] {
            assert!(
                !String::from_utf8_lossy(&bytes).contains(needle),
                "{needle} in plain text in {}",
                path.display()
            );
        }
    }
    assert!(files >= 1);
    // The index is in the database itself, not in a file next to it.
    let names: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        names
            .iter()
            .all(|n| n.ends_with(".db") || n.ends_with(".db-wal") || n.ends_with(".db-shm")),
        "{names:?}"
    );
}

/// A keyring that cannot hand out the key (no Secret Service, a locked keyring, a dismissed
/// unlock prompt), counting how often it is asked.
struct UnavailableKey(Arc<Mutex<u32>>);

impl KeySource for UnavailableKey {
    fn load_or_create(&self) -> Result<CacheKey, CacheError> {
        *self.0.lock().unwrap() += 1;
        Err(CacheError::Key("keyring read failed: the keyring is locked".into()))
    }
}

#[test]
fn a_key_failure_is_asked_once_and_leaves_no_files() {
    let dir = tempfile::tempdir().unwrap();
    let asked = Arc::new(Mutex::new(0));
    let state = MessageCacheState::new(
        dir.path().join("cache"),
        Box::new(UnavailableKey(asked.clone())),
    );

    for user in ["u1", "u1", "u2"] {
        let Err(err) = state.store(&account(user)) else {
            panic!("a cache opened without its key");
        };
        assert_eq!(err.code(), "CACHE_KEY");
        assert!(err.to_string().contains("locked"), "{err}");
    }
    assert_eq!(*asked.lock().unwrap(), 1);
    let files = std::fs::read_dir(dir.path().join("cache")).unwrap().count();
    assert_eq!(files, 0);
}
