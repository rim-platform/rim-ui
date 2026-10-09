//! An in-process server for the simulations: it owns membership and devices, hands out key
//! packages, accepts one Commit per epoch, checks the authenticated data, and keeps the feed.

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};

use openmls::prelude::tls_codec::DeserializeBytes as _;
use openmls::prelude::{ContentType, MlsMessageBodyIn, MlsMessageIn, PrivateMessageIn};
use uuid::Uuid;

use super::support::now;
use crate::{
    AuthenticatedData, ClaimedKeyPackage, ConversationGroup, DeviceRef, EncryptedMessage,
    GeneratedKeyPackage, OutgoingCommit, ReaddRequest, SignedStatement,
};

/// Why the server refused a request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Refusal {
    StaleEpoch { incarnation: u32, epoch: u64 },
    CommitRequired,
    Forbidden,
    Validation(String),
}

/// A key package as uploaded: its bytes, ref, expiry, and when (in upload order) it arrived.
#[derive(Clone)]
struct Stored {
    message: Vec<u8>,
    key_package_ref: Vec<u8>,
    not_after: u64,
    uploaded: u64,
}

#[derive(Default)]
struct Packages {
    one_time: VecDeque<Stored>,
    last_resort: Option<Stored>,
}

/// A package expiring sooner than this is never handed out.
const MIN_REMAINING_SECS: u64 = 14 * 24 * 60 * 60;

/// The current incarnation's group as the server records it.
pub(crate) struct ServerGroup {
    pub(crate) incarnation: u32,
    /// The epoch the next Commit must be created in.
    pub(crate) epoch: u64,
    pub(crate) devices: BTreeSet<DeviceRef>,
    commits: BTreeMap<u64, Vec<u8>>,
    welcomes: Vec<(BTreeSet<DeviceRef>, Vec<u8>)>,
}

/// A message row of the feed.
#[derive(Clone)]
pub(crate) struct Row {
    pub(crate) id: Uuid,
    pub(crate) incarnation: u32,
    pub(crate) epoch: u64,
    pub(crate) envelope: Vec<u8>,
    pub(crate) author: String,
    pub(crate) sender_device: Uuid,
}

#[derive(Clone)]
struct Claim {
    by: DeviceRef,
    target: DeviceRef,
}

pub(crate) struct Sequencer {
    pub(crate) conversation: Uuid,
    pub(crate) members: BTreeSet<String>,
    /// The MLS-active devices of each principal: not revoked, with key packages.
    pub(crate) active: BTreeMap<String, BTreeSet<Uuid>>,
    packages: HashMap<DeviceRef, Packages>,
    claims: HashMap<Vec<u8>, Claim>,
    pub(crate) group: Option<ServerGroup>,
    pub(crate) feed: Vec<Row>,
    /// Re-add requests: the device, the request, its incarnation, and the upload count at the
    /// time (packages uploaded later are the ones a re-add may use).
    readds: Vec<(DeviceRef, SignedStatement, u32, u64)>,
    uploads: u64,
    /// Commits older than this many epochs are dropped.
    pub(crate) retention: Option<u64>,
}

fn private(bytes: &[u8]) -> PrivateMessageIn {
    match MlsMessageIn::tls_deserialize_exact_bytes(bytes)
        .expect("an MLSMessage")
        .extract()
    {
        MlsMessageBodyIn::PrivateMessage(message) => message,
        _ => panic!("not a PrivateMessage"),
    }
}

impl Sequencer {
    pub(crate) fn new() -> Self {
        Self {
            conversation: Uuid::now_v7(),
            members: BTreeSet::new(),
            active: BTreeMap::new(),
            packages: HashMap::new(),
            claims: HashMap::new(),
            group: None,
            feed: vec![],
            readds: vec![],
            uploads: 0,
            retention: None,
        }
    }

    pub(crate) fn incarnation(&self) -> u32 {
        self.group.as_ref().map_or(1, |g| g.incarnation)
    }

    pub(crate) fn desired(&self) -> BTreeSet<DeviceRef> {
        self.members
            .iter()
            .flat_map(|principal| {
                self.active
                    .get(principal)
                    .into_iter()
                    .flatten()
                    .map(move |device_id| DeviceRef {
                        principal_id: principal.clone(),
                        device_id: *device_id,
                    })
            })
            .collect()
    }

    fn group_devices(&self) -> BTreeSet<DeviceRef> {
        self.group
            .as_ref()
            .map(|g| g.devices.clone())
            .unwrap_or_default()
    }

