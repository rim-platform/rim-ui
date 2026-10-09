//! Multi-device simulations against the in-process sequencer: the client loop, membership and
//! device changes, races, re-adds, incarnations, and decrypt-once.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen_test::wasm_bindgen_test as test;

use std::collections::HashMap;

use uuid::Uuid;

use super::sequencer::{Refusal, Sequencer};
use super::support::{now, sign, tagged_public, Directory, Provider, TestDevice};
use crate::{
    commit_rank, CommitOutcome, ConversationGroup, DecryptExpectations, Decrypted, DeviceRef,
    Error, Leaf, MessageContent, READD_CONTEXT,
};

/// What a client shows for a message.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Shown {
    Text(String),
    /// "Earlier messages were sent before this device joined" (or in an older incarnation).
    Placeholder,
    /// "A message from … could not be verified".
    Invalid,
}

/// A device running the client loop.
struct Client {
    dev: TestDevice,
    /// The incarnation this device holds state for.
    incarnation: Option<u32>,
    /// How far this device read the feed.
    cursor: usize,
    shown: HashMap<Uuid, Shown>,
    /// Leaves the device found that do not verify.
    unverified: Vec<Leaf>,
}

impl Client {
    fn new(n: u8, d: u8) -> Self {
        Self::on(Provider::Libcrux, n, d)
    }

    fn on(provider: Provider, n: u8, d: u8) -> Self {
        Self {
            dev: TestDevice::new(provider, n, d),
            incarnation: None,
            cursor: 0,
            shown: HashMap::new(),
            unverified: vec![],
        }
    }

    fn device(&self) -> &DeviceRef {
        &self.dev.device
    }

    fn group(&self, server: &Sequencer) -> ConversationGroup {
        ConversationGroup::new(server.conversation, self.incarnation.unwrap_or(1))
    }

    /// Generate and upload `n` one-time key packages and a last-resort one.
    fn upload(&self, server: &mut Sequencer, n: usize) {
        let mut packages = self
            .dev
            .mls
            .generate_key_packages(&self.dev.store, n, false, now())
            .unwrap();
        packages.extend(
            self.dev
                .mls
                .generate_key_packages(&self.dev.store, 1, true, now())
                .unwrap(),
        );
        self.dev.store.commit();
        server.upload(self.device(), packages);
    }

    fn epoch(&self, server: &Sequencer) -> Option<u64> {
        self.dev
            .mls
            .group_status(&self.dev.store, self.group(server))
            .ok()
            .map(|status| status.epoch)
    }

    /// Join from every Welcome the server holds for this device.
    fn join_welcomes(&mut self, server: &mut Sequencer, directory: &Directory) {
        for (incarnation, welcome) in server.take_welcomes(self.device()) {
            let group = ConversationGroup::new(server.conversation, incarnation);
            let joined = self.dev.mls.join(&self.dev.store, group, &welcome).unwrap();
            self.dev.store.commit();
            if let Some(old) = self.incarnation.filter(|old| *old != incarnation) {
                let old = ConversationGroup::new(server.conversation, old);
                self.dev.mls.delete_group(&self.dev.store, old).unwrap();
                self.dev.store.commit();
            }
            self.incarnation = Some(incarnation);
            self.unverified.extend(
                crate::verify_leaves(&joined.leaves, directory)
                    .into_iter()
                    .map(|p| p.leaf),
            );
        }
    }

    /// Process the Commit for the group's current epoch.
    fn apply_commit(
        &mut self,
        server: &Sequencer,
        bytes: &[u8],
        directory: &Directory,
    ) -> CommitOutcome {
        let group = self.group(server);
        let outcome = self
            .dev
            .mls
            .process_commit(&self.dev.store, group, bytes)
            .unwrap();
        self.dev.store.commit();
        if let CommitOutcome::Applied(applied) = &outcome {
            let leaves = if applied.summary_matches {
                applied.to_verify.clone()
            } else if applied.self_removed {
                vec![]
            } else {
                self.dev.mls.leaves(&self.dev.store, group).unwrap()
            };
            let all = if applied.self_removed {
                vec![]
            } else {
                self.dev.mls.leaves(&self.dev.store, group).unwrap()
            };
            for leaf in leaves {
                if crate::verify_leaf(&leaf, &all, directory).is_err() {
                    self.unverified.push(leaf);
                }
            }
            if applied.self_removed {
                self.incarnation = None;
            }
        }
        outcome
    }

