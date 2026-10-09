//! The e2ee module against `rim_mls` and real cache databases: devices with real key logs and
//! device certificates, and a small in-process server that sequences Commits, numbers feed
//! versions and refuses stale epochs as rim-server does.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use rim_mls::{DeviceRef, Mls, SignedStatement};
use rusqlite::{params, Transaction};
use serde_json::{json, Value};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::directory::{self, DirectoryInput, PrincipalDeviceInput, PrincipalInput, ReaddInput};
use super::feed::{ConversationInput, Decryptor, StopReason, SyncNote};
use super::group::{self, ClaimedInput, CommitInput, DeviceView, OutgoingCommitView};
use super::identity;
use super::outgoing::{self, DraftInput, OutgoingView};
use super::{b64, Result};
use crate::key_identity::statement::{self, DeviceCertInput, SecretKey, Statement};
use crate::message_cache::feed::{
    ChangesRequest, ChangesStatus, ConversationChanges, MessageChange,
};
use crate::message_cache::store::CacheStore;
use crate::message_cache::tests::{account, state, WS};

const CONV: &str = "0199d1a0-0000-7000-8000-000000000001";
const AT: &str = "2026-10-09T00:00:00Z";

/// An account: its identity key, key log and devices' certificates.
struct Principal {
    id: String,
    identity: SecretKey,
    log: Vec<Statement>,
    devices: Vec<PrincipalDeviceInput>,
}

impl Principal {
    fn new(seed: u8) -> Self {
        let identity = SecretKey::from_seed(Zeroizing::new([seed; 32]));
        let recovery = SecretKey::from_seed(Zeroizing::new([seed.wrapping_add(100); 32]));
        let inception = statement::inception(&identity, &recovery.public_key(), AT);
        Self {
            id: statement::principal_id(&inception.payload),
            identity,
            log: vec![inception],
            devices: vec![],
        }
    }

    fn certify(&mut self, device_id: &str, device_key: &str) {
        let certificate = statement::device_cert(
            &self.identity,
            &DeviceCertInput {
                principal_id: &self.id,
                device_id,
                device_key,
                name: "Laptop",
                key_seq: 0,
                issued_at: AT,
            },
        );
        self.devices.push(PrincipalDeviceInput {
            device_id: device_id.to_string(),
            certificate,
            revoked_at: None,
            revocation: None,
        });
    }

    fn input(&self) -> PrincipalInput {
        PrincipalInput {
            principal_id: self.id.clone(),
            key_log: self.log.clone(),
            devices: self.devices.clone(),
        }
    }
}

/// One desktop: its cache database, MLS engine and device key.
struct Device {
    user_id: String,
    device: DeviceRef,
    key: SecretKey,
    store: Arc<Mutex<CacheStore>>,
    mls: Mls,
    _dir: tempfile::TempDir,
}

impl Device {
    fn new(principal: &mut Principal, user: &str, n: u128) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let cache = state(dir.path(), 7);
        let store = cache.store(&account(user)).unwrap();
        let key = SecretKey::from_seed(Zeroizing::new([n as u8 + 40; 32]));
        let device = DeviceRef {
            principal_id: principal.id.clone(),
            device_id: Uuid::from_u128(n),
        };
        principal.certify(
            &device.device_id.hyphenated().to_string(),
            &key.public_key(),
        );
        let this = Self {
            user_id: user.to_string(),
            device,
            key,
            store,
            mls: Mls::new().unwrap(),
            _dir: dir,
        };
        this.run(|tx, mls| {
            identity::ensure_identity(tx, mls, &this.device, &this.key.public_key(), |c, p| {
                let s = this.key.sign(c, p);
                SignedStatement {
                    payload: s.payload,
                    signature: s.signature,
                }
            })
        });
        this
    }

    fn device_id(&self) -> String {
        self.device.device_id.hyphenated().to_string()
    }

    fn view(&self) -> DeviceView {
        DeviceView::from_ref(&self.device)
    }

    /// Run `f` in one committed transaction.
    fn run<T>(&self, f: impl FnOnce(&Transaction<'_>, &Mls) -> Result<T>) -> T {
        self.try_run(f).unwrap()
    }

    fn try_run<T>(&self, f: impl FnOnce(&Transaction<'_>, &Mls) -> Result<T>) -> Result<T> {
        let mut store = self.store.lock().unwrap();
        let tx = store.conn.transaction().unwrap();
        let out = f(&tx, &self.mls)?;
        tx.commit().unwrap();
        Ok(out)
    }

    fn key_package(&self) -> ClaimedInput {
        let packages = self.run(|tx, mls| {
            Ok(mls.generate_key_packages(&rim_mls::SqliteStore::new(tx), 1, false, now())?)
        });
        ClaimedInput {
            principal_id: self.device.principal_id.clone(),
            device_id: self.device_id(),
            key_package: b64(&packages[0].message),
        }
    }

    fn send(&self, body: &str) -> OutgoingView {
        self.run(|tx, mls| {
            outgoing::encrypt(tx, mls, WS, CONV, &draft(&self.user_id, body), &mut |_| {
                None
            })
        })
    }

    /// Sync the conversation from the server, handing in its Commits.
    fn sync(&self, server: &Server) -> Vec<SyncNote> {
        self.sync_with(server, server.input(&self.device_id()))
    }

    fn sync_with(&self, server: &Server, input: ConversationInput) -> Vec<SyncNote> {
        let mut store = self.store.lock().unwrap();
        store.track(WS, CONV, 1).unwrap();
        let mut request = store.begin_sync(WS, Some(&[CONV.to_string()])).unwrap();
        let mut notes = Vec::new();
        while let Some(r) = request {
            let mut decryptor = Decryptor::new(&self.mls, vec![input.clone()]);
            request = store
                .apply_changes_with(WS, server.respond(&r), &mut decryptor)
                .unwrap();
            notes.extend(decryptor.into_notes());
        }
        notes
    }

    fn rows(&self) -> Vec<(String, Option<String>, Option<String>, i64)> {
        let store = self.store.lock().unwrap();
        let mut stmt = store
            .conn
            .prepare("SELECT id, text, e2ee_state, version FROM message ORDER BY sent_at_us, id")
            .unwrap();
        stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap()
    }

    fn row(&self, id: &str) -> (Option<String>, Option<String>, Value) {
        let store = self.store.lock().unwrap();
        store
            .conn
            .query_row(
                "SELECT text, e2ee_state, payload FROM message WHERE id = ?1",
                params![id],
                |row| {
                    let payload: String = row.get(2)?;
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        serde_json::from_str(&payload).unwrap(),
                    ))
                },
            )
            .unwrap()
    }
}