    pub(crate) fn pending_adds(&self) -> Vec<DeviceRef> {
        let group = self.group_devices();
        self.desired()
            .into_iter()
            .filter(|device| !group.contains(device))
            .collect()
    }

    pub(crate) fn pending_removes(&self) -> Vec<DeviceRef> {
        let desired = self.desired();
        self.group_devices()
            .into_iter()
            .filter(|device| !desired.contains(device))
            .collect()
    }

    pub(crate) fn readd_targets(&self) -> Vec<(DeviceRef, SignedStatement)> {
        let incarnation = self.incarnation();
        self.readds
            .iter()
            .filter(|(_, _, at, _)| *at == incarnation)
            .map(|(device, statement, _, _)| (device.clone(), statement.clone()))
            .collect()
    }

    /// A device enrolls (or comes back) and uploads key packages.
    pub(crate) fn upload(&mut self, device: &DeviceRef, packages: Vec<GeneratedKeyPackage>) {
        self.active
            .entry(device.principal_id.clone())
            .or_default()
            .insert(device.device_id);
        let stored = self.packages.entry(device.clone()).or_default();
        for package in packages {
            self.uploads += 1;
            let entry = Stored {
                message: package.message,
                key_package_ref: package.key_package_ref,
                not_after: package.not_after,
                uploaded: self.uploads,
            };
            if package.last_resort {
                stored.last_resort = Some(entry);
            } else {
                stored.one_time.push_back(entry);
            }
        }
    }

    pub(crate) fn revoke(&mut self, device: &DeviceRef) {
        if let Some(devices) = self.active.get_mut(&device.principal_id) {
            devices.remove(&device.device_id);
        }
        self.packages.remove(device);
    }

    pub(crate) fn request_readd(&mut self, device: &DeviceRef, statement: SignedStatement) {
        let incarnation = self.incarnation();
        self.readds
            .push((device.clone(), statement, incarnation, self.uploads));
    }

    fn is_group_device(&self, device: &DeviceRef) -> bool {
        self.group_devices().contains(device)
    }

    /// `claimMlsKeyPackages` for pending adds and re-add targets.
    pub(crate) fn claim(
        &mut self,
        caller: &DeviceRef,
        targets: &[DeviceRef],
    ) -> Result<Vec<ClaimedKeyPackage>, Refusal> {
        let mut allowed = self.pending_adds();
        allowed.extend(self.readd_targets().into_iter().map(|(d, _)| d));
        self.claim_among(caller, targets, &allowed)
    }

    /// Claims for the first Commit of the next incarnation: the current group devices and the
    /// pending adds, but not the caller.
    pub(crate) fn claim_for_incarnation(
        &mut self,
        caller: &DeviceRef,
        targets: &[DeviceRef],
    ) -> Result<Vec<ClaimedKeyPackage>, Refusal> {
        let allowed: Vec<DeviceRef> = self
            .group_devices()
            .into_iter()
            .chain(self.pending_adds())
            .filter(|d| d != caller)
            .collect();
        self.claim_among(caller, targets, &allowed)
    }

    fn claim_among(
        &mut self,
        caller: &DeviceRef,
        targets: &[DeviceRef],
        allowed: &[DeviceRef],
    ) -> Result<Vec<ClaimedKeyPackage>, Refusal> {
        let permitted = match &self.group {
            Some(_) => self.is_group_device(caller),
            None => self.members.contains(&caller.principal_id),
        };
        if !permitted {
            return Err(Refusal::Forbidden);
        }
        let incarnation = self.incarnation();
        let earliest = now() + MIN_REMAINING_SECS;
        let mut claimed = vec![];
        for target in targets {
            if !allowed.contains(target) {
                return Err(Refusal::Validation("not a pending add".into()));
            }
            let readd_after = self
                .readds
                .iter()
                .filter(|(device, _, at, _)| device == target && *at == incarnation)
                .map(|(_, _, _, uploads)| *uploads)
                .max();
            let packages = self.packages.entry(target.clone()).or_default();
            packages.one_time.retain(|p| p.not_after >= earliest);
            let usable = |p: &Stored| p.not_after >= earliest;
            let one_time = match readd_after {
                // A re-add takes the newest one-time package uploaded after the request (older
                // ones may belong to the lost state), never the last-resort one.
                Some(after) => match packages.one_time.back() {
                    Some(newest) if newest.uploaded > after => packages.one_time.pop_back(),
                    _ => {
                        return Err(Refusal::Validation(
                            "the device has not uploaded key packages since its re-add request"
                                .into(),
                        ))
                    }
                },
                None => packages.one_time.pop_front(),
            };
            let Stored {
                message,
                key_package_ref,
                ..
            } = match one_time {
                Some(package) => package,
                None => packages
                    .last_resort
                    .clone()
                    .filter(usable)
                    .ok_or_else(|| Refusal::Validation("no key package".into()))?,
            };
            self.claims.insert(
                key_package_ref,
                Claim {
                    by: caller.clone(),
                    target: target.clone(),
                },
            );
            claimed.push(ClaimedKeyPackage {
                device: target.clone(),
                key_package: message,
            });
        }
        Ok(claimed)
    }