    /// The client loop: Commits up to each message's epoch, decrypt it once, then the rest.
    fn sync(&mut self, server: &mut Sequencer, directory: &Directory) {
        self.join_welcomes(server, directory);
        let Some(incarnation) = self.incarnation else {
            for row in &server.feed[self.cursor..] {
                self.shown.entry(row.id).or_insert(Shown::Placeholder);
            }
            self.cursor = server.feed.len();
            return;
        };
        while self.cursor < server.feed.len() {
            let row = server.feed[self.cursor].clone();
            if row.incarnation != incarnation || self.incarnation.is_none() {
                self.shown.entry(row.id).or_insert(Shown::Placeholder);
                self.cursor += 1;
                continue;
            }
            while let Some(epoch) = self.epoch(server).filter(|epoch| *epoch < row.epoch) {
                // A Commit past retention, or one this device cannot process: it stops here.
                let Some(commit) = server.commit_at(epoch) else {
                    return;
                };
                if !matches!(
                    self.apply_commit(server, &commit, directory),
                    CommitOutcome::Applied(_) | CommitOutcome::OwnMerged { .. }
                ) {
                    return;
                }
            }
            self.cursor += 1;
            if self.incarnation.is_none() {
                self.shown.entry(row.id).or_insert(Shown::Placeholder);
                continue;
            }
            let expected = DecryptExpectations {
                message_id: row.id,
                thread_root_id: None,
                author_principal_id: Some(row.author.clone()),
            };
            let shown = match self.dev.mls.decrypt(
                &self.dev.store,
                self.group(server),
                &row.envelope,
                &expected,
            ) {
                Ok(Decrypted::Message(message)) => Shown::Text(message.content.body),
                Ok(Decrypted::Invalid { .. }) => Shown::Invalid,
                // Own messages keep the plaintext stored when sending.
                Ok(Decrypted::Own) => self
                    .shown
                    .get(&row.id)
                    .cloned()
                    .unwrap_or(Shown::Placeholder),
                Err(_) => {
                    self.dev.store.rollback();
                    self.shown.entry(row.id).or_insert(Shown::Placeholder);
                    continue;
                }
            };
            // The plaintext and the ratchet are stored together.
            self.shown.insert(row.id, shown);
            self.dev.store.commit();
        }
        if let Some(epoch) = self.epoch(server) {
            for (commit_epoch, commit) in server.commits_from(incarnation, epoch) {
                if Some(commit_epoch) != self.epoch(server) || self.incarnation.is_none() {
                    break;
                }
                if !matches!(
                    self.apply_commit(server, &commit, directory),
                    CommitOutcome::Applied(_) | CommitOutcome::OwnMerged { .. }
                ) {
                    break;
                }
            }
        }
    }

    /// Commit every pending change this device can: claim the adds, remove the removes.
    fn commit_pending(&mut self, server: &mut Sequencer) -> Result<u64, Refusal> {
        let adds = server.pending_adds();
        let removes = server.pending_removes();
        let claimed = server.claim(self.device(), &adds)?;
        let group = self.group(server);
        let outgoing = self
            .dev
            .mls
            .commit(&self.dev.store, group, &claimed, &removes)
            .unwrap();
        self.dev.store.commit();
        self.submit(server, &outgoing)
    }

    fn submit(
        &mut self,
        server: &mut Sequencer,
        outgoing: &crate::OutgoingCommit,
    ) -> Result<u64, Refusal> {
        let group = outgoing.group;
        match server.submit_commit(self.device(), outgoing) {
            Ok(epoch) => {
                assert_eq!(
                    self.dev
                        .mls
                        .commit_accepted(&self.dev.store, group)
                        .unwrap(),
                    epoch
                );
                if let Some(old) = self.incarnation.filter(|old| *old != group.incarnation) {
                    let old = ConversationGroup::new(server.conversation, old);
                    self.dev.mls.delete_group(&self.dev.store, old).unwrap();
                }
                self.dev.store.commit();
                self.incarnation = Some(group.incarnation);
                Ok(epoch)
            }
            Err(refusal) => {
                self.dev
                    .mls
                    .commit_rejected(&self.dev.store, group)
                    .unwrap();
                self.dev.store.commit();
                Err(refusal)
            }
        }
    }

