//! Group operations: create, commit membership changes, join, process Commits, encrypt and
//! decrypt, each over one store and in RIM's terms.

use openmls::prelude::tls_codec::{DeserializeBytes as _, Serialize as _};
use openmls::prelude::{
    BasicCredential, ContentType, Credential, GroupId, KeyPackage, KeyPackageIn, LeafNodeIndex,
    MlsGroup, MlsGroupJoinConfig, MlsMessageBodyIn, MlsMessageIn, MlsMessageOut, PrivateMessageIn,
    ProcessMessageError, ProcessedMessageContent, Proposal, ProtocolVersion,
    SenderRatchetConfiguration, StagedCommit, StagedWelcome, PURE_CIPHERTEXT_WIRE_FORMAT_POLICY,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::aad::{AddedDevice, ApplicationAad, AuthenticatedData, CommitSummary};
use crate::codec::{b64, unb64};
use crate::content::{application_data, split_application_data, MessageContent};
use crate::device::{capabilities, load_identity, Identity};
use crate::error::{Error, Result};
use crate::franking::franking_commitment;
use crate::group_id::ConversationGroup;
use crate::identity::{DeviceRef, Leaf};
use crate::provider::{Crypto, Provider};
use crate::storage::{sealed::Backend, KvStorage, Records};
use crate::CIPHER_SUITE;

const GROUP_LABEL: &str = "rim.group";

/// Padding of every PrivateMessage, in bytes.
const PADDING_SIZE: usize = 256;
/// Messages of a sender that may arrive out of order within an epoch.
const OUT_OF_ORDER_TOLERANCE: u32 = 32;
/// Messages of a sender that may be skipped within an epoch.
const MAXIMUM_FORWARD_DISTANCE: u32 = 10_000;
/// Past epochs whose secrets are kept, for messages that arrive after a Commit.
pub const MAX_PAST_EPOCHS: u64 = 2;
/// Largest application message envelope, in bytes.
pub const MAX_ENVELOPE_BYTES: usize = 96 * 1024;
/// Largest Commit or Welcome, in bytes.
pub const MAX_HANDSHAKE_BYTES: usize = 4 * 1024 * 1024;

/// This crate's record of a group, beside OpenMLS's state.
#[derive(Serialize, Deserialize, Default)]
struct GroupRecord {
    /// A Commit of this device that waits for the server's answer.
    pending_commit: Option<PendingCommit>,
    /// The epoch the group stopped at on a Commit it could not process.
    awaiting_readd: Option<u64>,
}

#[derive(Serialize, Deserialize)]
struct PendingCommit {
    /// The `MLSMessage` as sent, base64url.
    message: String,
    epoch: u64,
    /// The Commit is the first of a group this device created; refused, the group goes away.
    creates_group: bool,
}

/// A device's key package as the server handed it out.
#[derive(Debug, Clone)]
pub struct ClaimedKeyPackage {
    pub device: DeviceRef,
    /// The `MLSMessage` carrying the key package.
    pub key_package: Vec<u8>,
}

/// A Commit to send with `submitMlsCommit`. It stays pending until the server's answer is
/// passed to [`crate::Mls::commit_accepted`] or [`crate::Mls::commit_rejected`].
#[derive(Debug, Clone)]
pub struct OutgoingCommit {
    pub group: ConversationGroup,
    /// The epoch the Commit is created in.
    pub epoch: u64,
    pub cipher_suite: u16,
    /// The Commit's `MLSMessage`.
    pub commit: Vec<u8>,
    /// The Welcome's `MLSMessage`, when the Commit adds devices.
    pub welcome: Option<Vec<u8>>,
    /// The membership summary in the Commit's authenticated data.
    pub summary: CommitSummary,
}

/// What processing a Commit did.
#[derive(Debug, Clone)]
pub enum CommitOutcome {
    /// Another device's Commit, merged.
    Applied(AppliedCommit),
    /// This device's own pending Commit came back from the server and was merged.
    OwnMerged { epoch: u64 },
    /// The library refused the Commit: the group stays at `epoch` and waits for a re-add.
    CannotProcess { epoch: u64, reason: String },
}

/// A merged Commit of another device.
#[derive(Debug, Clone)]
pub struct AppliedCommit {
    /// The group's epoch after the Commit.
    pub epoch: u64,
    pub committer: Option<DeviceRef>,
    pub added: Vec<DeviceRef>,
    pub removed: Vec<DeviceRef>,
    /// Whether the authenticated-data summary names exactly the Commit's adds and removes.
    /// When it does not, the committing device misbehaved and every leaf needs checking.
    pub summary_matches: bool,
    /// Leaves that are new or changed their credential or key: check them.
    pub to_verify: Vec<Leaf>,
    /// This device was removed; its group state is deleted.
    pub self_removed: bool,
}

/// A group this device joined from a Welcome.
#[derive(Debug, Clone)]
pub struct Joined {
    pub group: ConversationGroup,
    pub epoch: u64,
    /// Every leaf of the group: check them all.
    pub leaves: Vec<Leaf>,
    pub welcomer: Option<DeviceRef>,
}

/// An encrypted message to send with `sendEncryptedMessage`.
#[derive(Debug, Clone)]
pub struct EncryptedMessage {
    pub group: ConversationGroup,
    pub message_id: Uuid,
    pub epoch: u64,
    /// The `MLSMessage` envelope.
    pub envelope: Vec<u8>,
    /// The exact content bytes (the plaintext to store, and to reveal in a report).
    pub content: Vec<u8>,
    pub franking_key: Zeroizing<[u8; 32]>,
    pub commitment: [u8; 32],
}

/// What the row an envelope arrived in says about the message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptExpectations {
    /// The row's message id.
    pub message_id: Uuid,
    /// The row's thread root, for a thread reply.
    pub thread_root_id: Option<Uuid>,
    /// The row author's principal id, when known (edits must come from the author).
    pub author_principal_id: Option<String>,
}