    /// `submitMlsCommit`: one Commit per epoch, its summary checked against the members, the
    /// pending changes and the claims.
    pub(crate) fn submit_commit(
        &mut self,
        caller: &DeviceRef,
        commit: &OutgoingCommit,
    ) -> Result<u64, Refusal> {
        let header = private(&commit.commit);
        let expected_group = ConversationGroup::from_group_id(header.group_id().as_slice())
            .filter(|g| g.conversation_id == self.conversation)
            .ok_or_else(|| Refusal::Validation("another conversation".into()))?;
        if header.content_type() != ContentType::Commit {
            return Err(Refusal::Validation("not a commit".into()));
        }
        let current = self.incarnation();
        let first_of_next = self.group.is_some() && expected_group.incarnation == current + 1;
        let new_group = self.group.is_none() || first_of_next;
        if new_group {
            if header.epoch().as_u64() != 0 {
                return Err(Refusal::StaleEpoch {
                    incarnation: current,
                    epoch: self.group.as_ref().map_or(0, |g| g.epoch),
                });
            }
            if first_of_next && !self.is_group_device(caller) {
                return Err(Refusal::Forbidden);
            }
            if self.group.is_none() && expected_group.incarnation != 1 {
                return Err(Refusal::Validation("the first incarnation is 1".into()));
            }
        } else {
            let group = self.group.as_ref().expect("a group");
            if expected_group.incarnation < group.incarnation {
                return Err(Refusal::StaleEpoch {
                    incarnation: group.incarnation,
                    epoch: group.epoch,
                });
            }
            if expected_group.incarnation != group.incarnation {
                return Err(Refusal::Validation("unknown incarnation".into()));
            }
            if !group.devices.contains(caller) || self.pending_removes().contains(caller) {
                return Err(Refusal::Forbidden);
            }
            if header.epoch().as_u64() != group.epoch {
                return Err(Refusal::StaleEpoch {
                    incarnation: group.incarnation,
                    epoch: group.epoch,
                });
            }
        }

        let AuthenticatedData::Commit(summary) = AuthenticatedData::parse(header.aad())
            .map_err(|e| Refusal::Validation(e.to_string()))?
        else {
            return Err(Refusal::Validation("not a commit summary".into()));
        };
        let readds: Vec<DeviceRef> = self.readd_targets().into_iter().map(|(d, _)| d).collect();
        let addable: Vec<DeviceRef> = if new_group {
            self.desired().into_iter().filter(|d| d != caller).collect()
        } else {
            self.pending_adds()
                .into_iter()
                .chain(readds.clone())
                .collect()
        };
        let mut devices = if new_group {
            BTreeSet::from([caller.clone()])
        } else {
            self.group_devices()
        };
        for remove in &summary.removes {
            let re_added =
                readds.contains(remove) && summary.adds.iter().any(|add| &add.device == remove);
            if !devices.contains(remove)
                || !(self.pending_removes().contains(remove) || re_added)
                || remove == caller
            {
                return Err(Refusal::Validation("not a removable device".into()));
            }
            devices.remove(remove);
        }
        for add in &summary.adds {
            if !addable.contains(&add.device) {
                return Err(Refusal::Validation("not a pending add".into()));
            }
            let claim = self
                .claims
                .get(&add.key_package_ref)
                .ok_or_else(|| Refusal::Validation("an unclaimed key package".into()))?;
            if claim.by != *caller || claim.target != add.device {
                return Err(Refusal::Validation(
                    "a key package claimed for another".into(),
                ));
            }
            devices.insert(add.device.clone());
        }
        if new_group {
            let covered: BTreeSet<&String> = devices.iter().map(|d| &d.principal_id).collect();
            if self.members.iter().any(|member| !covered.contains(member)) {
                return Err(Refusal::Validation(
                    "every member needs at least one device in the group".into(),
                ));
            }
        }
        if !summary.adds.is_empty() && commit.welcome.is_none() {
            return Err(Refusal::Validation("adds need a welcome".into()));
        }

        // Accepted.
        for add in &summary.adds {
            self.claims.remove(&add.key_package_ref);
        }
        let added: BTreeSet<DeviceRef> = summary.adds.iter().map(|a| a.device.clone()).collect();
        self.readds
            .retain(|(device, _, _, _)| !added.contains(device));
        let mut group = if new_group {
            ServerGroup {
                incarnation: expected_group.incarnation,
                epoch: 0,
                devices: BTreeSet::new(),
                commits: BTreeMap::new(),
                welcomes: vec![],
            }
        } else {
            self.group.take().expect("a group")
        };
        group.commits.insert(group.epoch, commit.commit.clone());
        group.epoch += 1;
        group.devices = devices;
        if let Some(welcome) = &commit.welcome {
            group.welcomes.push((added, welcome.clone()));
        }
        let epoch = group.epoch;
        self.group = Some(group);
        Ok(epoch)
    }

