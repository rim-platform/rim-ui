//! The archive end to end: real cache databases fed by the mocked change feed of the cache's
//! own tests, a real folder, and several "devices" (each its own app data directory and cache)
//! sharing that folder.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::json;

use super::archive::Archive;
use super::crypto::{ArchiveKey, KdfCost};
use super::format::{self, ArchivedMessage, Event, FileKind, FilePlace};
use super::provider::{ArchiveProvider, LocalFolderProvider};
use super::{ArchiveError, HistoryArchiveState, KeyStore};
use crate::message_cache::tests::{
    account, cached_ids, open, state as cache_state, sync, texts, MockFeed, WS,
};
use crate::message_cache::{CacheStore, MessageCacheState};

/// Cheap enough for tests; the app uses [`KdfCost::DEFAULT`].
const TEST_COST: KdfCost = KdfCost {
    memory_kib: 64,
    iterations: 1,
    parallelism: 1,
};
const PASSPHRASE: &str = "correct horse battery staple";

#[derive(Default)]
struct MemoryKeys(Mutex<HashMap<String, [u8; 32]>>);

impl KeyStore for MemoryKeys {
    fn get(&self, archive_id: &str) -> Result<Option<ArchiveKey>, ArchiveError> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(archive_id)
            .map(|k| ArchiveKey::from_bytes(*k)))
    }

    fn set(&self, archive_id: &str, key: &ArchiveKey) -> Result<(), ArchiveError> {
        self.0
            .lock()
            .unwrap()
            .insert(archive_id.to_string(), *key.as_bytes());
        Ok(())
    }

    fn delete(&self, archive_id: &str) -> Result<(), ArchiveError> {
        self.0.lock().unwrap().remove(archive_id);
        Ok(())
    }
}

/// One installation of the app: its own data directory, cache and archive settings.
struct Device {
    _data: tempfile::TempDir,
    archive: HistoryArchiveState,
    keys: Arc<MemoryKeys>,
    /// Owns the cache database `store` points into.
    _cache: MessageCacheState,
    store: Arc<Mutex<CacheStore>>,
}

impl Device {
    fn new(user: &str) -> Self {
        let data = tempfile::tempdir().unwrap();
        let keys = Arc::new(MemoryKeys::default());
        let archive =
            HistoryArchiveState::new(data.path().join("history-archive"), keys.clone(), TEST_COST);
        let cache = cache_state(&data.path().join("message-cache"), 1);
        let store = open(&cache, user);
        Self {
            _data: data,
            archive,
            keys,
            _cache: cache,
            store,
        }
    }

    fn connect(&self, folder: &Path) -> bool {
        self.archive
            .connect(&account("alice"), folder.to_str().unwrap(), PASSPHRASE)
            .unwrap()
            .created
    }

    fn export(&self) -> super::ExportReport {
        self.archive.export(&self.store, &account("alice")).unwrap()
    }

    fn restore(&self) -> super::RestoreReport {
        self.archive
            .restore(&self.store, &account("alice"))
            .unwrap()
    }

    fn sync(&self, feed: &mut MockFeed) {
        sync(&mut self.store.lock().unwrap(), feed, None);
    }

    fn track(&self, conversation: &str) {
        self.store
            .lock()
            .unwrap()
            .track(WS, conversation, 1)
            .unwrap();
    }

    fn timeline(&self, conversation: &str) -> Option<Vec<String>> {
        self.store
            .lock()
            .unwrap()
            .timeline(WS, conversation, None, 200)
            .unwrap()
            .map(|page| texts(&page))
    }

    fn ids(&self, conversation: &str) -> Vec<String> {
        cached_ids(&self.store.lock().unwrap(), conversation)
    }

    fn device_id(&self) -> String {
        self.archive.device_id().unwrap()
    }
}