    /// Create the conversation's group with every desired device.
    fn create(&mut self, server: &mut Sequencer, incarnation: u32) -> Result<u64, Refusal> {
        let me = self.device().clone();
        let targets: Vec<DeviceRef> = server
            .desired()
            .into_iter()
            .filter(|device| *device != me)
            .collect();
        let claimed = if server.group.is_some() {
            server.claim_for_incarnation(&me, &targets)?
        } else {
            server.claim(&me, &targets)?
        };
        let group = ConversationGroup::new(server.conversation, incarnation);
        let outgoing = self
            .dev
            .mls
            .create_group(&self.dev.store, group, &claimed)
            .unwrap();
        self.dev.store.commit();
        self.submit(server, &outgoing)
    }

    /// Send a message; the plaintext is stored under its id before the server answers.
    fn send(&mut self, server: &mut Sequencer, body: &str) -> Result<Uuid, Refusal> {
        let content = MessageContent::new(Uuid::now_v7(), body);
        let sent = self
            .dev
            .mls
            .encrypt(&self.dev.store, self.group(server), &content)
            .unwrap();
        self.shown.insert(content.id, Shown::Text(body.into()));
        self.dev.store.commit();
        server.send(self.device(), &sent)?;
        Ok(content.id)
    }

    fn reads(&self, id: &Uuid) -> Option<&Shown> {
        self.shown.get(id)
    }
}

fn directory_of(clients: &[&Client]) -> Directory {
    Directory::with(&clients.iter().map(|c| &c.dev).collect::<Vec<_>>())
}

/// Users 1 to `users` with `devices` each, all members, all uploaded.
fn population(server: &mut Sequencer, users: u8, devices: u8) -> Vec<Client> {
    let mut clients = vec![];
    for n in 1..=users {
        for d in 1..=devices {
            let client = Client::new(n, d);
            client.upload(server, 3);
            server.members.insert(client.device().principal_id.clone());
            clients.push(client);
        }
    }
    clients
}

fn sync_all(clients: &mut [Client], server: &mut Sequencer, directory: &Directory) {
    for client in clients.iter_mut() {
        client.sync(server, directory);
    }
}

fn text(body: &str) -> Shown {
    Shown::Text(body.into())
}

#[test]
fn three_users_with_three_devices_each() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 3, 3);
    let directory = directory_of(&clients.iter().collect::<Vec<_>>());
    assert_eq!(clients[0].create(&mut server, 1), Ok(1));
    sync_all(&mut clients, &mut server, &directory);

    let mut sent = vec![];
    for (i, client) in clients.iter_mut().enumerate() {
        let body = format!("hello from {i}");
        sent.push((client.send(&mut server, &body).unwrap(), body));
    }
    sync_all(&mut clients, &mut server, &directory);
    for client in &clients {
        assert!(client.unverified.is_empty());
        for (id, body) in &sent {
            assert_eq!(client.reads(id), Some(&text(body)));
        }
    }
    assert_eq!(server.group.as_ref().unwrap().devices.len(), 9);
}