    /// `sendEncryptedMessage`.
    pub(crate) fn send(
        &mut self,
        caller: &DeviceRef,
        message: &EncryptedMessage,
    ) -> Result<(), Refusal> {
        let group = self.group.as_ref().ok_or(Refusal::CommitRequired)?;
        if !group.devices.contains(caller) || self.pending_removes().contains(caller) {
            return Err(Refusal::Forbidden);
        }
        let header = private(&message.envelope);
        let named = ConversationGroup::from_group_id(header.group_id().as_slice())
            .filter(|g| g.conversation_id == self.conversation)
            .ok_or_else(|| Refusal::Validation("another conversation".into()))?;
        if named.incarnation != group.incarnation || header.epoch().as_u64() != group.epoch {
            return Err(Refusal::StaleEpoch {
                incarnation: group.incarnation,
                epoch: group.epoch,
            });
        }
        if !self.pending_removes().is_empty() {
            return Err(Refusal::CommitRequired);
        }
        match AuthenticatedData::parse(header.aad()) {
            Ok(AuthenticatedData::Application(aad)) if aad.message_id == message.message_id => {}
            _ => return Err(Refusal::Validation("authenticated data".into())),
        }
        self.feed.push(Row {
            id: message.message_id,
            incarnation: group.incarnation,
            epoch: group.epoch,
            envelope: message.envelope.clone(),
            author: caller.principal_id.clone(),
            sender_device: caller.device_id,
        });
        Ok(())
    }

    /// `mlsCommits(afterEpoch)` from `from_epoch` on, within retention.
    pub(crate) fn commits_from(&self, incarnation: u32, from_epoch: u64) -> Vec<(u64, Vec<u8>)> {
        let Some(group) = self.group.as_ref().filter(|g| g.incarnation == incarnation) else {
            return vec![];
        };
        let oldest = self
            .retention
            .map_or(0, |keep| group.epoch.saturating_sub(keep));
        group
            .commits
            .range(from_epoch.max(oldest)..)
            .map(|(epoch, bytes)| (*epoch, bytes.clone()))
            .collect()
    }

    /// The Commit created in `epoch`, while retained.
    pub(crate) fn commit_at(&self, epoch: u64) -> Option<Vec<u8>> {
        let group = self.group.as_ref()?;
        self.commits_from(group.incarnation, epoch)
            .into_iter()
            .find(|(at, _)| *at == epoch)
            .map(|(_, bytes)| bytes)
    }

    /// `myMlsWelcomes` for a device of the current incarnation; acknowledged by taking them.
    pub(crate) fn take_welcomes(&mut self, device: &DeviceRef) -> Vec<(u32, Vec<u8>)> {
        let Some(group) = self.group.as_mut() else {
            return vec![];
        };
        let mut found = vec![];
        for (recipients, bytes) in &mut group.welcomes {
            if recipients.remove(device) {
                found.push((group.incarnation, bytes.clone()));
            }
        }
        found
    }

    /// The device's key, as its certificate names it, to check a re-add request against.
    pub(crate) fn verify_readd(
        &self,
        statement: &SignedStatement,
        device_key: &str,
    ) -> Option<ReaddRequest> {
        ReaddRequest::verify(statement, device_key)
            .ok()
            .filter(|request| request.group.conversation_id == self.conversation)
    }
}
