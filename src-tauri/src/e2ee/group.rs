//! A conversation's group on this device: what the cache keeps about it, and the operations
//! the webview runs with the server's data (create, commit, settle, join, process Commits,
//! re-add requests).
//!
//! Every function runs on the caller's transaction; the caller commits once it has what the
//! function returned, so a Commit is stored as pending before it is submitted.

use rim_mls::{
    ClaimedKeyPackage, CommitOutcome, ConversationGroup, DeviceRef, MembershipChange, Mls,
    OutgoingCommit, SqliteStore,
};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use super::{b64, now_ms, parse_uuid, unb64, E2eeError, Result};

/// A device as the webview names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceView {
    pub principal_id: String,
    pub device_id: String,
}

impl DeviceView {
    pub(crate) fn from_ref(device: &DeviceRef) -> Self {
        Self {
            principal_id: device.principal_id.clone(),
            device_id: device.device_id.hyphenated().to_string(),
        }
    }

    pub(crate) fn to_ref(&self) -> Result<DeviceRef> {
        Ok(DeviceRef {
            principal_id: self.principal_id.clone(),
            device_id: parse_uuid(&self.device_id)?,
        })
    }
}

/// A device whose leaf did not verify, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnverifiedDevice {
    pub principal_id: String,
    pub device_id: String,
    pub reason: String,
}

/// The device that started an incarnation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Reset {
    pub incarnation: u32,
    pub principal_id: String,
    pub device_id: String,
}

/// A principal a processed Commit brought into the group or took out of it, for the timeline:
/// the line sits before the first message of `epoch` (the epoch the Commit made).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MembershipEvent {
    pub incarnation: u32,
    pub epoch: u64,
    /// `added` or `removed`.
    pub kind: String,
    pub principal_id: String,
}

/// How many membership events a conversation keeps, newest last.
const MEMBERSHIP_EVENTS_KEPT: usize = 200;

/// What the cache keeps about a conversation's group (`e2ee_conversation`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationState {
    pub incarnation: u32,
    pub next_incarnation: Option<u32>,
    pub join_epoch: u64,
    pub removed: bool,
    pub verify_pending: bool,
    pub unverified: Vec<UnverifiedDevice>,
    pub misbehaved: Option<DeviceView>,
    pub readd_requested_at: Option<i64>,
    pub last_update_at: Option<i64>,
    pub resets: Vec<Reset>,
    pub membership: Vec<MembershipEvent>,
}

impl ConversationState {
    /// Note what a Commit of `incarnation` that moved the group to `epoch` changed.
    fn note_membership(&mut self, incarnation: u32, epoch: u64, change: &MembershipChange) {
        let events = change
            .added
            .iter()
            .map(|p| ("added", p))
            .chain(change.removed.iter().map(|p| ("removed", p)));
        for (kind, principal_id) in events {
            self.membership.push(MembershipEvent {
                incarnation,
                epoch,
                kind: kind.to_string(),
                principal_id: principal_id.clone(),
            });
        }
        let excess = self.membership.len().saturating_sub(MEMBERSHIP_EVENTS_KEPT);
        self.membership.drain(..excess);
    }
}

pub(crate) fn load_state(
    tx: &Transaction<'_>,
    workspace_id: &str,
    conversation_id: &str,
) -> Result<ConversationState> {
    let row = tx
        .query_row(
            "SELECT incarnation, next_incarnation, join_epoch, removed, verify_pending,
                    unverified, misbehaved, readd_requested_at, last_update_at, resets, membership
             FROM e2ee_conversation WHERE workspace_id = ?1 AND conversation_id = ?2",
            params![workspace_id, conversation_id],
            |row| {
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, Option<u32>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, bool>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                ))
            },
        )
        .optional()?;
    let Some((
        incarnation,
        next,
        join,
        removed,
        verify,
        unverified,
        misbehaved,
        readd,
        update,
        resets,
        membership,
    )) = row
    else {
        return Ok(ConversationState::default());
    };
    Ok(ConversationState {
        incarnation,
        next_incarnation: next,
        join_epoch: join.max(0) as u64,
        removed,
        verify_pending: verify,
        unverified: serde_json::from_str(&unverified)?,
        misbehaved: misbehaved.map(|m| serde_json::from_str(&m)).transpose()?,
        readd_requested_at: readd,
        last_update_at: update,
        resets: serde_json::from_str(&resets)?,
        membership: serde_json::from_str(&membership)?,
    })
}

