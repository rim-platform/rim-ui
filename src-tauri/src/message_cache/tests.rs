//! The sync loop against a mocked change feed that follows the server contract
//! (rim-server `docs/message-change-feed.md`): per-conversation versions, a change budget per
//! request, `hasMore`, `RESET` when a cursor is ahead of the counters, and `NO_ACCESS`.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::json;

use super::feed::{ChangesRequest, ChangesStatus, ConversationChanges, MessageChange};
use super::key::{CacheKey, KeySource};
use super::store::{CacheStore, TimelineCursor, TimelinePage};
use super::{AccountId, CacheError, MessageCacheState};

const WS: &str = "ws-1";

struct FixedKey([u8; 32]);

impl KeySource for FixedKey {
    fn load_or_create(&self) -> Result<CacheKey, CacheError> {
        Ok(CacheKey::from_bytes(self.0))
    }
}

fn state(dir: &Path, key: u8) -> MessageCacheState {
    MessageCacheState::new(dir.to_path_buf(), Box::new(FixedKey([key; 32])))
}

fn account(user: &str) -> AccountId {
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

struct MockFeed {
    budget: usize,
    conversations: HashMap<String, ServerConversation>,
    requests: usize,
}

impl MockFeed {
    fn new(budget: usize) -> Self {
        Self {
            budget,
            conversations: HashMap::new(),
            requests: 0,
        }
    }

    fn conversation(&mut self, id: &str) -> &mut ServerConversation {
        self.conversations.entry(id.to_string()).or_default()
    }

    fn send(&mut self, conversation: &str, id: &str, text: &str, thread_id: Option<&str>) {
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

    fn send_many(&mut self, conversation: &str, count: usize) {
        for i in 0..count {
            self.send(
                conversation,
                &format!("{conversation}-m{i:03}"),
                &format!("hello {i}"),
                None,
            );
        }
    }

    fn edit(&mut self, conversation: &str, id: &str, text: &str) {
        let conv = self.conversation(conversation);
        conv.counter += 1;
        let version = conv.counter;
        let message = conv.messages.get_mut(id).unwrap();
        message.version = version;
        message.text = Some(text.to_string());
        message.edited = true;
    }

    fn delete(&mut self, conversation: &str, id: &str) {
        let conv = self.conversation(conversation);
        conv.counter += 1;
        let version = conv.counter;
        let message = conv.messages.get_mut(id).unwrap();
        message.version = version;
        message.deleted = true;
    }

    /// The server's database is restored from an older backup: `id` never existed and the
    /// counters start over, so the client's stored cursor is now ahead of them.
    fn restore_backup_without(&mut self, conversation: &str, id: &str) {
        let conv = self.conversation(conversation);
        conv.messages.remove(id);
        let mut ordered: Vec<_> = conv.messages.iter_mut().collect();
        ordered.sort_by(|a, b| a.1.sent_at.cmp(&b.1.sent_at));
        for (i, (_, message)) in ordered.into_iter().enumerate() {
            message.version = i as i64 + 1;
        }
        conv.counter = conv.messages.len() as i64;
    }

    fn respond(&mut self, request: &ChangesRequest) -> Vec<ConversationChanges> {
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
fn sync(store: &mut CacheStore, feed: &mut MockFeed, ids: Option<&[String]>) {
    let mut request = store.begin_sync(WS, ids).unwrap();
    let mut rounds = 0;
    while let Some(r) = request {
        rounds += 1;
        assert!(rounds < 1000, "sync loop did not terminate");
        let response = feed.respond(&r);
        request = store.apply_changes(WS, response).unwrap();
    }
}

fn texts(page: &TimelinePage) -> Vec<String> {
    page.items
        .iter()
        .map(|m| m["text"].as_str().unwrap().to_string())
        .collect()
}

fn cached_ids(store: &CacheStore, conversation: &str) -> Vec<String> {
    let mut stmt = store
        .conn
        .prepare("SELECT id FROM message WHERE conversation_id = ?1 ORDER BY id")
        .unwrap();
    stmt.query_map([conversation], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn open(state: &MessageCacheState, user: &str) -> Arc<Mutex<CacheStore>> {
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

    feed.edit("c1", "c1-m001", "edited");
    feed.delete("c1", "c1-m002");
    // A real-time signal for c1.
    sync(&mut store, &mut feed, Some(&["c1".to_string()]));

    let page = store.timeline(WS, "c1", None, 10).unwrap().unwrap();
    assert_eq!(texts(&page), vec!["hello 0", "edited"]);

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