/// The result of decrypting an envelope. The key is used up either way.
#[derive(Debug, Clone)]
pub enum Decrypted {
    Message(Box<DecryptedMessage>),
    /// The envelope decrypted but breaks a rule: show that the message could not be verified,
    /// never its content.
    Invalid {
        sender: Option<DeviceRef>,
        reason: String,
    },
    /// One of this device's own messages; it keeps the plaintext it stored when sending.
    Own,
}

/// A valid decrypted message.
#[derive(Debug, Clone)]
pub struct DecryptedMessage {
    pub sender: DeviceRef,
    pub epoch: u64,
    pub content: MessageContent,
    /// The exact content bytes, for a report.
    pub content_bytes: Vec<u8>,
    pub franking_key: Zeroizing<[u8; 32]>,
    pub commitment: [u8; 32],
}

/// Where a group stands on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroupStatus {
    pub epoch: u64,
    pub commit_pending: bool,
    pub awaiting_readd: Option<u64>,
}

fn join_config() -> MlsGroupJoinConfig {
    MlsGroupJoinConfig::builder()
        .wire_format_policy(PURE_CIPHERTEXT_WIRE_FORMAT_POLICY)
        .padding_size(PADDING_SIZE)
        .sender_ratchet_configuration(SenderRatchetConfiguration::new(
            OUT_OF_ORDER_TOLERANCE,
            MAXIMUM_FORWARD_DISTANCE,
        ))
        .max_past_epochs(MAX_PAST_EPOCHS as usize)
        .use_ratchet_tree_extension(true)
        .build()
}

fn openmls_group_id(group: &ConversationGroup) -> GroupId {
    GroupId::from_slice(&group.group_id())
}

fn records(backend: &dyn Backend) -> Records<'_> {
    Records::new(backend)
}

fn load_record(backend: &dyn Backend, group: &ConversationGroup) -> Result<GroupRecord> {
    Ok(records(backend)
        .get(GROUP_LABEL, &group.group_id())?
        .unwrap_or_default())
}