/// Save the conversation's state; a conversation this device keeps state for is pinned as
/// encrypted for good.
pub(crate) fn save_state(
    tx: &Transaction<'_>,
    workspace_id: &str,
    conversation_id: &str,
    state: &ConversationState,
) -> Result<()> {
    pin(tx, workspace_id, conversation_id, None, None)?;
    tx.execute(
        "INSERT INTO e2ee_conversation
             (workspace_id, conversation_id, incarnation, next_incarnation, join_epoch, removed,
              verify_pending, unverified, misbehaved, readd_requested_at, last_update_at, resets,
              membership)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT (workspace_id, conversation_id) DO UPDATE SET
             incarnation = excluded.incarnation,
             next_incarnation = excluded.next_incarnation,
             join_epoch = excluded.join_epoch,
             removed = excluded.removed,
             verify_pending = excluded.verify_pending,
             unverified = excluded.unverified,
             misbehaved = excluded.misbehaved,
             readd_requested_at = excluded.readd_requested_at,
             last_update_at = excluded.last_update_at,
             resets = excluded.resets,
             membership = excluded.membership",
        params![
            workspace_id,
            conversation_id,
            state.incarnation,
            state.next_incarnation,
            state.join_epoch as i64,
            state.removed,
            state.verify_pending,
            serde_json::to_string(&state.unverified)?,
            state
                .misbehaved
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            state.readd_requested_at,
            state.last_update_at,
            serde_json::to_string(&state.resets)?,
            serde_json::to_string(&state.membership)?,
        ],
    )?;
    Ok(())
}

/// What this device pinned about a conversation (`e2ee_pin`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Pin {
    /// The server's `encryptedAt` as first seen, when it was.
    pub encrypted_at: Option<String>,
    /// A direct message's two principals.
    pub dm_principals: Option<Vec<String>>,
}