fn now() -> u64 {
    chrono::Utc::now().timestamp() as u64
}

fn draft(user: &str, body: &str) -> DraftInput {
    serde_json::from_value(json!({
        "body": body,
        "authorId": user,
        "author": { "id": user, "username": user, "displayName": null, "avatarUrl": null },
    }))
    .unwrap()
}

/// The server's side of one conversation.
#[derive(Default)]
struct Server {
    incarnation: u32,
    epoch: u64,
    commits: Vec<CommitInput>,
    counter: i64,
    messages: BTreeMap<String, (i64, Value)>,
    welcomes: Vec<(String, u32, String)>,
    group_devices: Vec<String>,
    principals: BTreeMap<String, String>,
}

impl Server {
    fn new() -> Self {
        Self::default()
    }

    fn member(&mut self, device: &Device) {
        self.principals
            .insert(device.user_id.clone(), device.device.principal_id.clone());
    }

    /// `submitMlsCommit`: one Commit per epoch; the loser is stale.
    fn submit(&mut self, commit: &OutgoingCommitView) -> bool {
        let first = commit.epoch == 0 && commit.incarnation == self.incarnation + 1;
        if !first && (commit.incarnation != self.incarnation || commit.epoch != self.epoch) {
            return false;
        }
        if first {
            self.incarnation = commit.incarnation;
            self.epoch = 0;
        }
        self.commits.push(CommitInput {
            incarnation: commit.incarnation,
            epoch: commit.epoch,
            message: commit.commit.clone(),
        });
        self.epoch += 1;
        for removed in &commit.removes {
            self.group_devices.retain(|d| *d != removed.device_id);
        }
        for added in &commit.adds {
            self.group_devices.push(added.device_id.clone());
            if let Some(welcome) = &commit.welcome {
                self.welcomes
                    .push((added.device_id.clone(), commit.incarnation, welcome.clone()));
            }
        }
        true
    }

    fn welcome_for(&self, device: &Device) -> (u32, String) {
        let (_, incarnation, welcome) = self
            .welcomes
            .iter()
            .rev()
            .find(|(d, _, _)| *d == device.device_id())
            .unwrap();
        (*incarnation, welcome.clone())
    }

    /// `sendEncryptedMessage` / `editEncryptedMessage`: only in the current epoch.
    fn deliver(&mut self, from: &Device, out: &OutgoingView, thread_id: Option<&str>) -> bool {
        if out.incarnation != self.incarnation || out.epoch != self.epoch {
            return false;
        }
        self.counter += 1;
        let sent_at = match self.messages.get(&out.message_id) {
            Some((_, m)) => m["sentAt"].as_str().unwrap().to_string(),
            None => format!("2026-10-09T10:00:{:02}.000001Z", self.counter),
        };
        let message = json!({
            "id": out.message_id,
            "serverId": WS,
            "conversationId": CONV,
            "threadId": thread_id,
            "rootThreadId": null,
            "authorId": from.user_id,
            "author": {
                "id": from.user_id, "username": from.user_id, "displayName": null,
                "avatarUrl": null, "principalId": from.device.principal_id,
            },
            "text": null,
            "hasAttachments": false,
            "parentMessageId": null,
            "isPinned": false,
            "isDeleted": false,
            "mentionedUserIds": [],
            "forwardedFromMessageId": null,
            "forwardedFrom": null,
            "sentAt": sent_at,
            "reactions": [],
            "attachments": [],
            "linkPreviews": [],
            "encryption": {
                "incarnation": out.incarnation,
                "epoch": out.epoch,
                "senderDeviceId": from.device_id(),
                "ciphertext": out.envelope,
                "frankingReceipt": b64(&[9; 32]),
                "frankingKeyId": 1,
                "sentAtUs": "1791540000000001",
            },
        });
        self.messages
            .insert(out.message_id.clone(), (self.counter, message));
        true
    }

    /// A plaintext message from before the conversation was encrypted.
    fn plaintext(&mut self, id: &str, text: &str) {
        self.counter += 1;
        let message = json!({
            "id": id, "serverId": WS, "conversationId": CONV, "threadId": null,
            "authorId": "u-a", "author": null, "text": text, "isDeleted": false,
            "sentAt": format!("2026-10-09T09:00:{:02}Z", self.counter), "reactions": [],
            "attachments": [], "linkPreviews": [], "encryption": null,
        });
        self.messages
            .insert(id.to_string(), (self.counter, message));
    }

    fn delete(&mut self, id: &str) {
        self.counter += 1;
        let (version, message) = self.messages.get_mut(id).unwrap();
        *version = self.counter;
        message["isDeleted"] = json!(true);
        message["encryption"]["ciphertext"] = Value::Null;
    }

    /// Move a ciphertext to another row, as a misbehaving server might.
    fn forge_copy(&mut self, from: &str, to: &str) {
        self.counter += 1;
        let mut message = self.messages[from].1.clone();
        message["id"] = json!(to);
        self.messages
            .insert(to.to_string(), (self.counter, message));
    }

    fn respond(&self, request: &ChangesRequest) -> Vec<ConversationChanges> {
        request
            .conversations
            .iter()
            .map(|c| {
                let after: i64 = c.after.as_deref().unwrap_or("0").parse().unwrap();
                let mut changes: Vec<&(i64, Value)> =
                    self.messages.values().filter(|(v, _)| *v > after).collect();
                changes.sort_by_key(|(v, _)| *v);
                ConversationChanges {
                    conversation_id: c.conversation_id.clone(),
                    status: ChangesStatus::Ok,
                    cursor: changes
                        .last()
                        .map(|(v, _)| v.to_string())
                        .unwrap_or_else(|| after.to_string()),
                    has_more: false,
                    changes: changes
                        .into_iter()
                        .map(|(v, m)| MessageChange {
                            version: v.to_string(),
                            edited_at: None,
                            message: m.clone(),
                        })
                        .collect(),
                }
            })
            .collect()
    }

    fn input(&self, device_id: &str) -> ConversationInput {
        ConversationInput {
            conversation_id: CONV.to_string(),
            server_incarnation: Some(self.incarnation),
            in_group: Some(self.group_devices.iter().any(|d| d == device_id)),
            commits: self.commits.clone(),
            thread_roots: Default::default(),
        }
    }
}