#[test]
fn devices_are_linked_and_revoked() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 2, 2);
    let mut directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);
    let before = clients[0].send(&mut server, "before the link").unwrap();

    // User 1 links a third device: a pending add, committed by the user's own device first.
    let linked = Client::new(1, 3);
    linked.upload(&mut server, 2);
    directory.add(&linked.dev);
    assert_eq!(server.pending_adds(), vec![linked.device().clone()]);
    let group_devices: Vec<Uuid> = server
        .group
        .as_ref()
        .unwrap()
        .devices
        .iter()
        .map(|d| d.device_id)
        .collect();
    assert_eq!(
        commit_rank(
            &group_devices,
            &[],
            Some(&clients[1].device().device_id),
            &clients[1].device().device_id
        ),
        Some(0)
    );
    clients[1].sync(&mut server, &directory);
    clients[1].commit_pending(&mut server).unwrap();
    clients.push(linked);
    sync_all(&mut clients, &mut server, &directory);
    let after = clients[2].send(&mut server, "after the link").unwrap();
    sync_all(&mut clients, &mut server, &directory);
    assert_eq!(clients[4].reads(&before), Some(&Shown::Placeholder));
    assert_eq!(clients[4].reads(&after), Some(&text("after the link")));

    // User 2 revokes their second device: messages wait until its removal is committed.
    let revoked = clients[3].device().clone();
    server.revoke(&revoked);
    directory.devices.insert(
        (revoked.principal_id.clone(), revoked.device_id),
        crate::DeviceStatus::Revoked,
    );
    assert_eq!(
        clients[0].send(&mut server, "too early"),
        Err(Refusal::CommitRequired)
    );
    sync_all(&mut clients, &mut server, &directory);
    clients[0].commit_pending(&mut server).unwrap();
    sync_all(&mut clients, &mut server, &directory);
    assert_eq!(
        clients[3].incarnation, None,
        "the revoked device deleted its group state"
    );
    let secret = clients[0]
        .send(&mut server, "after the revocation")
        .unwrap();
    sync_all(&mut clients, &mut server, &directory);
    assert_eq!(clients[3].reads(&secret), Some(&Shown::Placeholder));
    for i in [1, 2, 4] {
        assert_eq!(
            clients[i].reads(&secret),
            Some(&text("after the revocation"))
        );
    }
}

#[test]
fn members_leave_and_join() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 3, 2);
    let mut directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);

    // User 3 leaves: both devices are pending removes.
    let leaver = clients[4].device().principal_id.clone();
    server.members.remove(&leaver);
    directory.members.remove(&leaver);
    assert_eq!(server.pending_removes().len(), 2);
    clients[2].commit_pending(&mut server).unwrap();
    // User 4 joins with two devices.
    let mut joiners = vec![Client::new(4, 1), Client::new(4, 2)];
    for joiner in &joiners {
        joiner.upload(&mut server, 2);
        directory.add(&joiner.dev);
        server.members.insert(joiner.device().principal_id.clone());
    }
    sync_all(&mut clients, &mut server, &directory);
    clients[0].commit_pending(&mut server).unwrap();
    clients.append(&mut joiners);
    sync_all(&mut clients, &mut server, &directory);

    let id = clients[6]
        .send(&mut server, "hi from the new member")
        .unwrap();
    sync_all(&mut clients, &mut server, &directory);
    for (i, client) in clients.iter().enumerate() {
        let expected = if i == 4 || i == 5 {
            Shown::Placeholder
        } else {
            text("hi from the new member")
        };
        assert_eq!(client.reads(&id), Some(&expected), "client {i}");
        assert!(client.unverified.is_empty());
    }
}

#[test]
fn racing_committers_follow_the_ranking() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 2, 2);
    let mut directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);

    let newcomer = Client::new(2, 3);
    newcomer.upload(&mut server, 3);
    directory.add(&newcomer.dev);
    let devices: Vec<Uuid> = server
        .group
        .as_ref()
        .unwrap()
        .devices
        .iter()
        .map(|d| d.device_id)
        .collect();
    let mut ranked: Vec<usize> = (0..4).collect();
    ranked.sort_by_key(|&i| {
        commit_rank(&devices, &[], None, &clients[i].device().device_id).unwrap()
    });

    // Both stage a Commit for the same epoch; the lower rank reaches the server first.
    let (first, second) = (ranked[0], ranked[1]);
    let adds = server.pending_adds();
    let group = clients[first].group(&server);
    let claimed_first = server.claim(clients[first].device(), &adds).unwrap();
    let claimed_second = server.claim(clients[second].device(), &adds).unwrap();
    let first_commit = clients[first]
        .dev
        .mls
        .commit(&clients[first].dev.store, group, &claimed_first, &[])
        .unwrap();
    let second_commit = clients[second]
        .dev
        .mls
        .commit(&clients[second].dev.store, group, &claimed_second, &[])
        .unwrap();
    assert_eq!(first_commit.epoch, second_commit.epoch);
    assert!(clients[first].submit(&mut server, &first_commit).is_ok());
    assert!(matches!(
        clients[second].submit(&mut server, &second_commit),
        Err(Refusal::StaleEpoch { .. })
    ));
    // The loser runs the loop, finds nothing pending any more, and is in step.
    clients[second].sync(&mut server, &directory);
    assert!(server.pending_adds().is_empty());
    clients.push(newcomer);
    sync_all(&mut clients, &mut server, &directory);
    let id = clients[second].send(&mut server, "in step").unwrap();
    sync_all(&mut clients, &mut server, &directory);
    for client in &clients {
        assert_eq!(client.reads(&id), Some(&text("in step")));
    }
}