/// The conversation's pin, if this device pinned it.
pub(crate) fn load_pin(
    tx: &Transaction<'_>,
    workspace_id: &str,
    conversation_id: &str,
) -> Result<Option<Pin>> {
    let row = tx
        .query_row(
            "SELECT encrypted_at, dm_principals FROM e2ee_pin
             WHERE workspace_id = ?1 AND conversation_id = ?2",
            params![workspace_id, conversation_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .optional()?;
    row.map(|(encrypted_at, dm)| {
        Ok(Pin {
            encrypted_at,
            dm_principals: dm.map(|d| serde_json::from_str(&d)).transpose()?,
        })
    })
    .transpose()
}

/// Pin the conversation as encrypted. The first `encrypted_at` and the first pair of
/// `dm_principals` handed in stay; later values change nothing.
pub(crate) fn pin(
    tx: &Transaction<'_>,
    workspace_id: &str,
    conversation_id: &str,
    encrypted_at: Option<&str>,
    dm_principals: Option<&[String]>,
) -> Result<()> {
    let dm = match dm_principals {
        Some(principals) => {
            let mut principals = principals.to_vec();
            principals.sort();
            principals.dedup();
            if principals.len() != 2 {
                return Err(E2eeError::Invalid(
                    "a direct message is pinned to exactly two principals".into(),
                ));
            }
            Some(serde_json::to_string(&principals)?)
        }
        None => None,
    };
    tx.execute(
        "INSERT INTO e2ee_pin (workspace_id, conversation_id, encrypted_at, dm_principals)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (workspace_id, conversation_id) DO UPDATE SET
             encrypted_at = COALESCE(e2ee_pin.encrypted_at, excluded.encrypted_at),
             dm_principals = COALESCE(e2ee_pin.dm_principals, excluded.dm_principals)",
        params![workspace_id, conversation_id, encrypted_at, dm],
    )?;
    Ok(())
}

/// The conversations of the workspace the cache keeps group state about or pinned.
pub(crate) fn conversations(tx: &Transaction<'_>, workspace_id: &str) -> Result<Vec<String>> {
    let mut stmt = tx.prepare_cached(
        "SELECT conversation_id FROM e2ee_conversation WHERE workspace_id = ?1
         UNION SELECT conversation_id FROM e2ee_pin WHERE workspace_id = ?1
         ORDER BY conversation_id",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| row.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub(crate) fn conversation_group(
    conversation_id: &str,
    incarnation: u32,
) -> Result<ConversationGroup> {
    Ok(ConversationGroup::new(
        parse_uuid(conversation_id)?,
        incarnation,
    ))
}

/// Where a conversation's group stands on this device, for the webview.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GroupView {
    #[serde(flatten)]
    pub state: ConversationState,
    /// Whether this device holds group state for `incarnation`.
    pub has_group: bool,
    /// The epoch of that state: the epoch this device's next Commit or message is made in.
    pub epoch: Option<u64>,
    pub commit_pending: bool,
    /// The epoch the group stopped at on a Commit it could not process.
    pub awaiting_readd: Option<u64>,
    /// This device knows the conversation is encrypted, whatever the server says now.
    pub pinned: bool,
    /// The server's `encryptedAt` as this device first saw it.
    pub pinned_encrypted_at: Option<String>,
    /// A direct message's two principals, as pinned.
    pub dm_principals: Option<Vec<String>>,
}

pub(crate) fn view(
    tx: &Transaction<'_>,
    mls: &Mls,
    workspace_id: &str,
    conversation_id: &str,
) -> Result<GroupView> {
    let state = load_state(tx, workspace_id, conversation_id)?;
    let pin = load_pin(tx, workspace_id, conversation_id)?;
    let mut view = GroupView {
        has_group: false,
        epoch: None,
        commit_pending: false,
        awaiting_readd: None,
        pinned: pin.is_some(),
        pinned_encrypted_at: pin.as_ref().and_then(|p| p.encrypted_at.clone()),
        dm_principals: pin.and_then(|p| p.dm_principals),
        state,
    };
    if view.state.incarnation > 0 {
        let group = conversation_group(conversation_id, view.state.incarnation)?;
        match mls.group_status(&SqliteStore::new(tx), group) {
            Ok(status) => {
                view.has_group = true;
                view.epoch = Some(status.epoch);
                view.commit_pending = status.commit_pending;
                view.awaiting_readd = status.awaiting_readd;
            }
            Err(rim_mls::Error::NoGroup) => {}
            Err(e) => return Err(e.into()),
        }
    }
    if let Some(next) = view.state.next_incarnation {
        let group = conversation_group(conversation_id, next)?;
        if let Ok(status) = mls.group_status(&SqliteStore::new(tx), group) {
            view.commit_pending |= status.commit_pending;
        }
    }
    Ok(view)
}

/// A key package `claimMlsKeyPackages` handed out.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaimedInput {
    pub principal_id: String,
    pub device_id: String,
    /// The `MLSMessage`, base64url.
    pub key_package: String,
}

fn claimed(inputs: &[ClaimedInput]) -> Result<Vec<ClaimedKeyPackage>> {
    inputs
        .iter()
        .map(|c| {
            Ok(ClaimedKeyPackage {
                device: DeviceRef {
                    principal_id: c.principal_id.clone(),
                    device_id: parse_uuid(&c.device_id)?,
                },
                key_package: unb64(&c.key_package)?,
            })
        })
        .collect()
}

/// An added device in a Commit's summary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddedView {
    pub principal_id: String,
    pub device_id: String,
    pub key_package_ref: String,
}