/// Alice creates the group with Bob's device; Bob joins from the Welcome.
fn alice_and_bob() -> (Principal, Principal, Device, Device, Server) {
    let mut pa = Principal::new(1);
    let mut pb = Principal::new(2);
    let alice = Device::new(&mut pa, "u-a", 1);
    let bob = Device::new(&mut pb, "u-b", 2);
    let mut server = Server::new();
    server.member(&alice);
    server.member(&bob);
    server.group_devices.push(alice.device_id());
    let claimed = bob.key_package();
    let commit = alice.run(|tx, mls| group::create(tx, mls, WS, CONV, 1, &[claimed]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, Some(&alice.device), WS, CONV, true));
    let (incarnation, welcome) = server.welcome_for(&bob);
    bob.run(|tx, mls| group::join(tx, mls, WS, CONV, incarnation, &welcome));
    (pa, pb, alice, bob, server)
}

fn send(server: &mut Server, from: &Device, body: &str) -> String {
    let out = from.send(body);
    assert!(server.deliver(from, &out, None));
    from.run(|tx, _| outgoing::settle(tx, &out.message_id, Some(&json!({}))));
    out.message_id
}

#[test]
fn a_message_decrypts_once_into_its_plaintext_row() {
    let (_pa, _pb, alice, bob, mut server) = alice_and_bob();
    let first = send(&mut server, &alice, "hello bob");
    let second = send(&mut server, &alice, "second");

    let notes = bob.sync(&server);
    let rows = bob.rows();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, first);
    assert_eq!(rows[0].1.as_deref(), Some("hello bob"));
    assert_eq!(rows[0].2.as_deref(), Some("decrypted"));
    assert_eq!(rows[1].0, second);
    assert_eq!(rows[1].1.as_deref(), Some("second"));
    assert_eq!(notes[0].decrypted.len(), 2);

    // The payload keeps what a report and the archive need, never the envelope.
    let (_, _, payload) = bob.row(&first);
    assert!(payload.get("encryption").is_none());
    let e2ee = &payload["e2ee"];
    assert_eq!(e2ee["incarnation"], 1);
    assert_eq!(e2ee["epoch"], 1);
    assert_eq!(e2ee["senderDeviceId"], json!(alice.device_id()));
    assert_eq!(e2ee["receiptKeyId"], 1);
    assert_eq!(e2ee["sentAtUs"], "1791540000000001");
    assert_eq!(e2ee["frankingKey"].as_str().unwrap().len(), 43);
    assert!(e2ee["content"]
        .as_str()
        .unwrap()
        .contains("\"body\":\"hello bob\""));

    // The same entries again (a reset cursor, a repeated page) are not decrypted twice.
    {
        let store = bob.store.lock().unwrap();
        store
            .conn
            .execute("UPDATE conversation_sync SET cursor = NULL", [])
            .unwrap();
    }
    let notes = bob.sync(&server);
    assert!(notes.iter().all(|n| n.decrypted.is_empty()));
    assert_eq!(bob.rows(), rows);
}

#[test]
fn the_sender_keeps_its_plaintext_and_takes_the_servers_version() {
    let (_pa, _pb, alice, _bob, mut server) = alice_and_bob();
    let out = alice.send("mine");
    let (text, state, _) = alice.row(&out.message_id);
    assert_eq!(text.as_deref(), Some("mine"));
    assert_eq!(state.as_deref(), Some("outgoing"));
    // Client-chosen UUID v7.
    assert_eq!(
        Uuid::parse_str(&out.message_id).unwrap().get_version_num(),
        7
    );

    assert!(server.deliver(&alice, &out, None));
    alice.sync(&server);
    let rows = alice.rows();
    assert_eq!(
        rows,
        vec![(
            out.message_id.clone(),
            Some("mine".into()),
            Some("decrypted".into()),
            1
        )]
    );
}

#[test]
fn commits_apply_up_to_each_entrys_epoch() {
    let (_pa, mut pb, alice, bob, mut server) = alice_and_bob();
    let before = send(&mut server, &alice, "epoch one");

    // Bob links a second device; Alice adds it (epoch 1 -> 2), then writes in epoch 2.
    let bob2 = Device::new(&mut pb, "u-b", 3);
    let claimed = bob2.key_package();
    let commit = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[claimed], &[]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, None, WS, CONV, true));
    let after = send(&mut server, &alice, "epoch two");

    // Without the Commits the sync stops at the first entry past the group's epoch, and keeps
    // its cursor there.
    let mut input = server.input(&bob.device_id());
    input.commits.clear();
    let notes = bob.sync_with(&server, input);
    assert_eq!(
        notes[0].stopped,
        Some(StopReason::NeedCommits {
            incarnation: 1,
            epoch: 1
        })
    );
    assert_eq!(bob.rows().len(), 1);

    let notes = bob.sync(&server);
    assert_eq!(notes[0].stopped, None);
    assert!(notes[0].verify, "the added leaf waits for verification");
    let texts: Vec<_> = bob.rows().into_iter().map(|r| (r.0, r.1)).collect();
    assert_eq!(
        texts,
        vec![
            (before.clone(), Some("epoch one".into())),
            (after.clone(), Some("epoch two".into()))
        ]
    );

    // The new device joined at epoch 2: what came before is one placeholder, never an error.
    let (incarnation, welcome) = server.welcome_for(&bob2);
    bob2.run(|tx, mls| group::join(tx, mls, WS, CONV, incarnation, &welcome));
    bob2.sync(&server);
    let rows = bob2.rows();
    assert_eq!(rows[0].0, before);
    assert_eq!(rows[0].1, None);
    assert_eq!(rows[0].2.as_deref(), Some("placeholder"));
    assert_eq!(rows[1].1.as_deref(), Some("epoch two"));
}

