//! Who a group's leaves are: the app's [`DeviceDirectory`] over the key logs and device lists
//! the webview fetched (`keyLog`, `principalDevices`) and the conversation's members, with
//! devices verified before remembered in `e2ee_verified_device`.
//!
//! What the server answers is held to what this device saw before (`e2ee_peer`): a key log must
//! extend the head pinned for its principal (the first log verified here pins it), and a device
//! once seen revoked stays revoked. A direct message's members are its two pinned principals.
//!
//! A principal whose relay is another server arrives the same way, fetched through
//! `remoteIdentity`, with its profile card: the card must verify against the log's head, or
//! nothing that relay served about the principal is used.

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap, HashSet};

use rim_mls::{
    verify_leaves, DeviceDirectory, DeviceStatus, LeafError, Mls, ReaddRequest, SqliteStore,
};
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};

use super::group::{
    conversation_group, load_pin, load_state, may_honor_readd, save_state, DeviceView,
    UnverifiedDevice,
};
use super::{parse_uuid, Result};
use crate::key_identity::statement::{
    certified_device, replay, verified_card, verified_revocation, KeyHead, Statement,
};

/// A device of `principalDevices`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrincipalDeviceInput {
    pub device_id: String,
    pub certificate: Statement,
    #[serde(default)]
    pub revoked_at: Option<String>,
    #[serde(default)]
    pub revocation: Option<Statement>,
}

/// One principal's key log and devices, as the server answered; with the profile card when the
/// principal came from another relay.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrincipalInput {
    pub principal_id: String,
    pub key_log: Vec<Statement>,
    pub devices: Vec<PrincipalDeviceInput>,
    #[serde(default)]
    pub card: Option<Statement>,
}

/// What the webview hands in to check leaves: the conversation's members (principal ids) and
/// the principals it fetched. Devices of principals it did not fetch are answered from the
/// devices verified before.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryInput {
    pub members: Vec<String>,
    #[serde(default)]
    pub principals: Vec<PrincipalInput>,
}

/// What this device keeps about a principal (`e2ee_peer`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Peer {
    /// The seq and payload hash of the head of the longest key log verified here.
    pub head_seq: u32,
    pub head_hash: String,
    /// Device ids seen revoked, lowercase.
    pub revoked: BTreeSet<String>,
}

impl Peer {
    fn pinned_to(head: &KeyHead, revoked: BTreeSet<String>) -> Self {
        Self {
            head_seq: head.seq,
            head_hash: head.hash.clone(),
            revoked,
        }
    }

    /// Whether `head` is the pinned head or a log that extends it.
    fn extended_by(&self, head: &KeyHead) -> bool {
        head.hashes.get(self.head_seq as usize) == Some(&self.head_hash)
    }
}

pub(crate) fn load_peers(tx: &Transaction<'_>) -> Result<HashMap<String, Peer>> {
    let mut stmt =
        tx.prepare_cached("SELECT principal_id, head_seq, head_hash, revoked FROM e2ee_peer")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, u32>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let mut peers = HashMap::new();
    for row in rows {
        let (principal_id, head_seq, head_hash, revoked) = row?;
        peers.insert(
            principal_id,
            Peer {
                head_seq,
                head_hash,
                revoked: serde_json::from_str(&revoked)?,
            },
        );
    }
    Ok(peers)
}

fn save_peer(tx: &Transaction<'_>, principal_id: &str, peer: &Peer) -> Result<()> {
    tx.execute(
        "INSERT INTO e2ee_peer (principal_id, head_seq, head_hash, revoked)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (principal_id) DO UPDATE SET
             head_seq = excluded.head_seq,
             head_hash = excluded.head_hash,
             revoked = excluded.revoked",
        params![
            principal_id,
            peer.head_seq,
            peer.head_hash,
            serde_json::to_string(&peer.revoked)?
        ],
    )?;
    Ok(())
}