/// A Commit to send with `submitMlsCommit`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutgoingCommitView {
    pub incarnation: u32,
    pub epoch: u64,
    pub cipher_suite: u16,
    pub commit: String,
    pub welcome: Option<String>,
    pub adds: Vec<AddedView>,
    pub removes: Vec<DeviceView>,
}

fn outgoing_view(commit: &OutgoingCommit) -> OutgoingCommitView {
    OutgoingCommitView {
        incarnation: commit.group.incarnation,
        epoch: commit.epoch,
        cipher_suite: commit.cipher_suite,
        commit: b64(&commit.commit),
        welcome: commit.welcome.as_deref().map(b64),
        adds: commit
            .summary
            .adds
            .iter()
            .map(|a| AddedView {
                principal_id: a.device.principal_id.clone(),
                device_id: a.device.device_id.hyphenated().to_string(),
                key_package_ref: b64(&a.key_package_ref),
            })
            .collect(),
        removes: commit
            .summary
            .removes
            .iter()
            .map(DeviceView::from_ref)
            .collect(),
    }
}

/// Create incarnation `incarnation` of the conversation's group and stage its first Commit,
/// adding the claimed devices. The group this device holds now stays usable until the server
/// accepts the Commit.
pub(crate) fn create(
    tx: &Transaction<'_>,
    mls: &Mls,
    workspace_id: &str,
    conversation_id: &str,
    incarnation: u32,
    adds: &[ClaimedInput],
) -> Result<OutgoingCommitView> {
    if incarnation == 0 {
        return Err(E2eeError::Invalid("incarnations start at 1".into()));
    }
    let mut state = load_state(tx, workspace_id, conversation_id)?;
    let group = conversation_group(conversation_id, incarnation)?;
    let store = SqliteStore::new(tx);
    if state.incarnation >= incarnation {
        return Err(E2eeError::Invalid(
            "this device already holds that incarnation or a newer one".into(),
        ));
    }
    // A creation that lost its race and was never settled leaves a group behind.
    if let Some(next) = state.next_incarnation {
        mls.delete_group(&store, conversation_group(conversation_id, next)?)?;
    }
    let commit = mls.create_group(&store, group, &claimed(adds)?)?;
    state.next_incarnation = Some(incarnation);
    save_state(tx, workspace_id, conversation_id, &state)?;
    Ok(outgoing_view(&commit))
}

/// Stage one Commit of every pending change in the current group: `adds` with their claimed
/// key packages, `removes`. A re-add names its device in both. Empty lists make a self-update.
pub(crate) fn commit(
    tx: &Transaction<'_>,
    mls: &Mls,
    workspace_id: &str,
    conversation_id: &str,
    adds: &[ClaimedInput],
    removes: &[DeviceView],
) -> Result<OutgoingCommitView> {
    let state = load_state(tx, workspace_id, conversation_id)?;
    if state.incarnation == 0 || state.removed {
        return Err(rim_mls::Error::NoGroup.into());
    }
    let group = conversation_group(conversation_id, state.incarnation)?;
    let removes = removes
        .iter()
        .map(DeviceView::to_ref)
        .collect::<Result<Vec<_>>>()?;
    let commit = mls.commit(&SqliteStore::new(tx), group, &claimed(adds)?, &removes)?;
    Ok(outgoing_view(&commit))
}