fn save_record(
    backend: &dyn Backend,
    group: &ConversationGroup,
    record: &GroupRecord,
) -> Result<()> {
    records(backend).put(GROUP_LABEL, &group.group_id(), record)
}

pub(crate) fn load_group<C: Crypto>(
    provider: &Provider<'_, C>,
    group: &ConversationGroup,
) -> Result<MlsGroup> {
    use openmls_traits::OpenMlsProvider as _;
    MlsGroup::load(provider.storage(), &openmls_group_id(group))?.ok_or(Error::NoGroup)
}

fn epoch_of(group: &MlsGroup) -> u64 {
    group.epoch().as_u64()
}

/// Read an `MLSMessage` and return its body.
fn parse_message(bytes: &[u8], what: &'static str) -> Result<MlsMessageBodyIn> {
    let message =
        MlsMessageIn::tls_deserialize_exact_bytes(bytes).map_err(|e| Error::malformed(what, e))?;
    Ok(message.extract())
}

/// Read an `MLSMessage` that must be a PrivateMessage of `content_type` in `group`.
fn parse_private(
    bytes: &[u8],
    group: &ConversationGroup,
    content_type: ContentType,
    what: &'static str,
) -> Result<PrivateMessageIn> {
    let MlsMessageBodyIn::PrivateMessage(message) = parse_message(bytes, what)? else {
        return Err(Error::malformed(what, "not a PrivateMessage"));
    };
    if message.group_id().as_slice() != group.group_id() {
        return Err(Error::WrongGroup);
    }
    if message.content_type() != content_type {
        return Err(Error::malformed(what, "wrong content type"));
    }
    Ok(message)
}

pub(crate) fn to_bytes(message: &MlsMessageOut) -> Result<Vec<u8>> {
    message.tls_serialize_detached().map_err(Error::mls)
}

/// The device a credential names, if it is a valid `mls-key` credential.
fn credential_device(credential: &Credential) -> Option<DeviceRef> {
    let identity = BasicCredential::try_from(credential.clone()).ok()?;
    Leaf::new(0, vec![], Some(identity.identity())).device()
}

fn leaf_of(index: u32, signature_key: Vec<u8>, credential: &Credential) -> Leaf {
    let identity = BasicCredential::try_from(credential.clone()).ok();
    Leaf::new(
        index,
        signature_key,
        identity.as_ref().map(|i| i.identity()),
    )
}

/// Every leaf of `group`.
pub(crate) fn leaves(group: &MlsGroup) -> Vec<Leaf> {
    group
        .members()
        .map(|member| leaf_of(member.index.u32(), member.signature_key, &member.credential))
        .collect()
}

pub(crate) fn leaf_index_of(group: &MlsGroup, device: &DeviceRef) -> Result<LeafNodeIndex> {
    group
        .members()
        .find(|member| credential_device(&member.credential).as_ref() == Some(device))
        .map(|member| member.index)
        .ok_or_else(|| Error::NotInGroup(format!("{}/{}", device.principal_id, device.device_id)))
}

/// Read a claimed key package and check that it is valid and names the device it was claimed for.
fn claimed_key_package<C: Crypto>(
    crypto: &C,
    claimed: &ClaimedKeyPackage,
) -> Result<(KeyPackage, Vec<u8>)> {
    let MlsMessageBodyIn::KeyPackage(key_package) =
        parse_message(&claimed.key_package, "key package")?
    else {
        return Err(Error::malformed("key package", "not a KeyPackage"));
    };
    let key_package: KeyPackage =
        KeyPackageIn::validate(key_package, crypto, ProtocolVersion::Mls10)
            .map_err(|e| Error::Invalid(format!("key package: {e:?}")))?;
    if key_package.ciphersuite() != CIPHER_SUITE {
        return Err(Error::Invalid("key package: another cipher suite".into()));
    }
    if credential_device(key_package.leaf_node().credential()).as_ref() != Some(&claimed.device) {
        return Err(Error::Invalid(
            "key package: the credential names another device".into(),
        ));
    }
    let key_package_ref = key_package
        .hash_ref(crypto)
        .map_err(Error::mls)?
        .as_slice()
        .to_vec();
    Ok((key_package, key_package_ref))
}