/// A [`DeviceDirectory`] over fetched principals and remembered devices.
pub(crate) struct Directory {
    members: HashSet<String>,
    fetched: HashSet<String>,
    invalid_logs: HashSet<String>,
    /// Principals whose served key log does not extend the head pinned here.
    forked: HashSet<String>,
    answers: HashMap<(String, String), DeviceStatus>,
    remembered: HashMap<(String, String), String>,
    /// What this device keeps about each principal, with what this directory learned.
    peers: HashMap<String, Peer>,
    /// Principals whose [`Peer`] changed, to store.
    changed: HashSet<String>,
    /// Principals asked about that were neither fetched nor remembered.
    missing: RefCell<HashSet<String>>,
}

impl Directory {
    /// The directory over `input`. `dm_principals` restricts a direct message's members to its
    /// two pinned principals, whoever else the server lists.
    pub(crate) fn new(
        input: &DirectoryInput,
        remembered: HashMap<(String, String), String>,
        peers: HashMap<String, Peer>,
        dm_principals: Option<&[String]>,
    ) -> Self {
        let members = input
            .members
            .iter()
            .filter(|m| dm_principals.is_none_or(|dm| dm.contains(m)))
            .cloned()
            .collect();
        let mut directory = Self {
            members,
            fetched: HashSet::new(),
            invalid_logs: HashSet::new(),
            forked: HashSet::new(),
            answers: HashMap::new(),
            remembered,
            peers,
            changed: HashSet::new(),
            missing: RefCell::new(HashSet::new()),
        };
        for principal in &input.principals {
            directory.add(principal);
        }
        directory
    }

    fn add(&mut self, principal: &PrincipalInput) {
        let principal_id = principal.principal_id.clone();
        self.fetched.insert(principal_id.clone());
        let head = match replay(&principal.key_log) {
            Ok(head) if head.principal_id == principal_id => head,
            _ => {
                self.invalid_logs.insert(principal_id);
                return;
            }
        };
        if let Some(card) = &principal.card {
            if let Err(e) = verified_card(card, &head) {
                log::warn!("[e2ee] the card served for {principal_id} does not verify: {e}");
                self.invalid_logs.insert(principal_id);
                return;
            }
        }
        let pinned = self.peers.get(&principal_id).cloned();
        if pinned.as_ref().is_some_and(|pin| !pin.extended_by(&head)) {
            log::warn!("[e2ee] a key log does not extend the head pinned for {principal_id}");
            self.invalid_logs.insert(principal_id.clone());
            self.forked.insert(principal_id);
            return;
        }
        let mut revoked = pinned
            .as_ref()
            .map(|p| p.revoked.clone())
            .unwrap_or_default();
        for device in &principal.devices {
            let Ok(card) = certified_device(&device.certificate, &head) else {
                continue;
            };
            if card.device_id != device.device_id {
                continue;
            }
            let device_id = device.device_id.to_lowercase();
            let signed = device
                .revocation
                .as_ref()
                .map(|r| verified_revocation(r, &head, &device.device_id, &card.device_key));
            if signed == Some(false) {
                log::warn!("[e2ee] a device revocation does not verify");
            }
            if device.revoked_at.is_some() || signed == Some(true) {
                revoked.insert(device_id.clone());
            }
            // An unverifiable revocation still keeps the device out, but is not remembered.
            let status = if revoked.contains(&device_id) || signed.is_some() {
                DeviceStatus::Revoked
            } else {
                DeviceStatus::Certified {
                    device_key: card.device_key,
                }
            };
            self.answers
                .insert((principal_id.clone(), device.device_id.clone()), status);
        }
        let peer = Peer::pinned_to(&head, revoked);
        if pinned.as_ref() != Some(&peer) {
            self.changed.insert(principal_id.clone());
            self.peers.insert(principal_id, peer);
        }
    }

    fn revoked(&self, principal_id: &str, device_id: &str) -> bool {
        self.peers
            .get(principal_id)
            .is_some_and(|p| p.revoked.contains(&device_id.to_lowercase()))
    }