/// The server answered this device's pending Commit: merged when `accepted`, dropped on
/// `STALE_EPOCH`. A first Commit of a new incarnation makes that incarnation current.
pub(crate) fn settle(
    tx: &Transaction<'_>,
    mls: &Mls,
    me: Option<&DeviceRef>,
    workspace_id: &str,
    conversation_id: &str,
    accepted: bool,
) -> Result<()> {
    let mut state = load_state(tx, workspace_id, conversation_id)?;
    let store = SqliteStore::new(tx);
    if let Some(next) = state.next_incarnation {
        let group = conversation_group(conversation_id, next)?;
        if mls
            .group_status(&store, group)
            .is_ok_and(|s| s.commit_pending)
        {
            if accepted {
                // The first Commit of an incarnation: its adds are the group, not changes to it.
                mls.commit_accepted(&store, group)?;
                promote(tx, mls, &mut state, conversation_id, next, me)?;
            } else {
                mls.commit_rejected(&store, group)?;
                state.next_incarnation = None;
            }
            return save_state(tx, workspace_id, conversation_id, &state);
        }
        state.next_incarnation = None;
    }
    if state.incarnation == 0 {
        return Err(rim_mls::Error::NoPendingCommit.into());
    }
    let group = conversation_group(conversation_id, state.incarnation)?;
    if accepted {
        let merged = mls.commit_accepted(&store, group)?;
        state.note_membership(group.incarnation, merged.epoch, &merged.membership);
        state.verify_pending = true;
        state.last_update_at = Some(now_ms());
    } else {
        mls.commit_rejected(&store, group)?;
    }
    save_state(tx, workspace_id, conversation_id, &state)
}

/// Make `incarnation`, whose first Commit this device made, the current one.
fn promote(
    tx: &Transaction<'_>,
    mls: &Mls,
    state: &mut ConversationState,
    conversation_id: &str,
    incarnation: u32,
    me: Option<&DeviceRef>,
) -> Result<()> {
    if state.incarnation > 0 && state.incarnation != incarnation {
        let old = conversation_group(conversation_id, state.incarnation)?;
        mls.delete_group(&SqliteStore::new(tx), old)?;
    }
    if incarnation > 1 {
        if let Some(me) = me {
            note_reset(state, incarnation, &DeviceView::from_ref(me));
        }
    }
    state.incarnation = incarnation;
    state.next_incarnation = None;
    // The first Commit moves the group from epoch 0 to 1, where messages start.
    state.join_epoch = 1;
    state.removed = false;
    state.readd_requested_at = None;
    state.verify_pending = true;
    state.last_update_at = Some(now_ms());
    Ok(())
}

fn note_reset(state: &mut ConversationState, incarnation: u32, by: &DeviceView) {
    if !state.resets.iter().any(|r| r.incarnation == incarnation) {
        state.resets.push(Reset {
            incarnation,
            principal_id: by.principal_id.clone(),
            device_id: by.device_id.clone(),
        });
    }
}

/// Join `incarnation` of the conversation's group from a Welcome. An older incarnation's state
/// goes; every leaf waits for verification. A Welcome to an epoch the held state of the same
/// incarnation already reached is refused (`E2EE_STALE_WELCOME`) unless the group waits for a
/// re-add.
pub(crate) fn join(
    tx: &Transaction<'_>,
    mls: &Mls,
    workspace_id: &str,
    conversation_id: &str,
    incarnation: u32,
    welcome: &str,
) -> Result<GroupView> {
    let mut state = load_state(tx, workspace_id, conversation_id)?;
    if incarnation < state.incarnation {
        return Err(E2eeError::Invalid(
            "the Welcome is for an older incarnation than this device holds".into(),
        ));
    }
    let group = conversation_group(conversation_id, incarnation)?;
    let store = SqliteStore::new(tx);
    let joined = mls.join(&store, group, &unb64(welcome)?)?;
    if state.incarnation > 0 && state.incarnation != incarnation {
        let old = conversation_group(conversation_id, state.incarnation)?;
        mls.delete_group(&store, old)?;
        if let Some(welcomer) = &joined.welcomer {
            note_reset(&mut state, incarnation, &DeviceView::from_ref(welcomer));
        }
    }
    if let Some(next) = state.next_incarnation.take() {
        if next != incarnation {
            mls.delete_group(&store, conversation_group(conversation_id, next)?)?;
        }
    }
    state.incarnation = incarnation;
    state.join_epoch = joined.epoch;
    state.removed = false;
    state.readd_requested_at = None;
    state.verify_pending = true;
    // The weekly self-update counts from the join.
    state.last_update_at.get_or_insert_with(now_ms);
    save_state(tx, workspace_id, conversation_id, &state)?;
    view(tx, mls, workspace_id, conversation_id)
}