fn check_operational(record: &GroupRecord) -> Result<()> {
    if let Some(epoch) = record.awaiting_readd {
        return Err(Error::AwaitingReadd(epoch));
    }
    if record.pending_commit.is_some() {
        return Err(Error::CommitPending);
    }
    Ok(())
}

/// Build and stage a Commit with `adds` and `removes` and an update path, with its summary as
/// authenticated data.
fn stage_commit<C: Crypto>(
    crypto: &C,
    provider: &Provider<'_, C>,
    identity: &Identity,
    mls_group: &mut MlsGroup,
    group: &ConversationGroup,
    adds: &[ClaimedKeyPackage],
    removes: &[DeviceRef],
) -> Result<(OutgoingCommit, PendingCommit)> {
    use openmls_traits::OpenMlsProvider as _;
    let mut key_packages = Vec::with_capacity(adds.len());
    let mut summary = CommitSummary::default();
    for claimed in adds {
        let (key_package, key_package_ref) = claimed_key_package(crypto, claimed)?;
        key_packages.push(key_package);
        summary.adds.push(AddedDevice {
            device: claimed.device.clone(),
            key_package_ref,
        });
    }
    let mut indices = Vec::with_capacity(removes.len());
    for device in removes {
        indices.push(leaf_index_of(mls_group, device)?);
        summary.removes.push(device.clone());
    }
    let epoch = epoch_of(mls_group);
    mls_group.set_aad(summary.to_bytes());
    let signer = identity.signer(crypto);
    let bundle = mls_group
        .commit_builder()
        .propose_adds(key_packages)
        .propose_removals(indices)
        .force_self_update(true)
        .load_psks(provider.storage())
        .map_err(Error::mls)?
        .build(provider.rand(), provider.crypto(), &signer, |_| true)
        .map_err(Error::mls)?
        .stage_commit(provider)
        .map_err(Error::mls)?;
    let (commit, welcome, _group_info) = bundle.into_messages();
    let commit = to_bytes(&commit)?;
    let welcome = welcome.as_ref().map(to_bytes).transpose()?;
    if commit.len() > MAX_HANDSHAKE_BYTES
        || welcome
            .as_ref()
            .is_some_and(|w| w.len() > MAX_HANDSHAKE_BYTES)
    {
        return Err(Error::Invalid(
            "the Commit or its Welcome is larger than 4 MiB".into(),
        ));
    }
    let pending = PendingCommit {
        message: b64(&commit),
        epoch,
        creates_group: false,
    };
    Ok((
        OutgoingCommit {
            group: *group,
            epoch,
            cipher_suite: CIPHER_SUITE as u16,
            commit,
            welcome,
            summary,
        },
        pending,
    ))
}

/// Create the group at epoch 0 and stage its first Commit, which adds `adds`.
pub(crate) fn create<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
    adds: &[ClaimedKeyPackage],
) -> Result<OutgoingCommit> {
    let identity = load_identity(backend)?;
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let signer = identity.signer(crypto);
    let config = join_config();
    let mut mls_group = MlsGroup::builder()
        .with_group_id(openmls_group_id(&group))
        .ciphersuite(CIPHER_SUITE)
        .with_wire_format_policy(config.wire_format_policy())
        .padding_size(config.padding_size())
        .sender_ratchet_configuration(*config.sender_ratchet_configuration())
        .max_past_epochs(MAX_PAST_EPOCHS as usize)
        .use_ratchet_tree_extension(true)
        .with_capabilities(capabilities())
        .build(&provider, &signer, identity.credential())
        .map_err(|e| match e {
            openmls::group::NewGroupError::GroupAlreadyExists => {
                Error::Invalid("a group for this conversation and incarnation exists".into())
            }
            other => Error::mls(other),
        })?;
    let (outgoing, mut pending) = stage_commit(
        crypto,
        &provider,
        &identity,
        &mut mls_group,
        &group,
        adds,
        &[],
    )?;
    pending.creates_group = true;
    save_record(
        backend,
        &group,
        &GroupRecord {
            pending_commit: Some(pending),
            awaiting_readd: None,
        },
    )?;
    Ok(outgoing)
}