#[test]
fn a_submit_without_an_answer_is_settled_by_the_commit_at_that_epoch() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 2, 1);
    let directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);

    // The server accepts, but the answer is lost: the device keeps its Commit pending.
    let group = clients[0].group(&server);
    let outgoing = clients[0]
        .dev
        .mls
        .self_update(&clients[0].dev.store, group)
        .unwrap();
    server
        .submit_commit(clients[0].device(), &outgoing)
        .unwrap();
    assert!(matches!(
        clients[0].dev.mls.encrypt(
            &clients[0].dev.store,
            group,
            &MessageContent::new(Uuid::now_v7(), "x")
        ),
        Err(Error::CommitPending)
    ));
    let at_epoch = server.commit_at(outgoing.epoch).unwrap();
    assert!(matches!(
        clients[0]
            .dev
            .mls
            .process_commit(&clients[0].dev.store, group, &at_epoch)
            .unwrap(),
        CommitOutcome::OwnMerged { epoch: 2 }
    ));
    clients[0].dev.store.commit();
    let id = clients[0].send(&mut server, "settled").unwrap();
    sync_all(&mut clients, &mut server, &directory);
    assert_eq!(clients[1].reads(&id), Some(&text("settled")));
}

#[test]
fn a_message_refused_as_stale_is_sent_again_in_the_new_epoch() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 2, 1);
    let directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);

    let group = clients[0].group(&server);
    let content = MessageContent::new(Uuid::now_v7(), "late");
    let first = clients[0]
        .dev
        .mls
        .encrypt(&clients[0].dev.store, group, &content)
        .unwrap();
    clients[0].dev.store.commit();
    // Another device's Commit lands first.
    let update = clients[1]
        .dev
        .mls
        .self_update(&clients[1].dev.store, group)
        .unwrap();
    clients[1].submit(&mut server, &update).unwrap();
    assert!(matches!(
        server.send(clients[0].device(), &first),
        Err(Refusal::StaleEpoch { .. })
    ));

    clients[0].sync(&mut server, &directory);
    let again = clients[0]
        .dev
        .mls
        .reencrypt(&clients[0].dev.store, &first)
        .unwrap();
    clients[0].dev.store.commit();
    assert_eq!(again.message_id, first.message_id);
    assert_eq!(again.content, first.content);
    assert_eq!(*again.franking_key, *first.franking_key);
    assert_eq!(again.epoch, first.epoch + 1);
    server.send(clients[0].device(), &again).unwrap();
    clients[1].sync(&mut server, &directory);
    assert_eq!(clients[1].reads(&content.id), Some(&text("late")));
}

/// The re-add path: the device asks with a signed request, a ranked device verifies it, claims
/// a one-time package and commits the remove and add in one Commit.
fn readd(
    clients: &mut [Client],
    lost: usize,
    committer: usize,
    server: &mut Sequencer,
    directory: &Directory,
) {
    let group = clients[lost].group(server);
    let request = clients[lost]
        .dev
        .mls
        .prepare_readd(&clients[lost].dev.store, group)
        .unwrap();
    clients[lost].dev.store.commit();
    clients[lost].incarnation = None;
    let statement = sign(
        &clients[lost].dev.device_key,
        READD_CONTEXT,
        request.payload(),
    );
    server.request_readd(clients[lost].device(), statement);
    // Only key packages uploaded after the request serve a re-add.
    let (device, statement) = server.readd_targets().remove(0);
    assert!(matches!(
        server.claim(clients[committer].device(), std::slice::from_ref(&device)),
        Err(Refusal::Validation(_))
    ));
    clients[lost].upload(server, 2);

    let verified = server
        .verify_readd(&statement, &tagged_public(&clients[lost].dev.device_key))
        .unwrap();
    assert_eq!(verified.device, device);
    clients[committer].sync(server, directory);
    let claimed = server
        .claim(clients[committer].device(), std::slice::from_ref(&device))
        .unwrap();
    let group = clients[committer].group(server);
    let outgoing = clients[committer]
        .dev
        .mls
        .commit(&clients[committer].dev.store, group, &claimed, &[device])
        .unwrap();
    clients[committer].dev.store.commit();
    clients[committer].submit(server, &outgoing).unwrap();
}