#[test]
fn placeholders_never_replace_plaintext_and_restores_replace_placeholders() {
    let (_pa, mut pb, alice, _bob, mut server) = alice_and_bob();
    let id = send(&mut server, &alice, "old");
    let bob2 = Device::new(&mut pb, "u-b", 3);
    let claimed = bob2.key_package();
    let commit = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[claimed], &[]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, None, WS, CONV, true));
    let (incarnation, welcome) = server.welcome_for(&bob2);
    bob2.run(|tx, mls| group::join(tx, mls, WS, CONV, incarnation, &welcome));
    bob2.sync(&server);
    assert_eq!(bob2.row(&id).1.as_deref(), Some("placeholder"));

    // Alice's archive restored on the new device: the plaintext replaces the placeholder.
    let (text, _, payload) = alice.row(&id);
    {
        let mut store = bob2.store.lock().unwrap();
        let tx = store.conn.transaction().unwrap();
        crate::message_cache::sync::write_message(
            &tx,
            &crate::message_cache::sync::MessageRow {
                id: id.clone(),
                workspace_id: WS.into(),
                conversation_id: CONV.into(),
                thread_id: None,
                author_id: "u-a".into(),
                version: 0,
                sent_at_us: 1,
                edited_at: None,
                is_deleted: false,
                text,
                payload: payload.to_string(),
                e2ee_state: Some("decrypted".into()),
            },
        )
        .unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(bob2.row(&id).0.as_deref(), Some("old"));

    // A later placeholder of the same message (higher version) does not take it back.
    server.counter += 1;
    let counter = server.counter;
    server.messages.get_mut(&id).unwrap().0 = counter;
    bob2.sync(&server);
    assert_eq!(bob2.row(&id).0.as_deref(), Some("old"));
    assert_eq!(bob2.row(&id).1.as_deref(), Some("decrypted"));
}

#[test]
fn a_message_that_breaks_a_rule_is_stored_without_its_content() {
    let (_pa, _pb, alice, bob, mut server) = alice_and_bob();
    let id = send(&mut server, &alice, "real");
    let forged = Uuid::now_v7().hyphenated().to_string();
    server.forge_copy(&id, &forged);
    // The forged row is read first, so it is the one that fails its id check.
    server.messages.get_mut(&id).unwrap().0 = server.counter + 1;
    bob.sync(&server);
    let (text, state, payload) = bob.row(&forged);
    assert_eq!(text, None);
    assert_eq!(state.as_deref(), Some("invalid"));
    assert_eq!(payload["e2ee"]["status"], "invalid");
    assert!(payload["e2ee"].get("content").is_none());
}

#[test]
fn deletes_tombstone_the_plaintext_and_reset_keeps_decrypted_rows() {
    let (_pa, _pb, alice, bob, mut server) = alice_and_bob();
    server.plaintext("plain-1", "before encryption");
    let keep = send(&mut server, &alice, "keep me");
    let gone = send(&mut server, &alice, "delete me");
    bob.sync(&server);
    server.delete(&gone);
    bob.sync(&server);
    let (text, state, payload) = bob.row(&gone);
    assert_eq!((text, state), (None, None));
    assert!(payload.get("e2ee").is_none());

    // RESET: the server cannot give the plaintext back, so decrypted rows stay.
    {
        let mut store = bob.store.lock().unwrap();
        let mut decryptor = Decryptor::new(&bob.mls, vec![]);
        store
            .apply_changes_with(
                WS,
                vec![ConversationChanges {
                    conversation_id: CONV.into(),
                    status: ChangesStatus::Reset,
                    changes: vec![],
                    cursor: "0".into(),
                    has_more: false,
                }],
                &mut decryptor,
            )
            .unwrap();
    }
    let ids: Vec<String> = bob.rows().into_iter().map(|r| r.0).collect();
    assert_eq!(ids, vec![keep]);
}

#[test]
fn a_stale_send_goes_again_with_the_same_id_in_the_new_epoch() {
    let (_pa, _pb, alice, bob, mut server) = alice_and_bob();
    let out = alice.send("racing");

    // Bob commits a self-update first: Alice's envelope is now for a past epoch.
    let commit = bob.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[], &[]));
    assert!(server.submit(&commit));
    bob.run(|tx, mls| group::settle(tx, mls, None, WS, CONV, true));
    assert!(!server.deliver(&alice, &out, None));

    // The loop brings Alice to the new epoch; the same content goes again.
    let commits = server.commits.clone();
    alice.run(|tx, mls| group::process_commits(tx, mls, WS, CONV, &commits));
    let again = alice.run(|tx, mls| outgoing::reencrypt(tx, mls, &out.message_id));
    assert_eq!(again.message_id, out.message_id);
    assert_eq!(again.epoch, 2);
    assert!(server.deliver(&alice, &again, None));
    alice.run(|tx, _| outgoing::settle(tx, &again.message_id, Some(&json!({}))));

    bob.sync(&server);
    assert_eq!(bob.row(&out.message_id).0.as_deref(), Some("racing"));
    assert_eq!(alice.row(&out.message_id).0.as_deref(), Some("racing"));
}

#[test]
fn a_refused_send_gives_its_body_back_and_a_refused_edit_restores_the_row() {
    let (_pa, _pb, alice, _bob, mut server) = alice_and_bob();
    let out = alice.send("never sent");
    let settled = alice.run(|tx, _| outgoing::settle(tx, &out.message_id, None));
    assert_eq!(settled.unsent_body.as_deref(), Some("never sent"));
    assert!(alice.rows().is_empty());

    let id = send(&mut server, &alice, "original");
    let mut edit = draft("u-a", "edited");
    edit.edit_of = Some(id.clone());
    let out = alice.run(|tx, mls| outgoing::encrypt(tx, mls, WS, CONV, &edit, &mut |_| None));
    assert_eq!(alice.row(&id).0.as_deref(), Some("edited"));
    assert_eq!(alice.row(&id).2["e2ee"]["rev"], 1);
    alice.run(|tx, _| outgoing::settle(tx, &out.message_id, None));
    assert_eq!(alice.row(&id).0.as_deref(), Some("original"));
}

#[test]
fn an_edit_carries_the_whole_message_at_a_higher_revision() {
    let (_pa, _pb, alice, bob, mut server) = alice_and_bob();
    let id = send(&mut server, &alice, "first draft");
    bob.sync(&server);
    let mut edit = draft("u-a", "final <@x> text");
    edit.edit_of = Some(id.clone());
    let out = alice.run(|tx, mls| outgoing::encrypt(tx, mls, WS, CONV, &edit, &mut |_| None));
    assert!(server.deliver(&alice, &out, None));
    bob.sync(&server);
    let (text, _, payload) = bob.row(&id);
    assert_eq!(text.as_deref(), Some("final <@x> text"));
    assert_eq!(payload["e2ee"]["rev"], 1);
}