/// Stage a Commit of `adds` and `removes` (both may be empty: a self-update).
pub(crate) fn commit<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
    adds: &[ClaimedKeyPackage],
    removes: &[DeviceRef],
) -> Result<OutgoingCommit> {
    let identity = load_identity(backend)?;
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let mut record = load_record(backend, &group)?;
    check_operational(&record)?;
    let mut mls_group = load_group(&provider, &group)?;
    if removes.contains(&identity.device) {
        return Err(Error::Invalid(
            "a device cannot commit its own removal".into(),
        ));
    }
    let (outgoing, pending) = stage_commit(
        crypto,
        &provider,
        &identity,
        &mut mls_group,
        &group,
        adds,
        removes,
    )?;
    record.pending_commit = Some(pending);
    save_record(backend, &group, &record)?;
    Ok(outgoing)
}

/// Merge this device's pending Commit: the server accepted it.
pub(crate) fn commit_accepted<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
) -> Result<u64> {
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let mut record = load_record(backend, &group)?;
    if record.pending_commit.take().is_none() {
        return Err(Error::NoPendingCommit);
    }
    let mut mls_group = load_group(&provider, &group)?;
    mls_group
        .merge_pending_commit(&provider)
        .map_err(Error::mls)?;
    save_record(backend, &group, &record)?;
    Ok(epoch_of(&mls_group))
}

/// Drop this device's pending Commit: the server answered `STALE_EPOCH`. A refused first Commit
/// of a group this device created takes the whole group with it.
pub(crate) fn commit_rejected<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
) -> Result<()> {
    use openmls_traits::OpenMlsProvider as _;
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let mut record = load_record(backend, &group)?;
    let pending = record.pending_commit.take().ok_or(Error::NoPendingCommit)?;
    let mut mls_group = load_group(&provider, &group)?;
    if pending.creates_group {
        mls_group.delete(provider.storage())?;
        return records(backend).delete(GROUP_LABEL, &group.group_id());
    }
    mls_group.clear_pending_commit(provider.storage())?;
    save_record(backend, &group, &record)
}

/// Process a Commit fetched from the server for the group's current epoch.
pub(crate) fn process_commit<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
    bytes: &[u8],
) -> Result<CommitOutcome> {
    use openmls_traits::OpenMlsProvider as _;
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let mut record = load_record(backend, &group)?;
    if let Some(epoch) = record.awaiting_readd {
        return Err(Error::AwaitingReadd(epoch));
    }
    let message = parse_private(bytes, &group, ContentType::Commit, "commit")?;
    let mut mls_group = load_group(&provider, &group)?;
    let epoch = epoch_of(&mls_group);
    if message.epoch().as_u64() != epoch {
        return Err(Error::EpochMismatch {
            group: epoch,
            message: message.epoch().as_u64(),
        });
    }

    if let Some(pending) = record.pending_commit.take() {
        if unb64(&pending.message)? == bytes {
            mls_group
                .merge_pending_commit(&provider)
                .map_err(Error::mls)?;
            save_record(backend, &group, &record)?;
            return Ok(CommitOutcome::OwnMerged {
                epoch: epoch_of(&mls_group),
            });
        }
        // Another device's Commit won this epoch.
        mls_group.clear_pending_commit(provider.storage())?;
    }

    let before = leaves(&mls_group);
    let processed = match mls_group.process_message(&provider, message) {
        Ok(processed) => processed,
        Err(ProcessMessageError::StorageError(e)) => return Err(e.into()),
        Err(e) => return cannot_process(backend, &group, &mut record, epoch, format!("{e:?}")),
    };
    let committer = credential_device(processed.credential());
    let aad = processed.aad().to_vec();
    let staged = match processed.into_content() {
        ProcessedMessageContent::StagedCommitMessage(staged) => staged,
        other => {
            let reason = format!("not a Commit of another device: {other:?}");
            return cannot_process(backend, &group, &mut record, epoch, reason);
        }
    };
    let (summary_matches, added, removed) = check_summary(crypto, &staged, &before, &aad)?;
    let self_removed = staged.self_removed();
    mls_group
        .merge_staged_commit(&provider, *staged)
        .map_err(Error::mls)?;
    let new_epoch = epoch_of(&mls_group);
    let to_verify = if self_removed {
        vec![]
    } else {
        let after = leaves(&mls_group);
        after
            .into_iter()
            .filter(|leaf| !before.contains(leaf))
            .collect()
    };
    if self_removed {
        mls_group.delete(provider.storage())?;
        records(backend).delete(GROUP_LABEL, &group.group_id())?;
    } else {
        save_record(backend, &group, &record)?;
    }
    Ok(CommitOutcome::Applied(AppliedCommit {
        epoch: new_epoch,
        committer,
        added,
        removed,
        summary_matches,
        to_verify,
        self_removed,
    }))
}