#[test]
fn a_device_offline_past_retention_is_readded() {
    let mut server = Sequencer::new();
    server.retention = Some(3);
    let mut clients = population(&mut server, 2, 2);
    let directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);

    // Device 4 goes offline while the group moves on five epochs.
    for _ in 0..5 {
        let group = clients[0].group(&server);
        let update = clients[0]
            .dev
            .mls
            .self_update(&clients[0].dev.store, group)
            .unwrap();
        clients[0].submit(&mut server, &update).unwrap();
        for online in &mut clients[1..3] {
            online.sync(&mut server, &directory);
        }
    }
    let missed = clients[1].send(&mut server, "while offline").unwrap();
    let offline_epoch = clients[3].epoch(&server).unwrap();
    assert_eq!(offline_epoch, 1);
    assert!(server.commit_at(offline_epoch).is_none());

    clients[3].sync(&mut server, &directory);
    assert_eq!(
        clients[3].epoch(&server),
        Some(offline_epoch),
        "stuck: the Commit it needs is gone"
    );
    readd(&mut clients, 3, 1, &mut server, &directory);
    sync_all(&mut clients, &mut server, &directory);
    let after = clients[0].send(&mut server, "welcome back").unwrap();
    sync_all(&mut clients, &mut server, &directory);
    assert_eq!(clients[3].reads(&missed), Some(&Shown::Placeholder));
    assert_eq!(clients[3].reads(&after), Some(&text("welcome back")));
    for client in &clients {
        assert!(client.unverified.is_empty());
    }
}

#[test]
fn a_device_that_lost_its_state_is_readded_with_a_new_key() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 2, 2);
    let directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);
    let old_key = clients[2]
        .dev
        .mls
        .mls_key_statement(&clients[2].dev.store)
        .unwrap();

    // The store is gone: a new MLS key and statement under the same device key.
    clients[2].dev.store = crate::MemoryStore::new();
    clients[2].dev.enroll();
    assert_ne!(
        clients[2]
            .dev
            .mls
            .mls_key_statement(&clients[2].dev.store)
            .unwrap(),
        old_key
    );
    let group = clients[2].group(&server);
    assert!(matches!(
        clients[2]
            .dev
            .mls
            .group_status(&clients[2].dev.store, group),
        Err(Error::NoGroup)
    ));
    readd(&mut clients, 2, 0, &mut server, &directory);
    sync_all(&mut clients, &mut server, &directory);
    let id = clients[1].send(&mut server, "new key").unwrap();
    sync_all(&mut clients, &mut server, &directory);
    assert_eq!(clients[2].reads(&id), Some(&text("new key")));
    assert!(clients.iter().all(|c| c.unverified.is_empty()));
}