#[test]
fn the_archive_keeps_the_e2ee_facts_and_skips_placeholders() {
    let (_pa, mut pb, alice, _bob, mut server) = alice_and_bob();
    let old = send(&mut server, &alice, "before");
    let bob2 = Device::new(&mut pb, "u-b", 3);
    let claimed = bob2.key_package();
    let commit = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[claimed], &[]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, None, WS, CONV, true));
    let (incarnation, welcome) = server.welcome_for(&bob2);
    bob2.run(|tx, mls| group::join(tx, mls, WS, CONV, incarnation, &welcome));
    let new = send(&mut server, &alice, "after");
    bob2.sync(&server);

    let mut store = bob2.store.lock().unwrap();
    let batch = store
        .archive_batch("archive", "device", 100)
        .unwrap()
        .unwrap();
    let messages: Vec<_> = batch
        .events
        .iter()
        .filter_map(|e| match e {
            crate::history_archive::format::Event::Message(m) => Some(m),
            _ => None,
        })
        .collect();
    assert_eq!(
        messages.len(),
        1,
        "the placeholder of {old} is not archived"
    );
    assert_eq!(messages[0].id, new);
    assert_eq!(messages[0].text.as_deref(), Some("after"));
    let e2ee = &messages[0].payload["e2ee"];
    for field in [
        "incarnation",
        "epoch",
        "senderDeviceId",
        "frankingKey",
        "receipt",
        "receiptKeyId",
        "sentAtUs",
    ] {
        assert!(e2ee.get(field).is_some(), "payload.e2ee.{field}");
    }
    let tables: i64 = store
        .conn
        .query_row("SELECT count(*) FROM mls_storage", [], |row| row.get(0))
        .unwrap();
    assert!(
        tables > 0,
        "group state is in the database, but never in an export"
    );
}

#[test]
fn appendix_a3_attachment_round_trip() {
    let secret: [u8; 32] = std::array::from_fn(|i| 0xa0 + i as u8);
    let encrypted = rim_mls::encrypt_attachment_with(
        Zeroizing::new(secret),
        b"hello, attachment\n",
        "hello.txt",
        "text/plain",
    )
    .unwrap();
    assert_eq!(
        hex::encode(&encrypted.blob),
        "096d52fa9b833e37ef33d387fc5ecab34eabb410807b85e90c862a44614c7c9cb163"
    );
    assert_eq!(
        b64(&encrypted.entry.blob_sha256),
        "EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac"
    );

    // Sent in a message, then decrypted from the cached content by its hash.
    let (_pa, _pb, alice, bob, mut server) = alice_and_bob();
    let entry = encrypted.entry.clone();
    let hash = b64(&entry.blob_sha256);
    let mut message = draft("u-a", "a file");
    message.attachments = vec![hash.clone()];
    let out = alice.run(|tx, mls| {
        outgoing::encrypt(tx, mls, WS, CONV, &message, &mut |h| {
            (h == hash).then(|| entry.clone())
        })
    });
    assert!(server.deliver(&alice, &out, None));
    bob.sync(&server);
    let (_, _, payload) = bob.row(&out.message_id);
    assert_eq!(payload["attachments"][0]["filename"], "hello.txt");
    assert_eq!(payload["attachments"][0]["blobSha256"], json!(hash));
    let found = bob.run(|tx, _| super::attachment::attachment_entry(tx, &out.message_id, &hash));
    let plaintext = rim_mls::decrypt_attachment(&found, &encrypted.blob).unwrap();
    assert_eq!(plaintext.as_slice(), b"hello, attachment\n");
    let mut tampered = encrypted.blob.clone();
    tampered[0] ^= 1;
    assert!(rim_mls::decrypt_attachment(&found, &tampered).is_err());
}

#[test]
fn leaves_verify_against_key_logs_and_certificates() {
    let (pa, pb, alice, bob, _server) = alice_and_bob();
    let members = vec![pa.id.clone(), pb.id.clone()];
    let full = DirectoryInput {
        members: members.clone(),
        principals: vec![pa.input(), pb.input()],
    };

    // Nothing remembered yet: the principals are asked for.
    let outcome = bob.run(|tx, mls| {
        directory::verify(
            tx,
            mls,
            WS,
            CONV,
            &DirectoryInput {
                members: members.clone(),
                principals: vec![],
            },
        )
    });
    assert_eq!(outcome.missing.len(), 2);

    let outcome = bob.run(|tx, mls| directory::verify(tx, mls, WS, CONV, &full));
    assert!(
        outcome.missing.is_empty() && outcome.unverified.is_empty(),
        "{outcome:?}"
    );
    // Remembered from now on.
    let outcome = bob.run(|tx, mls| {
        directory::verify(
            tx,
            mls,
            WS,
            CONV,
            &DirectoryInput {
                members: members.clone(),
                principals: vec![],
            },
        )
    });
    assert!(outcome.missing.is_empty() && outcome.unverified.is_empty());

    let check = |input: DirectoryInput| -> Vec<String> {
        bob.run(|tx, mls| directory::verify(tx, mls, WS, CONV, &input))
            .unverified
            .into_iter()
            .map(|u| u.reason)
            .collect()
    };

    let mut unknown = pa.input();
    unknown.devices.clear();
    assert_eq!(
        check(DirectoryInput {
            members: members.clone(),
            principals: vec![unknown, pb.input()],
        }),
        ["unknownDevice"]
    );

    let mut broken = pa.input();
    broken.key_log[0].signature = pb.log[0].signature.clone();
    assert_eq!(
        check(DirectoryInput {
            members: members.clone(),
            principals: vec![broken, pb.input()],
        }),
        ["keyLogInvalid"]
    );

    // A device certificate signed by another principal's identity key.
    let mut foreign = pa.input();
    foreign.devices[0].certificate = pb.devices[0].certificate.clone();
    assert_eq!(
        check(DirectoryInput {
            members: members.clone(),
            principals: vec![foreign, pb.input()],
        }),
        ["unknownDevice"]
    );

    assert_eq!(
        check(DirectoryInput {
            members: vec![pb.id.clone()],
            principals: vec![pa.input(), pb.input()],
        }),
        ["notMember"]
    );

    // Sending stops while a device does not verify, and resumes once it does.
    let mut revoked = pa.input();
    revoked.devices[0].revocation = Some(pa.devices[0].certificate.clone());
    check(DirectoryInput {
        members: members.clone(),
        principals: vec![revoked, pb.input()],
    });
    let refused = bob.try_run(|tx, mls| {
        outgoing::encrypt(tx, mls, WS, CONV, &draft("u-b", "hi"), &mut |_| None)
    });
    assert_eq!(refused.unwrap_err().code(), "E2EE_UNVERIFIED_DEVICE");
    assert!(check(full.clone()).is_empty());

    // A device the server marks revoked stays revoked here, though the server stops saying so.
    let mut revoked = pa.input();
    revoked.devices[0].revoked_at = Some(AT.into());
    assert_eq!(
        check(DirectoryInput {
            members: members.clone(),
            principals: vec![revoked, pb.input()],
        }),
        ["revokedDevice"]
    );
    assert_eq!(check(full), ["revokedDevice"]);
    let _ = alice;
}