fn cannot_process(
    backend: &dyn Backend,
    group: &ConversationGroup,
    record: &mut GroupRecord,
    epoch: u64,
    reason: String,
) -> Result<CommitOutcome> {
    record.awaiting_readd = Some(epoch);
    save_record(backend, group, record)?;
    Ok(CommitOutcome::CannotProcess { epoch, reason })
}

/// Whether the staged Commit adds exactly the summary's key packages (each naming the device the
/// summary says) and removes exactly the summary's devices, and nothing else. Returns the devices
/// it adds and removes.
fn check_summary<C: Crypto>(
    crypto: &C,
    staged: &StagedCommit,
    before: &[Leaf],
    aad: &[u8],
) -> Result<(bool, Vec<DeviceRef>, Vec<DeviceRef>)> {
    let mut added = Vec::new();
    let mut add_refs = Vec::new();
    for add in staged.add_proposals() {
        let key_package = add.add_proposal().key_package();
        let device = credential_device(key_package.leaf_node().credential());
        let key_package_ref = key_package
            .hash_ref(crypto)
            .map_err(Error::mls)?
            .as_slice()
            .to_vec();
        add_refs.push((device.clone(), key_package_ref));
        added.extend(device);
    }
    let mut removed = Vec::new();
    let mut removed_ok = true;
    for remove in staged.remove_proposals() {
        let index = remove.remove_proposal().removed().u32();
        match before
            .iter()
            .find(|leaf| leaf.index == index)
            .and_then(Leaf::device)
        {
            Some(device) => removed.push(device),
            None => removed_ok = false,
        }
    }
    let only_adds_and_removes = staged
        .queued_proposals()
        .all(|queued| matches!(queued.proposal(), Proposal::Add(_) | Proposal::Remove(_)));

    let Ok(AuthenticatedData::Commit(summary)) = AuthenticatedData::parse(aad) else {
        return Ok((false, added, removed));
    };
    let mut claimed_adds: Vec<(Option<DeviceRef>, Vec<u8>)> = summary
        .adds
        .iter()
        .map(|add| (Some(add.device.clone()), add.key_package_ref.clone()))
        .collect();
    let mut staged_adds = add_refs;
    claimed_adds.sort();
    staged_adds.sort();
    let mut claimed_removes = summary.removes.clone();
    let mut staged_removes = removed.clone();
    claimed_removes.sort();
    staged_removes.sort();
    let matches = removed_ok
        && only_adds_and_removes
        && claimed_adds == staged_adds
        && claimed_removes == staged_removes;
    Ok((matches, added, removed))
}