/// A Commit as `mlsCommits` returns it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitInput {
    pub incarnation: u32,
    pub epoch: u64,
    /// The `MLSMessage`, base64url.
    pub message: String,
}

/// What applying one Commit did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommitStep {
    /// Merged; the group moved to the next epoch.
    Applied,
    /// Not for a group this device holds, or already behind it.
    Skipped,
    /// For an epoch past the group's: a Commit in between is missing.
    Gap,
    /// The library refused it, or the group already waits for a re-add.
    CannotProcess,
}

/// Apply a fetched Commit to the group it names, if this device holds it at that epoch.
pub(crate) fn apply_commit(
    tx: &Transaction<'_>,
    mls: &Mls,
    state: &mut ConversationState,
    conversation_id: &str,
    commit: &CommitInput,
) -> Result<CommitStep> {
    let creating = state.next_incarnation == Some(commit.incarnation);
    if (commit.incarnation != state.incarnation || state.removed) && !creating {
        return Ok(CommitStep::Skipped);
    }
    let group = conversation_group(conversation_id, commit.incarnation)?;
    let store = SqliteStore::new(tx);
    let status = match mls.group_status(&store, group) {
        Ok(status) => status,
        Err(rim_mls::Error::NoGroup) => return Ok(CommitStep::Skipped),
        Err(e) => return Err(e.into()),
    };
    if status.awaiting_readd.is_some() {
        return Ok(CommitStep::CannotProcess);
    }
    if commit.epoch < status.epoch {
        return Ok(CommitStep::Skipped);
    }
    if commit.epoch > status.epoch {
        return Ok(CommitStep::Gap);
    }
    let bytes = unb64(&commit.message)?;
    let outcome = match mls.process_commit(&store, group, &bytes) {
        Ok(outcome) => outcome,
        Err(rim_mls::Error::EpochMismatch { .. }) => return Ok(CommitStep::Skipped),
        Err(
            e @ (rim_mls::Error::Malformed { .. }
            | rim_mls::Error::WrongGroup
            | rim_mls::Error::Mls(_)),
        ) => {
            log::warn!("[e2ee] a Commit could not be processed: {e}");
            if creating {
                mls.delete_group(&store, group)?;
                state.next_incarnation = None;
                return Ok(CommitStep::Skipped);
            }
            return Ok(CommitStep::CannotProcess);
        }
        Err(e) => return Err(e.into()),
    };
    match outcome {
        CommitOutcome::OwnMerged(merged) => {
            if creating {
                promote(tx, mls, state, conversation_id, commit.incarnation, None)?;
            } else {
                state.note_membership(commit.incarnation, merged.epoch, &merged.membership);
                state.verify_pending = true;
                state.last_update_at = Some(now_ms());
            }
            Ok(CommitStep::Applied)
        }
        // Another device created this incarnation first: this device's attempt is void, and it
        // joins through the Welcome the winner made for it.
        _ if creating => {
            mls.delete_group(&store, group)?;
            state.next_incarnation = None;
            Ok(CommitStep::Skipped)
        }
        CommitOutcome::Applied(applied) => {
            if applied.self_removed {
                state.removed = true;
            } else {
                state.note_membership(commit.incarnation, applied.epoch, &applied.membership);
            }
            if !applied.to_verify.is_empty() {
                state.verify_pending = true;
            }
            Ok(CommitStep::Applied)
        }
        CommitOutcome::CannotProcess {
            reason, committer, ..
        } => {
            log::warn!("[e2ee] a Commit could not be processed: {reason}");
            if let Some(committer) = committer {
                state.misbehaved = Some(DeviceView::from_ref(&committer));
            }
            Ok(CommitStep::CannotProcess)
        }
    }
}