/// Every file under `dir`, relative, `/`-separated, with its bytes.
fn files(dir: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, out);
            } else {
                let rel = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((rel, std::fs::read(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out.sort();
    out
}

fn names(dir: &Path) -> Vec<String> {
    files(dir).into_iter().map(|(name, _)| name).collect()
}

fn message(conversation: &str, id: &str, version: i64, text: &str) -> ArchivedMessage {
    ArchivedMessage {
        workspace_id: WS.into(),
        conversation_id: conversation.into(),
        id: id.into(),
        thread_id: None,
        author_id: "user-1".into(),
        version,
        sent_at_us: version,
        edited_at: None,
        deleted: false,
        text: Some(text.into()),
        payload: json!({ "id": id, "sentAt": "2026-10-08T10:00:00Z" }),
        sig: None,
    }
}

fn provider(folder: &Path) -> Box<dyn ArchiveProvider> {
    Box::new(LocalFolderProvider::new(folder).unwrap())
}

// ─── Format ─────────────────────────────────────────────────────────────────

#[test]
fn format_round_trips_and_holds_no_plaintext() {
    let folder = tempfile::tempdir().unwrap();
    let archive = Archive::create(
        provider(folder.path()),
        PASSPHRASE,
        TEST_COST,
        chrono::Utc::now(),
    )
    .unwrap();
    let events = vec![
        Event::Message(message("chan-quokka", "m1", 1, "zanzibarquokka at noon")),
        Event::Message(ArchivedMessage {
            deleted: true,
            text: None,
            ..message("chan-quokka", "m2", 2, "")
        }),
        Event::Conversation(format::ArchivedConversation {
            workspace_id: WS.into(),
            conversation_id: "chan-quokka".into(),
            cursor: Some("2".into()),
            complete: true,
            last_viewed_at: 7,
            reset_at: None,
            max_version: 2,
        }),
    ];
    let device = "0f0e0d0c-aaaa-4bbb-8ccc-123456789abc";
    let account = archive.account("http://localhost:8080/api\nalice");
    assert_eq!(account.append(device, &events, 1_000).unwrap(), 1);

    // A second device opens the archive with nothing but the folder and the passphrase.
    let reader = Archive::unlock(provider(folder.path()), PASSPHRASE).unwrap();
    assert_eq!(reader.id(), archive.id());
    let contents = reader
        .account("http://localhost:8080/api\nalice")
        .read_all()
        .unwrap();
    assert_eq!(contents.devices, 1);
    assert_eq!(contents.segments.len(), 1);
    assert_eq!(contents.segments[0].events, events);
    assert_eq!(contents.segments[0].created_at_ms, 1_000);
    assert!(contents.missing.is_empty() && contents.damaged.is_empty());

    // Another account sees nothing of it.
    assert!(reader
        .account("http://localhost:8080/api\nbob")
        .read_all()
        .unwrap()
        .segments
        .is_empty());

    // The manifest is plain JSON naming the format; nothing else is readable.
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(folder.path().join("rim-archive.json")).unwrap())
            .unwrap();
    assert_eq!(manifest["format"], "rim-history-archive");
    assert_eq!(manifest["version"], 1);
    assert_eq!(manifest["keyWraps"][0]["kind"], "passphrase");
    assert_eq!(manifest["keyWraps"][0]["kdf"]["algorithm"], "argon2id");
    for (name, bytes) in files(folder.path()) {
        let text = String::from_utf8_lossy(&bytes);
        for needle in ["zanzibarquokka", "alice", "localhost", "chan-quokka", WS] {
            assert!(!text.contains(needle), "{needle} readable in {name}");
            assert!(!name.contains(needle), "{needle} in the file name {name}");
        }
    }
}

#[test]
fn a_wrong_passphrase_is_refused_and_a_short_one_never_set() {
    let folder = tempfile::tempdir().unwrap();
    assert!(matches!(
        Archive::create(
            provider(folder.path()),
            "too short",
            TEST_COST,
            chrono::Utc::now()
        ),
        Err(ArchiveError::Invalid(_))
    ));
    Archive::create(
        provider(folder.path()),
        PASSPHRASE,
        TEST_COST,
        chrono::Utc::now(),
    )
    .unwrap();
    assert!(matches!(
        Archive::unlock(provider(folder.path()), "correct horse battery stapler"),
        Err(ArchiveError::WrongPassphrase)
    ));
    // A folder already holding an archive never gets a second one.
    assert!(matches!(
        Archive::create(
            provider(folder.path()),
            PASSPHRASE,
            TEST_COST,
            chrono::Utc::now()
        ),
        Err(ArchiveError::Exists)
    ));
}

#[test]
fn tampered_or_moved_files_are_reported_not_trusted() {
    let folder = tempfile::tempdir().unwrap();
    let archive = Archive::create(
        provider(folder.path()),
        PASSPHRASE,
        TEST_COST,
        chrono::Utc::now(),
    )
    .unwrap();
    let account = archive.account("acct");
    let a = "aaaaaaaa-0000-4000-8000-000000000001";
    account
        .append(a, &[Event::Message(message("c1", "m1", 1, "one"))], 1)
        .unwrap();
    account
        .append(a, &[Event::Message(message("c1", "m2", 2, "two"))], 2)
        .unwrap();

    let tag = archive.key().account_tag("acct");
    let seg1 = folder.path().join(
        format::file_path(&tag, a, &format::segment_name(1))
            .replace('/', std::path::MAIN_SEPARATOR_STR),
    );
    let mut bytes = std::fs::read(&seg1).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    std::fs::write(&seg1, bytes).unwrap();

    let contents = account.read_all().unwrap();
    assert_eq!(contents.segments.len(), 1);
    assert_eq!(contents.damaged.len(), 1);
    assert_eq!(contents.damaged[0].seq, 1);

    // A sealed file is bound to its place: one device's segment does not open as another's,
    // nor under another sequence number.
    let seg2 = std::fs::read(
        folder.path().join(
            format::file_path(&tag, a, &format::segment_name(2))
                .replace('/', std::path::MAIN_SEPARATOR_STR),
        ),
    )
    .unwrap();
    let place = |device, name| FilePlace {
        archive_id: archive.id(),
        account_tag: &tag,
        device_id: device,
        name,
    };
    let seg2_name = format::segment_name(2);
    let seg3_name = format::segment_name(3);
    assert!(format::open_file(
        archive.key(),
        FileKind::Segment,
        &place(a, &seg2_name),
        &seg2
    )
    .is_ok());
    assert!(matches!(
        format::open_file(
            archive.key(),
            FileKind::Segment,
            &place("bbbbbbbb-0000-4000-8000-000000000002", &seg2_name),
            &seg2
        ),
        Err(ArchiveError::Unauthentic)
    ));
    assert!(format::open_file(
        archive.key(),
        FileKind::Segment,
        &place(a, &seg3_name),
        &seg2
    )
    .is_err());
    assert!(
        format::open_file(archive.key(), FileKind::Head, &place(a, &seg2_name), &seg2).is_err()
    );
}

#[test]
fn segments_split_at_the_size_limit_and_readers_skip_unknown_events() {
    let folder = tempfile::tempdir().unwrap();
    let archive = Archive::create(
        provider(folder.path()),
        PASSPHRASE,
        TEST_COST,
        chrono::Utc::now(),
    )
    .unwrap();
    let account = archive.account("acct");
    let device = "aaaaaaaa-0000-4000-8000-000000000001";
    let events: Vec<Event> = (0..10)
        .map(|i| Event::Message(message("c1", &format!("m{i}"), i, &"x".repeat(100))))
        .collect();
    assert_eq!(
        account.append_limited(device, &events, 5, 1_000).unwrap(),
        4
    );
    let contents = account.read_all().unwrap();
    let read: Vec<Event> = contents
        .segments
        .into_iter()
        .flat_map(|s| s.events)
        .collect();
    assert_eq!(read, events);

    // A newer build's event type in a version 1 segment is skipped, not an error.
    let header = format::header_line(&format::SegmentHeader {
        v: 1,
        archive_id: "x".repeat(8),
        device_id: device.into(),
        seq: 1,
        created_at_ms: 0,
    })
    .unwrap();
    let line = format::event_line(&events[0]).unwrap();
    let text = format!("{header}\n{{\"t\":\"reaction\",\"id\":\"r1\"}}\n{line}\n");
    let (_, parsed) = format::parse_segment(text.as_bytes()).unwrap();
    assert_eq!(parsed, vec![events[0].clone()]);
}

#[test]
fn a_newer_archive_version_is_refused() {
    let folder = tempfile::tempdir().unwrap();
    Archive::create(
        provider(folder.path()),
        PASSPHRASE,
        TEST_COST,
        chrono::Utc::now(),
    )
    .unwrap();
    let path = folder.path().join("rim-archive.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    manifest["version"] = json!(2);
    std::fs::write(&path, manifest.to_string()).unwrap();
    let err = Archive::unlock(provider(folder.path()), PASSPHRASE)
        .err()
        .unwrap();
    assert!(err.to_string().contains("newer"), "{err}");
}

// ─── Export ─────────────────────────────────────────────────────────────────

#[test]
fn export_is_incremental_and_never_rewrites_a_segment() {
    let folder = tempfile::tempdir().unwrap();
    let device = Device::new("alice");
    assert!(device.connect(folder.path()));
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 5);
    device.track("c1");
    device.sync(&mut feed);

    let first = device.export();
    assert_eq!(first.messages, 5);
    assert_eq!(first.conversations, 1);
    assert_eq!(first.segments, 1);
    let after_first = files(folder.path());

    // Nothing changed: nothing written.
    assert_eq!(device.export(), super::ExportReport::default());
    assert_eq!(files(folder.path()), after_first);

    // One new message and one edit: only those, in a new segment.
    feed.send("c1", "c1-new", "brand new", None);
    feed.edit("c1", "c1-m000", "hello 0, edited");
    device.sync(&mut feed);
    let second = device.export();
    assert_eq!(second.messages, 2);
    assert_eq!(second.conversations, 1);
    assert_eq!(second.segments, 1);

    // Segment 1 is byte for byte what it was; only the head and segment 2 are new.
    let after_second = files(folder.path());
    for (name, bytes) in &after_first {
        if name.ends_with("seg-0000000001.rimx") || name.ends_with("rim-archive.json") {
            assert!(
                after_second.contains(&(name.clone(), bytes.clone())),
                "{name} changed"
            );
        }
    }
    assert!(after_second
        .iter()
        .any(|(n, _)| n.ends_with("seg-0000000002.rimx")));
}

#[test]
fn a_large_export_is_written_in_batches_with_the_state_last() {
    let folder = tempfile::tempdir().unwrap();
    let device = Device::new("alice");
    device.connect(folder.path());
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 25);
    device.track("c1");
    device.sync(&mut feed);

    let report = device
        .archive
        .export_batched(&device.store, &account("alice"), 10)
        .unwrap();
    assert_eq!(report.messages, 25);
    assert_eq!(report.conversations, 1);
    assert_eq!(report.segments, 3);

    // The conversation's state is in the last segment, after every message it covers.
    let archive = device.archive.open_archive(&account("alice")).unwrap();
    let contents = archive
        .account(&account("alice").label())
        .read_all()
        .unwrap();
    let kinds: Vec<Vec<bool>> = contents
        .segments
        .iter()
        .map(|s| {
            s.events
                .iter()
                .map(|e| matches!(e, Event::Conversation(_)))
                .collect()
        })
        .collect();
    assert!(kinds[0].iter().chain(&kinds[1]).all(|is_state| !is_state));
    assert_eq!(kinds[2].last(), Some(&true));
}

#[test]
fn export_needs_the_folder_and_the_key() {
    let folder = tempfile::tempdir().unwrap();
    let device = Device::new("alice");
    assert!(matches!(
        device.archive.export(&device.store, &account("alice")),
        Err(ArchiveError::NotConfigured)
    ));
    device.connect(folder.path());

    // The keyring lost the key: locked until the passphrase is entered again.
    device.keys.0.lock().unwrap().clear();
    assert!(!device.archive.status(&account("alice")).unwrap().unlocked);
    assert!(matches!(
        device.archive.export(&device.store, &account("alice")),
        Err(ArchiveError::Locked)
    ));
    assert!(matches!(
        device
            .archive
            .unlock(&account("alice"), "not the passphrase at all"),
        Err(ArchiveError::WrongPassphrase)
    ));
    assert!(
        device
            .archive
            .unlock(&account("alice"), PASSPHRASE)
            .unwrap()
            .unlocked
    );

    // The folder is gone (a drive unplugged): nothing is written anywhere else.
    let path = folder.path().to_path_buf();
    drop(folder);
    assert!(matches!(
        device.archive.export(&device.store, &account("alice")),
        Err(ArchiveError::Unavailable(_))
    ));
    assert!(!path.exists());

    // Disconnecting forgets the settings and the key, not the archive.
    device.archive.disconnect(&account("alice")).unwrap();
    assert!(!device.archive.status(&account("alice")).unwrap().configured);
}

#[test]
fn a_folder_holding_another_archive_gets_no_writes() {
    let folder = tempfile::tempdir().unwrap();
    let device = Device::new("alice");
    device.connect(folder.path());
    // Someone replaces the folder's archive with a new one.
    std::fs::remove_file(folder.path().join("rim-archive.json")).unwrap();
    Archive::create(
        provider(folder.path()),
        PASSPHRASE,
        TEST_COST,
        chrono::Utc::now(),
    )
    .unwrap();
    assert!(matches!(
        device.archive.export(&device.store, &account("alice")),
        Err(ArchiveError::Mismatch)
    ));
}

// ─── Two devices, one folder ────────────────────────────────────────────────

#[test]
fn two_devices_share_a_folder_without_touching_each_others_files() {
    let folder = tempfile::tempdir().unwrap();
    let laptop = Device::new("alice");
    let desktop = Device::new("alice");
    assert_ne!(laptop.device_id(), desktop.device_id());
    assert!(laptop.connect(folder.path()));
    // The second device joins the same archive with the same passphrase.
    assert!(!desktop.connect(folder.path()));
    assert_eq!(
        laptop.archive.status(&account("alice")).unwrap().archive_id,
        desktop
            .archive
            .status(&account("alice"))
            .unwrap()
            .archive_id
    );

    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 3);
    feed.send_many("c2", 2);
    laptop.track("c1");
    laptop.sync(&mut feed);
    desktop.track("c2");
    desktop.sync(&mut feed);

    laptop.export();
    let laptop_files = files(folder.path());
    desktop.export();
    let both = files(folder.path());

    // The desktop added files only under its own device folder and changed none of the
    // laptop's.
    for (name, bytes) in &laptop_files {
        assert!(
            both.contains(&(name.clone(), bytes.clone())),
            "{name} changed"
        );
    }
    let desktop_id = desktop.device_id();
    for (name, _) in &both {
        if !laptop_files.iter().any(|(n, _)| n == name) {
            assert!(
                name.contains(&desktop_id),
                "{name} written outside the desktop's folder"
            );
        }
    }
    let heads = names(folder.path())
        .into_iter()
        .filter(|n| n.ends_with("head.rimx"))
        .count();
    assert_eq!(heads, 2);

    // Each device writes on; the other's files stay as they were.
    feed.send("c1", "c1-late", "late", None);
    laptop.sync(&mut feed);
    let before = files(folder.path());
    laptop.export();
    let after = files(folder.path());
    for (name, bytes) in &before {
        if name.contains(&desktop_id) {
            assert!(
                after.contains(&(name.clone(), bytes.clone())),
                "{name} changed"
            );
        }
    }

    // A third device restores both devices' history.
    let phone = Device::new("alice");
    assert!(!phone.connect(folder.path()));
    let report = phone.restore();
    assert_eq!(report.devices, 2);
    assert_eq!(report.messages, 6);
    assert_eq!(report.conversations, 2);
    assert_eq!(phone.ids("c1").len(), 4);
    assert_eq!(phone.ids("c2").len(), 2);
}