/// Join a group from a Welcome. The Welcome must be for `group`; an older state of the same group
/// on this device is replaced.
pub(crate) fn join<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
    welcome: &[u8],
) -> Result<Joined> {
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let MlsMessageBodyIn::Welcome(welcome) = parse_message(welcome, "welcome")? else {
        return Err(Error::malformed("welcome", "not a Welcome"));
    };
    let staged = StagedWelcome::build_from_welcome(&provider, &join_config(), welcome)
        .map_err(|e| Error::Mls(format!("welcome: {e:?}")))?
        // Leaves added from key packages keep their key package's lifetime until they commit;
        // RIM checks every leaf's certificate instead, and removes inactive devices itself.
        .skip_lifetime_validation()
        .replace_old_group()
        .build()
        .map_err(|e| Error::Mls(format!("welcome: {e:?}")))?;
    if staged.group_context().group_id().as_slice() != group.group_id() {
        return Err(Error::WrongGroup);
    }
    if staged.group_context().ciphersuite() != CIPHER_SUITE {
        return Err(Error::Invalid("the group uses another cipher suite".into()));
    }
    let welcomer = staged
        .welcome_sender()
        .ok()
        .and_then(|leaf| credential_device(leaf.credential()));
    let mls_group = staged.into_group(&provider).map_err(Error::mls)?;
    save_record(backend, &group, &GroupRecord::default())?;
    Ok(Joined {
        group,
        epoch: epoch_of(&mls_group),
        leaves: leaves(&mls_group),
        welcomer,
    })
}

/// Encrypt `content` (checked against the content rules) with a fresh franking key.
pub(crate) fn encrypt<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
    content: &MessageContent,
) -> Result<EncryptedMessage> {
    content.check()?;
    let mut franking_key = Zeroizing::new([0u8; 32]);
    getrandom::fill(franking_key.as_mut()).map_err(|e| Error::Crypto(format!("random: {e}")))?;
    encrypt_content(
        crypto,
        backend,
        group,
        content,
        &content.to_bytes(),
        franking_key,
    )
}

/// Encrypt an earlier message again in the group's current epoch, with the same content and
/// franking key: the resend after `STALE_EPOCH`.
pub(crate) fn reencrypt<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    previous: &EncryptedMessage,
) -> Result<EncryptedMessage> {
    let content = MessageContent::parse(&previous.content)?;
    encrypt_content(
        crypto,
        backend,
        previous.group,
        &content,
        &previous.content,
        previous.franking_key.clone(),
    )
}

pub(crate) fn encrypt_content<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
    content: &MessageContent,
    content_bytes: &[u8],
    franking_key: Zeroizing<[u8; 32]>,
) -> Result<EncryptedMessage> {
    let identity = load_identity(backend)?;
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let record = load_record(backend, &group)?;
    check_operational(&record)?;
    let mut mls_group = load_group(&provider, &group)?;
    let commitment = franking_commitment(&franking_key, content_bytes);
    let aad = ApplicationAad {
        message_id: content.id,
        franking: commitment,
        mentions: content.mentions.clone(),
        mention_all: content.mention_all,
    };
    mls_group.set_aad(aad.to_bytes());
    let data = application_data(&franking_key, content_bytes);
    let message = mls_group
        .create_message(&provider, &identity.signer(crypto), &data)
        .map_err(Error::mls)?;
    let envelope = to_bytes(&message)?;
    if envelope.len() > MAX_ENVELOPE_BYTES {
        return Err(Error::Invalid("the message is larger than 96 KiB".into()));
    }
    Ok(EncryptedMessage {
        group,
        message_id: content.id,
        epoch: epoch_of(&mls_group),
        envelope,
        content: content_bytes.to_vec(),
        franking_key,
        commitment,
    })
}