#[test]
fn a_readd_request_is_honored_once_a_day_and_only_when_signed() {
    let (pa, pb, alice, bob, mut server) = alice_and_bob();
    send(&mut server, &alice, "before");

    // Bob lost his state: he signs a request for incarnation 1.
    let payload = bob.run(|tx, mls| group::prepare_readd(tx, mls, WS, CONV, 1));
    let request = bob.key.sign(rim_mls::READD_CONTEXT, payload);
    let input = ReaddInput {
        principal_id: pb.id.clone(),
        device_id: bob.device_id(),
        request: request.clone(),
    };
    let directory = DirectoryInput {
        members: vec![pa.id.clone(), pb.id.clone()],
        principals: vec![pa.input(), pb.input()],
    };
    let honorable = alice.run(|tx, _| {
        directory::honorable_readds(tx, WS, CONV, std::slice::from_ref(&input), &directory)
    });
    assert_eq!(honorable, vec![bob.view()]);

    // A request the device key did not sign is ignored.
    let mut forged = input.clone();
    forged.request = Statement {
        payload: request.payload.clone(),
        signature: alice
            .key
            .sign(rim_mls::READD_CONTEXT, request.payload.clone())
            .signature,
    };
    assert!(alice
        .run(|tx, _| directory::honorable_readds(tx, WS, CONV, &[forged], &directory))
        .is_empty());

    // Alice re-adds him (remove + add with a fresh one-time package) and notes it.
    let claimed = bob.key_package();
    let commit = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[claimed], &[bob.view()]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| {
        group::settle(tx, mls, None, WS, CONV, true)?;
        group::note_readds_honored(tx, CONV, &[bob.view()])
    });
    assert!(alice
        .run(|tx, _| directory::honorable_readds(
            tx,
            WS,
            CONV,
            std::slice::from_ref(&input),
            &directory
        ))
        .is_empty());

    // Bob joins again; what was sent before stays a placeholder until a restore.
    let (incarnation, welcome) = server.welcome_for(&bob);
    bob.run(|tx, mls| group::join(tx, mls, WS, CONV, incarnation, &welcome));
    let after = send(&mut server, &alice, "after");
    bob.sync(&server);
    assert_eq!(bob.row(&after).0.as_deref(), Some("after"));
}

#[test]
fn a_device_without_state_stops_until_its_welcome_or_says_placeholder_when_absent() {
    let mut pa = Principal::new(1);
    let mut pb = Principal::new(2);
    let alice = Device::new(&mut pa, "u-a", 1);
    let bob = Device::new(&mut pb, "u-b", 2);
    let mut server = Server::new();
    server.group_devices.push(alice.device_id());
    let claimed = bob.key_package();
    let commit = alice.run(|tx, mls| group::create(tx, mls, WS, CONV, 1, &[claimed]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, Some(&alice.device), WS, CONV, true));
    let id = send(&mut server, &alice, "hi");

    // Bob is a group device but has not processed his Welcome: stop, do not place.
    let notes = bob.sync(&server);
    assert_eq!(
        notes[0].stopped,
        Some(StopReason::NoGroupState { incarnation: 1 })
    );
    assert!(bob.rows().is_empty());

    let (incarnation, welcome) = server.welcome_for(&bob);
    bob.run(|tx, mls| group::join(tx, mls, WS, CONV, incarnation, &welcome));
    bob.sync(&server);
    assert_eq!(bob.row(&id).0.as_deref(), Some("hi"));

    // A device the server says is not in the group places the entry.
    let mut pc = Principal::new(3);
    let carol = Device::new(&mut pc, "u-c", 4);
    carol.sync(&server);
    assert_eq!(carol.row(&id).1.as_deref(), Some("placeholder"));
}

#[test]
fn a_commit_without_an_answer_is_recognized_when_it_comes_back() {
    let (_pa, _pb, alice, bob, mut server) = alice_and_bob();
    let commit = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[], &[]));
    assert!(server.submit(&commit));
    // No answer reached Alice: she fetches the Commit at that epoch and finds it is hers.
    let commits = server.commits.clone();
    let step = alice.run(|tx, mls| group::process_commits(tx, mls, WS, CONV, &commits));
    assert_eq!(step, group::CommitStep::Applied);
    let view = alice.run(|tx, mls| group::view(tx, mls, WS, CONV));
    assert_eq!(view.epoch, Some(2));
    assert!(!view.commit_pending);
    let id = send(&mut server, &alice, "after the update");
    bob.sync(&server);
    assert_eq!(bob.row(&id).0.as_deref(), Some("after the update"));
}

#[test]
fn a_new_incarnation_replaces_the_old_group() {
    let (_pa, pb, alice, bob, mut server) = alice_and_bob();
    let old = send(&mut server, &alice, "incarnation one");
    bob.sync(&server);
    let claimed = bob.key_package();
    let commit = alice.run(|tx, mls| group::create(tx, mls, WS, CONV, 2, &[claimed]));
    // The old group stays usable until the server accepts.
    assert_eq!(
        alice
            .run(|tx, mls| group::view(tx, mls, WS, CONV))
            .state
            .incarnation,
        1
    );
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, Some(&alice.device), WS, CONV, true));
    let view = alice.run(|tx, mls| group::view(tx, mls, WS, CONV));
    assert_eq!(view.state.incarnation, 2);
    assert_eq!(view.state.resets.len(), 1);

    let (incarnation, welcome) = server.welcome_for(&bob);
    let view = bob.run(|tx, mls| group::join(tx, mls, WS, CONV, incarnation, &welcome));
    assert_eq!(view.state.incarnation, 2);
    assert_eq!(view.state.resets[0].principal_id, alice.device.principal_id);
    let new = send(&mut server, &alice, "incarnation two");
    bob.sync(&server);
    assert_eq!(bob.row(&old).0.as_deref(), Some("incarnation one"));
    assert_eq!(bob.row(&new).0.as_deref(), Some("incarnation two"));
    let _ = pb;
}