// ─── Restore ────────────────────────────────────────────────────────────────

#[test]
fn a_new_device_shows_its_history_before_asking_the_server_then_syncs_only_what_is_new() {
    let folder = tempfile::tempdir().unwrap();
    let old = Device::new("alice");
    old.connect(folder.path());
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 30);
    feed.delete("c1", "c1-m001");
    feed.edit("c1", "c1-m002", "hello 2, edited");
    old.track("c1");
    old.sync(&mut feed);
    old.export();
    let expected = old.timeline("c1").unwrap();

    // While the old device is away, the conversation moves on.
    feed.send("c1", "c1-after", "after the backup", None);
    feed.edit("c1", "c1-m003", "hello 3, edited later");

    let new = Device::new("alice");
    assert_eq!(new.timeline("c1"), None);
    new.connect(folder.path());
    let report = new.restore();
    assert_eq!(report.segments_read, 1);
    assert_eq!(report.messages, 30);
    assert_eq!(report.conversations, 1);

    // The archive alone shows the history, deleted message gone, edit in place.
    assert_eq!(new.timeline("c1").unwrap(), expected);
    assert!(!expected.contains(&"hello 1".to_string()));
    assert!(expected.contains(&"hello 2, edited".to_string()));

    // The first sync starts from the archive's cursor: one request, only the two changes.
    let requests = feed.requests;
    new.sync(&mut feed);
    assert_eq!(feed.requests, requests + 1);
    let synced = new.timeline("c1").unwrap();
    assert_eq!(synced.last().unwrap(), "after the backup");
    assert!(synced.contains(&"hello 3, edited later".to_string()));
    assert!(!synced.contains(&"hello 3".to_string()));

    // A restored device does not archive the restored history again, only what it synced.
    let exported = new.export();
    assert_eq!(exported.messages, 2);
}