/// Apply fetched Commits in order, outside a feed sync (the answer to a submit that got none,
/// or catching up before a Commit or a send). Stops at a gap or a Commit it cannot process.
pub(crate) fn process_commits(
    tx: &Transaction<'_>,
    mls: &Mls,
    workspace_id: &str,
    conversation_id: &str,
    commits: &[CommitInput],
) -> Result<CommitStep> {
    let mut state = load_state(tx, workspace_id, conversation_id)?;
    let mut last = CommitStep::Skipped;
    let mut ordered: Vec<&CommitInput> = commits.iter().collect();
    ordered.sort_by_key(|c| (c.incarnation, c.epoch));
    for commit in ordered {
        match apply_commit(tx, mls, &mut state, conversation_id, commit)? {
            CommitStep::Applied => last = CommitStep::Applied,
            CommitStep::Skipped => {}
            stop @ (CommitStep::Gap | CommitStep::CannotProcess) => {
                last = stop;
                break;
            }
        }
    }
    save_state(tx, workspace_id, conversation_id, &state)?;
    Ok(last)
}

/// The payload of a re-add request for the conversation, for the device key to sign. The
/// group state of `incarnation` goes (a re-add starts from a fresh Welcome).
pub(crate) fn prepare_readd(
    tx: &Transaction<'_>,
    mls: &Mls,
    workspace_id: &str,
    conversation_id: &str,
    incarnation: u32,
) -> Result<String> {
    let mut state = load_state(tx, workspace_id, conversation_id)?;
    let group = conversation_group(conversation_id, incarnation)?;
    let request = mls.prepare_readd(&SqliteStore::new(tx), group)?;
    if state.incarnation == incarnation {
        state.incarnation = 0;
    }
    state.readd_requested_at = Some(now_ms());
    save_state(tx, workspace_id, conversation_id, &state)?;
    Ok(request.payload())
}

/// Forget the conversation: its group state and what the cache keeps about it.
pub(crate) fn forget(
    tx: &Transaction<'_>,
    mls: &Mls,
    workspace_id: &str,
    conversation_id: &str,
) -> Result<()> {
    let state = load_state(tx, workspace_id, conversation_id)?;
    let store = SqliteStore::new(tx);
    for incarnation in [Some(state.incarnation), state.next_incarnation]
        .into_iter()
        .flatten()
        .filter(|i| *i > 0)
    {
        if let Ok(group) = conversation_group(conversation_id, incarnation) {
            mls.delete_group(&store, group)?;
        }
    }
    tx.execute(
        "DELETE FROM e2ee_conversation WHERE workspace_id = ?1 AND conversation_id = ?2",
        params![workspace_id, conversation_id],
    )?;
    tx.execute(
        "DELETE FROM e2ee_outgoing WHERE workspace_id = ?1 AND conversation_id = ?2",
        params![workspace_id, conversation_id],
    )?;
    Ok(())
}

/// Whether this device may act on `device`'s re-add request in the conversation now: at most
/// once per device and conversation in 24 hours.
pub(crate) fn may_honor_readd(
    tx: &Transaction<'_>,
    conversation_id: &str,
    device_id: &str,
) -> Result<bool> {
    let last: Option<i64> = tx
        .query_row(
            "SELECT honored_at FROM e2ee_readd_honored
             WHERE conversation_id = ?1 AND device_id = ?2",
            params![conversation_id, device_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(rim_mls::may_honor_readd(
        last.map(|ms| ms / 1000),
        now_ms() / 1000,
    ))
}

/// Record that this device's accepted Commit re-added these devices.
pub(crate) fn note_readds_honored(
    tx: &Transaction<'_>,
    conversation_id: &str,
    devices: &[DeviceView],
) -> Result<()> {
    for device in devices {
        tx.execute(
            "INSERT INTO e2ee_readd_honored (conversation_id, device_id, honored_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT (conversation_id, device_id) DO UPDATE SET honored_at = excluded.honored_at",
            params![conversation_id, device.device_id, now_ms()],
        )?;
    }
    Ok(())
}