/// Decrypt an envelope once and check it against its row.
pub(crate) fn decrypt<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
    envelope: &[u8],
    expected: &DecryptExpectations,
) -> Result<Decrypted> {
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let record = load_record(backend, &group)?;
    if let Some(epoch) = record.awaiting_readd {
        return Err(Error::AwaitingReadd(epoch));
    }
    let message = parse_private(envelope, &group, ContentType::Application, "envelope")?;
    let mut mls_group = load_group(&provider, &group)?;
    let epoch = epoch_of(&mls_group);
    let message_epoch = message.epoch().as_u64();
    if message_epoch > epoch || epoch - message_epoch > MAX_PAST_EPOCHS {
        return Err(Error::EpochMismatch {
            group: epoch,
            message: message_epoch,
        });
    }
    let processed = match mls_group.process_message(&provider, message) {
        Ok(processed) => processed,
        Err(ProcessMessageError::StorageError(e)) => return Err(e.into()),
        Err(e) => return Err(Error::Decrypt(format!("{e:?}"))),
    };
    let sender = credential_device(processed.credential());
    let aad = processed.aad().to_vec();
    let data = match processed.into_content() {
        ProcessedMessageContent::ApplicationMessage(message) => {
            Zeroizing::new(message.into_bytes())
        }
        ProcessedMessageContent::OwnPrivateMessage => return Ok(Decrypted::Own),
        _ => return Err(Error::malformed("envelope", "not an application message")),
    };
    let invalid = |reason: &str| {
        Ok(Decrypted::Invalid {
            sender: sender.clone(),
            reason: reason.to_string(),
        })
    };
    let Some(sender) = sender.clone() else {
        return invalid("the sender's credential is not an mls-key credential");
    };
    let Ok(AuthenticatedData::Application(aad)) = AuthenticatedData::parse(&aad) else {
        return invalid("the authenticated data is not an application message's");
    };
    let Ok((franking_key, content_bytes)) = split_application_data(&data) else {
        return invalid("the application data is malformed");
    };
    let content = match MessageContent::parse(content_bytes) {
        Ok(content) => content,
        Err(e) => return invalid(&e.to_string()),
    };
    if content.id != expected.message_id || aad.message_id != expected.message_id {
        return invalid("the message id is not the row's");
    }
    if content.thread_root_id != expected.thread_root_id {
        return invalid("the thread is not the row's");
    }
    if expected
        .author_principal_id
        .as_ref()
        .is_some_and(|author| *author != sender.principal_id)
    {
        return invalid("the sender is not the row's author");
    }
    if aad.mentions != content.mentions || aad.mention_all != content.mention_all {
        return invalid("the authenticated mentions are not the content's");
    }
    let commitment = franking_commitment(&franking_key, content_bytes);
    if commitment != aad.franking {
        return invalid("the franking commitment does not match the content");
    }
    Ok(Decrypted::Message(Box::new(DecryptedMessage {
        sender,
        epoch: message_epoch,
        content_bytes: content_bytes.to_vec(),
        content,
        franking_key,
        commitment,
    })))
}

pub(crate) fn status<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
) -> Result<GroupStatus> {
    let provider = Provider::new(crypto, KvStorage::new(backend));
    let record = load_record(backend, &group)?;
    let mls_group = load_group(&provider, &group)?;
    Ok(GroupStatus {
        epoch: epoch_of(&mls_group),
        commit_pending: record.pending_commit.is_some(),
        awaiting_readd: record.awaiting_readd,
    })
}

pub(crate) fn group_leaves<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
) -> Result<Vec<Leaf>> {
    let provider = Provider::new(crypto, KvStorage::new(backend));
    Ok(leaves(&load_group(&provider, &group)?))
}

/// Delete the group's state on this device (left, removed, retired, or before a re-add).
pub(crate) fn delete<C: Crypto>(
    crypto: &C,
    backend: &dyn Backend,
    group: ConversationGroup,
) -> Result<()> {
    use openmls_traits::OpenMlsProvider as _;
    let provider = Provider::new(crypto, KvStorage::new(backend));
    if let Some(mut mls_group) = MlsGroup::load(provider.storage(), &openmls_group_id(&group))? {
        mls_group.delete(provider.storage())?;
    }
    records(backend).delete(GROUP_LABEL, &group.group_id())
}