#[test]
fn the_higher_version_wins_between_the_archive_and_the_cache() {
    let folder = tempfile::tempdir().unwrap();
    let writer = Device::new("alice");
    writer.connect(folder.path());
    let mut feed = MockFeed::new(1000);
    feed.send("c1", "m1", "one", None);
    feed.send("c1", "m2", "two", None);
    writer.track("c1");
    writer.sync(&mut feed);
    feed.edit("c1", "m1", "one, edited");
    writer.sync(&mut feed);
    writer.export();

    // A device whose cache has m1 at an older version and m2 at the same version.
    let reader = Device::new("alice");
    let mut stale = MockFeed::new(1000);
    stale.send("c1", "m1", "one", None);
    stale.send(
        "c1",
        "m2",
        "two, a different copy at the same version",
        None,
    );
    reader.track("c1");
    reader.sync(&mut stale);

    reader.connect(folder.path());
    let report = reader.restore();
    assert_eq!(report.messages, 1, "only m1 was older in the cache");
    assert_eq!(report.conversations, 0, "the cache already followed c1");
    assert_eq!(
        reader.timeline("c1").unwrap(),
        vec!["one, edited", "two, a different copy at the same version"]
    );
}

#[test]
fn a_device_with_missing_segments_restores_its_messages_but_not_its_cursor() {
    let folder = tempfile::tempdir().unwrap();
    let old = Device::new("alice");
    old.connect(folder.path());
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 3);
    old.track("c1");
    old.sync(&mut feed);
    old.export();
    feed.send("c1", "c1-more", "more", None);
    old.sync(&mut feed);
    old.export();

    // The sync client has delivered the head and segment 2, not segment 1 yet.
    let seg1 = files(folder.path())
        .into_iter()
        .find(|(n, _)| n.ends_with("seg-0000000001.rimx"))
        .unwrap()
        .0;
    std::fs::remove_file(folder.path().join(&seg1)).unwrap();

    let new = Device::new("alice");
    new.connect(folder.path());
    let report = new.restore();
    assert_eq!(report.segments_missing, 1);
    assert_eq!(new.ids("c1"), vec!["c1-more"]);
    // Not trusted as complete: the timeline waits for the server.
    assert_eq!(new.timeline("c1"), None);
    new.sync(&mut feed);
    assert_eq!(new.timeline("c1").unwrap().len(), 4);
}