    /// Store the heads pinned and revocations seen by this directory.
    pub(crate) fn save(&self, tx: &Transaction<'_>) -> Result<()> {
        for principal_id in &self.changed {
            if let Some(peer) = self.peers.get(principal_id) {
                save_peer(tx, principal_id, peer)?;
            }
        }
        Ok(())
    }

    /// The certified key of a device this directory vouches for.
    pub(crate) fn device_key(&self, principal_id: &str, device_id: &str) -> Option<String> {
        match self.lookup(principal_id, device_id) {
            DeviceStatus::Certified { device_key } => Some(device_key),
            _ => None,
        }
    }

    fn lookup(&self, principal_id: &str, device_id: &str) -> DeviceStatus {
        let key = (principal_id.to_string(), device_id.to_string());
        if self.invalid_logs.contains(principal_id) {
            return DeviceStatus::KeyLogInvalid;
        }
        if self.revoked(principal_id, device_id) {
            return DeviceStatus::Revoked;
        }
        if self.fetched.contains(principal_id) {
            return self
                .answers
                .get(&key)
                .cloned()
                .unwrap_or(DeviceStatus::Unknown);
        }
        match self.remembered.get(&key) {
            Some(device_key) => DeviceStatus::Certified {
                device_key: device_key.clone(),
            },
            None => {
                self.missing.borrow_mut().insert(principal_id.to_string());
                DeviceStatus::Unknown
            }
        }
    }
}

impl DeviceDirectory for Directory {
    fn device(&self, principal_id: &str, device_id: &uuid::Uuid) -> DeviceStatus {
        self.lookup(principal_id, &device_id.hyphenated().to_string())
    }

    fn is_member(&self, principal_id: &str) -> bool {
        self.members.contains(principal_id)
    }
}

/// The result of checking a group's leaves.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyOutcome {
    /// Principals whose key log and devices are needed before the leaves can be checked.
    pub missing: Vec<String>,
    /// Devices that failed, with the reason.
    pub unverified: Vec<UnverifiedDevice>,
}