#[test]
fn a_commit_that_cannot_be_processed_stops_the_device_until_a_readd() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 2, 1);
    let directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);

    let group = clients[0].group(&server);
    let update = clients[0]
        .dev
        .mls
        .self_update(&clients[0].dev.store, group)
        .unwrap();
    clients[0].submit(&mut server, &update).unwrap();
    // The device receives a corrupted copy of the Commit.
    let mut corrupted = update.commit.clone();
    let last = corrupted.len() - 1;
    corrupted[last] ^= 1;
    let outcome = clients[1].apply_commit(&server, &corrupted, &directory);
    assert!(
        matches!(outcome, CommitOutcome::CannotProcess { epoch: 1, .. }),
        "{outcome:?}"
    );
    let status = clients[1]
        .dev
        .mls
        .group_status(&clients[1].dev.store, group)
        .unwrap();
    assert_eq!(status.awaiting_readd, Some(1));
    assert!(matches!(
        clients[1].dev.mls.encrypt(
            &clients[1].dev.store,
            group,
            &MessageContent::new(Uuid::now_v7(), "x")
        ),
        Err(Error::AwaitingReadd(1))
    ));
    let request = clients[1]
        .dev
        .mls
        .prepare_readd(&clients[1].dev.store, group)
        .unwrap();
    assert_eq!(request.last_epoch, Some(1));
    clients[1].dev.store.rollback();

    readd(&mut clients, 1, 0, &mut server, &directory);
    sync_all(&mut clients, &mut server, &directory);
    let id = clients[0].send(&mut server, "back in").unwrap();
    sync_all(&mut clients, &mut server, &directory);
    assert_eq!(clients[1].reads(&id), Some(&text("back in")));
}

#[test]
fn a_commit_adding_a_key_package_that_expired_meanwhile_cannot_be_processed() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 2, 1);
    let directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);

    // A key package whose lifetime ends one second from now. The server never hands out one
    // this close to expiry; a committer that got it anyway adds it.
    let newcomer = Client::new(1, 2);
    let mut packages = crate::provider::with_crypto!(&newcomer.dev.mls.backend, |crypto| {
        crate::device::generate_key_packages(
            crypto,
            crate::storage::sealed::Sealed::backend(&newcomer.dev.store),
            1,
            false,
            now(),
            (now() - 60, now() + 1),
        )
    })
    .unwrap();
    newcomer.dev.store.commit();
    server.upload(newcomer.device(), packages.clone());
    assert!(matches!(
        server.claim(clients[0].device(), &[newcomer.device().clone()]),
        Err(Refusal::Validation(_))
    ));
    let group = clients[0].group(&server);
    let claimed = crate::ClaimedKeyPackage {
        device: newcomer.device().clone(),
        key_package: packages.remove(0).message,
    };
    let outgoing = clients[0]
        .dev
        .mls
        .commit(&clients[0].dev.store, group, &[claimed], &[])
        .unwrap();
    clients[0]
        .dev
        .mls
        .commit_accepted(&clients[0].dev.store, group)
        .unwrap();
    super::support::wait(std::time::Duration::from_millis(2100));

    // A device that processes the Commit later refuses it (OpenMLS checks an added key
    // package's lifetime when it processes the Commit) and needs a re-add.
    assert!(matches!(
        clients[1].apply_commit(&server, &outgoing.commit, &directory),
        CommitOutcome::CannotProcess { .. }
    ));
}

#[test]
fn an_incarnation_replaces_the_group() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 2, 2);
    let directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);
    let old = clients[1].send(&mut server, "first incarnation").unwrap();
    sync_all(&mut clients, &mut server, &directory);
    let stale = clients[1]
        .dev
        .mls
        .encrypt(
            &clients[1].dev.store,
            clients[1].group(&server),
            &MessageContent::new(Uuid::now_v7(), "stale"),
        )
        .unwrap();

    // A group device starts incarnation 2 with every current device.
    for client in &clients {
        client.upload(&mut server, 1);
    }
    assert_eq!(clients[0].create(&mut server, 2), Ok(1));
    assert_eq!(server.incarnation(), 2);

    // The old group is retired: its messages are refused.
    assert!(matches!(
        server.send(clients[1].device(), &stale),
        Err(Refusal::StaleEpoch { incarnation: 2, .. })
    ));
    sync_all(&mut clients, &mut server, &directory);
    for client in &clients {
        assert_eq!(client.incarnation, Some(2));
        let retired = ConversationGroup::new(server.conversation, 1);
        assert!(matches!(
            client.dev.mls.group_status(&client.dev.store, retired),
            Err(Error::NoGroup)
        ));
        // Old messages stay readable from the local cache.
        assert_eq!(client.reads(&old), Some(&text("first incarnation")));
    }
    let new = clients[3].send(&mut server, "second incarnation").unwrap();
    sync_all(&mut clients, &mut server, &directory);
    for client in &clients {
        assert_eq!(client.reads(&new), Some(&text("second incarnation")));
    }
}