#[test]
fn a_server_reset_makes_older_archived_copies_stale() {
    let folder = tempfile::tempdir().unwrap();
    let device = Device::new("alice");
    device.connect(folder.path());
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 4);
    feed.edit(
        "c1",
        "c1-m000",
        "edited before the server's backup was restored",
    );
    device.track("c1");
    device.sync(&mut feed);
    device.export();
    std::thread::sleep(std::time::Duration::from_millis(5));

    // The server is restored from a backup: c1-m003 never existed and versions start over.
    // The new edit has a lower version than the archived one, which must not win.
    feed.restore_backup_without("c1", "c1-m003");
    feed.edit("c1", "c1-m000", "edited after the restore");
    device.sync(&mut feed);
    std::thread::sleep(std::time::Duration::from_millis(5));
    device.export();

    let new = Device::new("alice");
    new.connect(folder.path());
    new.restore();
    let restored = new.timeline("c1").unwrap();
    assert_eq!(restored, device.timeline("c1").unwrap());
    assert_eq!(
        restored,
        vec!["edited after the restore", "hello 1", "hello 2"]
    );
}

#[test]
fn restore_is_idempotent() {
    let folder = tempfile::tempdir().unwrap();
    let old = Device::new("alice");
    old.connect(folder.path());
    let mut feed = MockFeed::new(1000);
    feed.send_many("c1", 3);
    old.track("c1");
    old.sync(&mut feed);
    old.export();

    let new = Device::new("alice");
    new.connect(folder.path());
    assert_eq!(new.restore().messages, 3);
    let again = new.restore();
    assert_eq!(again.messages, 0);
    assert_eq!(again.conversations, 0);
    assert_eq!(new.timeline("c1").unwrap().len(), 3);
}

#[test]
fn folders_are_per_account_and_device_ids_are_per_installation() {
    let device = Device::new("alice");
    let id = device.device_id();
    assert_eq!(device.device_id(), id);
    format::check_id(&id).unwrap();
    let path: PathBuf = device
        ._data
        .path()
        .join("history-archive")
        .join("device-id");
    assert_eq!(std::fs::read_to_string(path).unwrap(), id);
}