fn remembered(tx: &Transaction<'_>) -> Result<HashMap<(String, String), String>> {
    let mut stmt =
        tx.prepare_cached("SELECT principal_id, device_id, device_key FROM e2ee_verified_device")?;
    let rows = stmt.query_map([], |row| Ok(((row.get(0)?, row.get(1)?), row.get(2)?)))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Check every leaf of the conversation's group. Devices of fetched principals that pass are
/// remembered (and those principals' other remembered devices forgotten); failures are kept
/// on the conversation, which then stops sending until they are gone.
pub(crate) fn verify(
    tx: &Transaction<'_>,
    mls: &Mls,
    workspace_id: &str,
    conversation_id: &str,
    input: &DirectoryInput,
) -> Result<VerifyOutcome> {
    let mut state = load_state(tx, workspace_id, conversation_id)?;
    if state.incarnation == 0 || state.removed {
        state.verify_pending = false;
        state.unverified.clear();
        save_state(tx, workspace_id, conversation_id, &state)?;
        return Ok(VerifyOutcome::default());
    }
    let group = conversation_group(conversation_id, state.incarnation)?;
    let leaves = match mls.leaves(&SqliteStore::new(tx), group) {
        Ok(leaves) => leaves,
        Err(rim_mls::Error::NoGroup) => return Ok(VerifyOutcome::default()),
        Err(e) => return Err(e.into()),
    };
    let dm = load_pin(tx, workspace_id, conversation_id)?.and_then(|p| p.dm_principals);
    let directory = Directory::new(input, remembered(tx)?, load_peers(tx)?, dm.as_deref());
    directory.save(tx)?;
    let problems = verify_leaves(&leaves, &directory);
    let missing = directory.missing.borrow().clone();
    if !missing.is_empty() {
        let mut missing: Vec<String> = missing.into_iter().collect();
        missing.sort();
        return Ok(VerifyOutcome {
            missing,
            unverified: vec![],
        });
    }

    for principal in &directory.fetched {
        tx.execute(
            "DELETE FROM e2ee_verified_device WHERE principal_id = ?1",
            params![principal],
        )?;
    }
    let failed: HashSet<u32> = problems.iter().map(|p| p.leaf.index).collect();
    for leaf in leaves.iter().filter(|leaf| !failed.contains(&leaf.index)) {
        let Some(device) = leaf.device() else {
            continue;
        };
        let device_id = device.device_id.hyphenated().to_string();
        if !directory.fetched.contains(&device.principal_id) {
            continue;
        }
        if let Some(device_key) = directory.device_key(&device.principal_id, &device_id) {
            tx.execute(
                "INSERT INTO e2ee_verified_device (principal_id, device_id, device_key)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT (principal_id, device_id) DO UPDATE SET device_key = excluded.device_key",
                params![device.principal_id, device_id, device_key],
            )?;
        }
    }

    state.unverified = problems
        .iter()
        .map(|problem| {
            let device = problem.leaf.device();
            UnverifiedDevice {
                principal_id: device
                    .as_ref()
                    .map(|d| d.principal_id.clone())
                    .unwrap_or_default(),
                device_id: device
                    .as_ref()
                    .map(|d| d.device_id.hyphenated().to_string())
                    .unwrap_or_default(),
                reason: match &device {
                    Some(d) if directory.forked.contains(&d.principal_id) => {
                        "keyLogForked".to_string()
                    }
                    _ => reason(&problem.error),
                },
            }
        })
        .collect();
    state.verify_pending = false;
    if state.unverified.is_empty() {
        state.misbehaved = None;
    }
    save_state(tx, workspace_id, conversation_id, &state)?;
    Ok(VerifyOutcome {
        missing: vec![],
        unverified: state.unverified,
    })
}

fn reason(error: &LeafError) -> String {
    match error {
        LeafError::BadCredential(_) => "badCredential",
        LeafError::KeyLogInvalid => "keyLogInvalid",
        LeafError::UnknownDevice => "unknownDevice",
        LeafError::RevokedDevice => "revokedDevice",
        LeafError::BadStatementSignature => "badStatementSignature",
        LeafError::KeyMismatch => "keyMismatch",
        LeafError::NotMember => "notMember",
        LeafError::DuplicateDevice => "duplicateDevice",
    }
    .to_string()
}

/// A re-add request as `Conversation.mlsGroup.readdRequests` lists it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReaddInput {
    pub principal_id: String,
    pub device_id: String,
    pub request: Statement,
}

/// The re-add requests this device may act on now: signed by the requesting device's
/// certified key, for this conversation's current incarnation, and not acted on for that device
/// in the last 24 hours.
pub(crate) fn honorable_readds(
    tx: &Transaction<'_>,
    workspace_id: &str,
    conversation_id: &str,
    requests: &[ReaddInput],
    input: &DirectoryInput,
) -> Result<Vec<DeviceView>> {
    let state = load_state(tx, workspace_id, conversation_id)?;
    let conversation = parse_uuid(conversation_id)?;
    let dm = load_pin(tx, workspace_id, conversation_id)?.and_then(|p| p.dm_principals);
    let directory = Directory::new(input, HashMap::new(), load_peers(tx)?, dm.as_deref());
    let mut honorable = Vec::new();
    for request in requests {
        let Some(device_key) = directory.device_key(&request.principal_id, &request.device_id)
        else {
            continue;
        };
        let statement = rim_mls::SignedStatement {
            payload: request.request.payload.clone(),
            signature: request.request.signature.clone(),
        };
        let Ok(verified) = ReaddRequest::verify(&statement, &device_key) else {
            log::warn!("[e2ee] ignoring a re-add request that does not verify");
            continue;
        };
        let names_this = verified.device.principal_id == request.principal_id
            && parse_uuid(&request.device_id).is_ok_and(|d| d == verified.device.device_id)
            && verified.group.conversation_id == conversation
            && verified.group.incarnation == state.incarnation;
        if names_this && may_honor_readd(tx, conversation_id, &request.device_id)? {
            honorable.push(DeviceView {
                principal_id: request.principal_id.clone(),
                device_id: request.device_id.clone(),
            });
        }
    }
    Ok(honorable)
}