#[test]
fn plaintext_entries_of_an_upgraded_conversation_stay_plaintext() {
    let (_pa, _pb, alice, bob, mut server) = alice_and_bob();
    server.plaintext("plain-1", "from before");
    let id = send(&mut server, &alice, "encrypted now");
    bob.sync(&server);
    let rows = bob.rows();
    assert_eq!(
        rows[0],
        ("plain-1".into(), Some("from before".into()), None, 1)
    );
    assert_eq!(bob.row(&id).0.as_deref(), Some("encrypted now"));
}

// ─── Hardening against a misbehaving server ─────────────────────────────────

fn view(device: &Device) -> group::GroupView {
    device.run(|tx, mls| group::view(tx, mls, WS, CONV))
}

#[test]
fn finding_1_a_conversation_stays_encrypted_here_whatever_the_server_says() {
    let (mut pa, _pb, alice, bob, mut server) = alice_and_bob();
    // Group state pins it.
    let pinned = view(&bob);
    assert!(pinned.pinned);
    assert_eq!(pinned.pinned_encrypted_at, None);

    // The first encryptedAt seen stays; a later answer changes nothing.
    bob.run(|tx, _| group::pin(tx, WS, CONV, Some(AT), None));
    bob.run(|tx, _| group::pin(tx, WS, CONV, Some("2030-01-01T00:00:00Z"), None));
    assert_eq!(view(&bob).pinned_encrypted_at.as_deref(), Some(AT));

    // Forgetting the group (a NO_ACCESS the server answered, say) keeps the pin.
    bob.run(|tx, mls| group::forget(tx, mls, WS, CONV));
    let forgotten = view(&bob);
    assert!(forgotten.pinned && !forgotten.has_group);
    assert_eq!(forgotten.pinned_encrypted_at.as_deref(), Some(AT));
    assert_eq!(
        bob.run(|tx, _| group::conversations(tx, WS)),
        vec![CONV.to_string()]
    );

    // State without a group (a leaf check of a conversation it holds nothing for) pins nothing.
    let bystander = Device::new(&mut pa, "u-a", 8);
    bystander.run(|tx, mls| directory::verify(tx, mls, WS, CONV, &DirectoryInput::default()));
    assert!(!view(&bystander).pinned);

    // A device that only ever saw an encrypted entry pins the conversation too.
    let other = Device::new(&mut pa, "u-a", 7);
    send(&mut server, &alice, "seen elsewhere");
    other.sync(&server);
    assert!(view(&other).pinned);
}

#[test]
fn finding_4_a_direct_message_is_pinned_to_its_two_principals() {
    let (pa, pb, alice, bob, mut server) = alice_and_bob();
    let mut pc = Principal::new(3);
    let carol = Device::new(&mut pc, "u-c", 3);
    bob.run(|tx, _| group::pin(tx, WS, CONV, None, Some(&[pb.id.clone(), pa.id.clone()])));
    assert_eq!(
        view(&bob).dm_principals,
        Some({
            let mut pair = vec![pa.id.clone(), pb.id.clone()];
            pair.sort();
            pair
        })
    );
    // Neither a third principal nor a later pair replaces the first.
    let three = [pa.id.clone(), pb.id.clone(), pc.id.clone()];
    assert!(bob
        .try_run(|tx, _| group::pin(tx, WS, CONV, None, Some(&three)))
        .is_err());
    bob.run(|tx, _| group::pin(tx, WS, CONV, None, Some(&[pa.id.clone(), pc.id.clone()])));
    assert!(!view(&bob).dm_principals.unwrap().contains(&pc.id));

    // The server lists Carol as a member and a device of Alice's adds her: Bob does not take
    // her leaf as a member's.
    server.member(&carol);
    let claimed = carol.key_package();
    let commit = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[claimed], &[]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, None, WS, CONV, true));
    bob.sync(&server);
    let outcome = bob.run(|tx, mls| {
        directory::verify(
            tx,
            mls,
            WS,
            CONV,
            &DirectoryInput {
                members: three.to_vec(),
                principals: vec![pa.input(), pb.input(), pc.input()],
            },
        )
    });
    assert_eq!(
        outcome
            .unverified
            .iter()
            .map(|u| (u.principal_id.as_str(), u.reason.as_str()))
            .collect::<Vec<_>>(),
        [(pc.id.as_str(), "notMember")]
    );
}

#[test]
fn finding_4_adds_and_removes_come_from_processed_commits() {
    let (_pa, _pb, alice, bob, mut server) = alice_and_bob();
    let mut pc = Principal::new(3);
    let carol = Device::new(&mut pc, "u-c", 3);
    server.member(&carol);

    let claimed = carol.key_package();
    let commit = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[claimed], &[]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, None, WS, CONV, true));
    let removal = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[], &[carol.view()]));
    assert!(server.submit(&removal));
    alice.run(|tx, mls| group::settle(tx, mls, None, WS, CONV, true));
    bob.sync(&server);

    let expected = vec![
        group::MembershipEvent {
            incarnation: 1,
            epoch: 2,
            kind: "added".into(),
            principal_id: pc.id.clone(),
        },
        group::MembershipEvent {
            incarnation: 1,
            epoch: 3,
            kind: "removed".into(),
            principal_id: pc.id.clone(),
        },
    ];
    // The committer from its own merges, the reader from the Commits it processed.
    assert_eq!(view(&alice).state.membership, expected);
    assert_eq!(view(&bob).state.membership, expected);
    // A device joining a principal already in the group is not a member added.
    let mut pb2 = Principal::new(2);
    let bob_laptop = Device::new(&mut pb2, "u-b", 9);
    let claimed = bob_laptop.key_package();
    let commit = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[claimed], &[]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, None, WS, CONV, true));
    assert_eq!(view(&alice).state.membership, expected);
}