#[test]
fn a_message_decrypts_once() {
    let mut server = Sequencer::new();
    let mut clients = population(&mut server, 2, 1);
    let directory = directory_of(&clients.iter().collect::<Vec<_>>());
    clients[0].create(&mut server, 1).unwrap();
    sync_all(&mut clients, &mut server, &directory);
    let id = clients[0].send(&mut server, "once").unwrap();
    let envelope = server.feed[0].envelope.clone();
    let expected = DecryptExpectations {
        message_id: id,
        thread_root_id: None,
        author_principal_id: None,
    };
    let group = clients[1].group(&server);
    let receiver = &clients[1].dev;
    assert!(matches!(
        receiver
            .mls
            .decrypt(&receiver.store, group, &envelope, &expected)
            .unwrap(),
        Decrypted::Message(_)
    ));
    receiver.store.commit();
    assert!(matches!(
        receiver
            .mls
            .decrypt(&receiver.store, group, &envelope, &expected),
        Err(Error::Decrypt(_))
    ));
}

#[cfg(feature = "sqlite")]
#[test]
fn a_crash_between_decrypt_and_store_leaves_both_undone() {
    use rusqlite::Connection;

    let sender = TestDevice::new(Provider::Libcrux, 1, 1);
    let mls = crate::Mls::new().unwrap();
    let receiver = super::support::device_ref(2, 1);
    let device_key = super::support::device_signing_key(&receiver);

    let mut conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(crate::SCHEMA).unwrap();
    conn.execute_batch("CREATE TABLE plaintext (id TEXT PRIMARY KEY, body TEXT NOT NULL);")
        .unwrap();

    let tx = conn.transaction().unwrap();
    let store = crate::SqliteStore::new(&tx);
    mls.ensure_identity(&store, &receiver, &tagged_public(&device_key), |c, p| {
        sign(&device_key, c, p)
    })
    .unwrap();
    let package = mls
        .generate_key_packages(&store, 1, false, now())
        .unwrap()
        .remove(0);
    tx.commit().unwrap();

    let group = ConversationGroup::new(Uuid::now_v7(), 1);
    let created = sender
        .mls
        .create_group(
            &sender.store,
            group,
            &[crate::ClaimedKeyPackage {
                device: receiver.clone(),
                key_package: package.message,
            }],
        )
        .unwrap();
    sender.mls.commit_accepted(&sender.store, group).unwrap();
    let tx = conn.transaction().unwrap();
    mls.join(
        &crate::SqliteStore::new(&tx),
        group,
        created.welcome.as_ref().unwrap(),
    )
    .unwrap();
    tx.commit().unwrap();

    let content = MessageContent::new(Uuid::now_v7(), "atomic");
    let sent = sender.mls.encrypt(&sender.store, group, &content).unwrap();
    let expected = DecryptExpectations {
        message_id: content.id,
        thread_root_id: None,
        author_principal_id: None,
    };
    let decrypt_and_store = |conn: &mut Connection, commit: bool| {
        let tx = conn.transaction().unwrap();
        let result = mls.decrypt(
            &crate::SqliteStore::new(&tx),
            group,
            &sent.envelope,
            &expected,
        );
        if let Ok(Decrypted::Message(message)) = &result {
            tx.execute(
                "INSERT INTO plaintext (id, body) VALUES (?1, ?2)",
                rusqlite::params![message.content.id.to_string(), message.content.body],
            )
            .unwrap();
            if commit {
                tx.commit().unwrap();
            }
        }
        result.is_ok()
    };
    let rows = |conn: &Connection| -> i64 {
        conn.query_row("SELECT count(*) FROM plaintext", [], |row| row.get(0))
            .unwrap()
    };

    // Decrypted and stored, then the process dies before the commit: both are undone.
    assert!(decrypt_and_store(&mut conn, false));
    assert_eq!(rows(&conn), 0);
    // So the message still decrypts, once.
    assert!(decrypt_and_store(&mut conn, true));
    assert_eq!(rows(&conn), 1);
    assert!(!decrypt_and_store(&mut conn, true));
}