#[test]
fn finding_5_a_row_must_name_its_author_principal_and_the_mls_sender_device() {
    let (_pa, pb, alice, bob, mut server) = alice_and_bob();
    let nameless = send(&mut server, &alice, "who am i");
    server.messages.get_mut(&nameless).unwrap().1["author"]["principalId"] = Value::Null;
    let moved = send(&mut server, &alice, "from another device");
    server.messages.get_mut(&moved).unwrap().1["encryption"]["senderDeviceId"] =
        json!(Uuid::from_u128(99).hyphenated().to_string());
    let claimed = send(&mut server, &alice, "claimed by bob");
    server.messages.get_mut(&claimed).unwrap().1["author"]["principalId"] = json!(pb.id);
    let honest = send(&mut server, &alice, "honest");
    bob.sync(&server);

    for (id, reason) in [
        (&nameless, "the row names no author principal"),
        (&moved, "the sender device is not the row's"),
        (&claimed, "the sender is not the row's author"),
    ] {
        let (text, state, payload) = bob.row(id);
        assert_eq!(
            (text, state.as_deref()),
            (None, Some("invalid")),
            "{reason}"
        );
        assert_eq!(payload["e2ee"]["reason"], json!(reason));
    }
    let (text, _, payload) = bob.row(&honest);
    assert_eq!(text.as_deref(), Some("honest"));
    assert_eq!(
        payload["e2ee"]["senderPrincipalId"],
        json!(alice.device.principal_id)
    );
    assert_eq!(payload["e2ee"]["senderDeviceId"], json!(alice.device_id()));
}

#[test]
fn finding_6_a_replayed_welcome_is_refused_and_keeps_the_group() {
    let mut pa = Principal::new(1);
    let mut pb = Principal::new(2);
    let alice = Device::new(&mut pa, "u-a", 1);
    let bob = Device::new(&mut pb, "u-b", 2);
    let mut server = Server::new();
    server.member(&alice);
    server.member(&bob);
    server.group_devices.push(alice.device_id());
    // A last-resort package keeps its private key: its Welcome would open again.
    let packages = bob.run(|tx, mls| {
        Ok(mls.generate_key_packages(&rim_mls::SqliteStore::new(tx), 1, true, now())?)
    });
    let claimed = ClaimedInput {
        principal_id: pb.id.clone(),
        device_id: bob.device_id(),
        key_package: b64(&packages[0].message),
    };
    let commit = alice.run(|tx, mls| group::create(tx, mls, WS, CONV, 1, &[claimed]));
    assert!(server.submit(&commit));
    alice.run(|tx, mls| group::settle(tx, mls, Some(&alice.device), WS, CONV, true));
    let (incarnation, welcome) = server.welcome_for(&bob);
    bob.run(|tx, mls| group::join(tx, mls, WS, CONV, incarnation, &welcome));

    let update = alice.run(|tx, mls| group::commit(tx, mls, WS, CONV, &[], &[]));
    assert!(server.submit(&update));
    alice.run(|tx, mls| group::settle(tx, mls, None, WS, CONV, true));
    bob.sync(&server);
    assert_eq!(view(&bob).epoch, Some(2));

    let replay = bob.try_run(|tx, mls| group::join(tx, mls, WS, CONV, incarnation, &welcome));
    assert_eq!(replay.unwrap_err().code(), "E2EE_STALE_WELCOME");
    assert_eq!(view(&bob).epoch, Some(2));
    let after = send(&mut server, &alice, "still in step");
    bob.sync(&server);
    assert_eq!(bob.row(&after).0.as_deref(), Some("still in step"));
}

#[test]
fn finding_11_a_key_log_must_extend_the_head_pinned_here() {
    let (mut pa, pb, _alice, bob, _server) = alice_and_bob();
    let members = vec![pa.id.clone(), pb.id.clone()];
    let check = |a: PrincipalInput| -> Vec<String> {
        bob.run(|tx, mls| {
            directory::verify(
                tx,
                mls,
                WS,
                CONV,
                &DirectoryInput {
                    members: members.clone(),
                    principals: vec![a, pb.input()],
                },
            )
        })
        .unverified
        .into_iter()
        .map(|u| u.reason)
        .collect()
    };
    let pinned = |principal: &str| {
        bob.run(|tx, _| Ok(directory::load_peers(tx)?.get(principal).cloned()))
            .map(|p| (p.head_seq, p.head_hash))
    };

    // First use pins the head.
    let original = pa.input();
    assert!(check(original.clone()).is_empty());
    let head = statement::replay(&pa.log).unwrap();
    assert_eq!(pinned(&pa.id), Some((0, head.hash.clone())));

    // A valid rotation extends it, and the pin moves.
    let rotation = statement::rotation(
        &head,
        statement::RotationSigner::Identity,
        &pa.identity,
        &SecretKey::from_seed(Zeroizing::new([77; 32])).public_key(),
        AT,
    );
    pa.log.push(rotation.clone());
    assert!(check(pa.input()).is_empty());
    assert_eq!(pinned(&pa.id).map(|p| p.0), Some(1));

    // The older prefix (hiding the rotation) and a fork at the same seq are both refused.
    assert_eq!(check(original.clone()), ["keyLogForked"]);
    let mut forked = original;
    forked.key_log.push(statement::rotation(
        &head,
        statement::RotationSigner::Identity,
        &pa.identity,
        &SecretKey::from_seed(Zeroizing::new([78; 32])).public_key(),
        AT,
    ));
    assert_eq!(check(forked), ["keyLogForked"]);
    assert_eq!(pinned(&pa.id).map(|p| p.0), Some(1));
    assert!(check(pa.input()).is_empty());
}

#[test]
fn finding_2_a_signed_revocation_is_verified_and_remembered() {
    let (pa, pb, _alice, bob, _server) = alice_and_bob();
    let members = vec![pa.id.clone(), pb.id.clone()];
    let check = |a: PrincipalInput| -> Vec<String> {
        bob.run(|tx, mls| {
            directory::verify(
                tx,
                mls,
                WS,
                CONV,
                &DirectoryInput {
                    members: members.clone(),
                    principals: vec![a, pb.input()],
                },
            )
        })
        .unverified
        .into_iter()
        .map(|u| u.reason)
        .collect()
    };
    let device_id = pa.devices[0].device_id.clone();

    // A revocation nobody with a key signed keeps the device out this time only.
    let mut forged = pa.input();
    forged.devices[0].revocation = Some(statement::revocation(
        &SecretKey::from_seed(Zeroizing::new([66; 32])),
        false,
        &pa.id,
        &device_id,
        AT,
    ));
    assert_eq!(check(forged), ["revokedDevice"]);
    assert!(check(pa.input()).is_empty());

    // One the identity key signed stays, though the server stops listing it.
    let mut signed = pa.input();
    signed.devices[0].revocation = Some(statement::revocation(
        &pa.identity,
        false,
        &pa.id,
        &device_id,
        AT,
    ));
    assert_eq!(check(signed), ["revokedDevice"]);
    assert_eq!(check(pa.input()), ["revokedDevice"]);
    let remembered = bob.run(|tx, _| directory::load_peers(tx));
    assert!(remembered[&pa.id].revoked.contains(&device_id));
}
