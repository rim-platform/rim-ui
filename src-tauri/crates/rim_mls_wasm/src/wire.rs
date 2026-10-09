//! The JSON the page and the engine exchange, and the byte and id spellings: unpadded base64url,
//! lowercase hyphenated UUIDs.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rim_mls::{
    Change, ClaimedKeyPackage, CommitOutcome, DeviceRef, EncryptedMessage, MembershipChange,
    MergedCommit, OutgoingCommit,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{Failure, Result};

pub(crate) fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub(crate) fn unb64(text: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| Failure::invalid("not unpadded base64url"))
}

pub(crate) fn unb64_32(text: &str) -> Result<[u8; 32]> {
    unb64(text)?
        .try_into()
        .map_err(|_| Failure::invalid("not 32 bytes"))
}

pub(crate) fn parse_uuid(text: &str) -> Result<Uuid> {
    Uuid::try_parse(text).map_err(|_| Failure::invalid(format!("not a UUID: {text}")))
}

pub(crate) fn parse_json<'a, T: Deserialize<'a>>(text: &'a str, what: &str) -> Result<T> {
    serde_json::from_str(text).map_err(|e| Failure::invalid(format!("{what}: {e}")))
}

/// JSON of a plain struct; serializing these cannot fail.
pub(crate) fn json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

/// A stored MLS entry; `value` null for a deleted one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct EntryWire {
    pub label: String,
    pub key: String,
    pub value: Option<String>,
}

pub(crate) fn changes(changes: &[Change]) -> Vec<EntryWire> {
    changes
        .iter()
        .map(|c| EntryWire {
            label: c.label.clone(),
            key: b64(&c.key),
            value: c.value.as_deref().map(b64),
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceWire {
    pub principal_id: String,
    pub device_id: String,
}

impl DeviceWire {
    pub(crate) fn from_ref(device: &DeviceRef) -> Self {
        Self {
            principal_id: device.principal_id.clone(),
            device_id: device.device_id.hyphenated().to_string(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimedWire {
    principal_id: String,
    device_id: String,
    key_package: String,
}

pub(crate) fn claimed(text: &str) -> Result<Vec<ClaimedKeyPackage>> {
    let claimed: Vec<ClaimedWire> = parse_json(text, "claimed key packages")?;
    claimed
        .into_iter()
        .map(|c| {
            Ok(ClaimedKeyPackage {
                device: DeviceRef {
                    principal_id: c.principal_id,
                    device_id: parse_uuid(&c.device_id)?,
                },
                key_package: unb64(&c.key_package)?,
            })
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyPackageWire {
    pub message: String,
    pub key_package_ref: String,
    pub last_resort: bool,
    pub not_after: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddedWire {
    principal_id: String,
    device_id: String,
    key_package_ref: String,
}

/// A Commit for `submitMlsCommit`, with its membership summary.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutgoingCommitWire {
    incarnation: u32,
    epoch: u64,
    cipher_suite: u16,
    commit: String,
    welcome: Option<String>,
    adds: Vec<AddedWire>,
    removes: Vec<DeviceWire>,
}

pub(crate) fn outgoing_commit(commit: &OutgoingCommit) -> OutgoingCommitWire {
    OutgoingCommitWire {
        incarnation: commit.group.incarnation,
        epoch: commit.epoch,
        cipher_suite: commit.cipher_suite,
        commit: b64(&commit.commit),
        welcome: commit.welcome.as_deref().map(b64),
        adds: commit
            .summary
            .adds
            .iter()
            .map(|a| AddedWire {
                principal_id: a.device.principal_id.clone(),
                device_id: a.device.device_id.hyphenated().to_string(),
                key_package_ref: b64(&a.key_package_ref),
            })
            .collect(),
        removes: commit
            .summary
            .removes
            .iter()
            .map(DeviceWire::from_ref)
            .collect(),
    }
}

/// The principals a Commit brought into the group or took out of it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MembershipWire {
    added: Vec<String>,
    removed: Vec<String>,
}

impl MembershipWire {
    fn from(change: &MembershipChange) -> Self {
        Self {
            added: change.added.clone(),
            removed: change.removed.clone(),
        }
    }
}

/// This device's own Commit, merged.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergedWire {
    epoch: u64,
    membership: MembershipWire,
}

pub(crate) fn merged(merged: &MergedCommit) -> MergedWire {
    MergedWire {
        epoch: merged.epoch,
        membership: MembershipWire::from(&merged.membership),
    }
}

/// What processing a Commit did.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum CommitOutcomeWire {
    #[serde(rename_all = "camelCase")]
    Applied {
        epoch: u64,
        committer: Option<DeviceWire>,
        added: Vec<DeviceWire>,
        removed: Vec<DeviceWire>,
        membership: MembershipWire,
        to_verify: u32,
        self_removed: bool,
    },
    #[serde(rename_all = "camelCase")]
    OwnMerged {
        epoch: u64,
        membership: MembershipWire,
    },
    /// Not merged; `committer` is set when that device's Commit broke a rule.
    #[serde(rename_all = "camelCase")]
    CannotProcess {
        epoch: u64,
        reason: String,
        committer: Option<DeviceWire>,
    },
}

pub(crate) fn commit_outcome(outcome: &CommitOutcome) -> CommitOutcomeWire {
    match outcome {
        CommitOutcome::Applied(applied) => CommitOutcomeWire::Applied {
            epoch: applied.epoch,
            committer: applied.committer.as_ref().map(DeviceWire::from_ref),
            added: applied.added.iter().map(DeviceWire::from_ref).collect(),
            removed: applied.removed.iter().map(DeviceWire::from_ref).collect(),
            membership: MembershipWire::from(&applied.membership),
            to_verify: applied.to_verify.len() as u32,
            self_removed: applied.self_removed,
        },
        CommitOutcome::OwnMerged(merged) => CommitOutcomeWire::OwnMerged {
            epoch: merged.epoch,
            membership: MembershipWire::from(&merged.membership),
        },
        CommitOutcome::CannotProcess {
            epoch,
            reason,
            committer,
        } => CommitOutcomeWire::CannotProcess {
            epoch: *epoch,
            reason: reason.clone(),
            committer: committer.as_ref().map(DeviceWire::from_ref),
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JoinedWire {
    pub epoch: u64,
    pub welcomer: Option<DeviceWire>,
    pub leaves: u32,
}

/// An encrypted message, and what to keep to send it again.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptedWire {
    message_id: String,
    epoch: u64,
    envelope: String,
    content: String,
    franking_key: String,
    commitment: String,
}

pub(crate) fn encrypted(message: &EncryptedMessage) -> EncryptedWire {
    EncryptedWire {
        message_id: message.message_id.hyphenated().to_string(),
        epoch: message.epoch,
        envelope: b64(&message.envelope),
        content: String::from_utf8_lossy(&message.content).into_owned(),
        franking_key: b64(message.franking_key.as_ref()),
        commitment: b64(&message.commitment),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpectedWire {
    pub message_id: String,
    #[serde(default)]
    pub thread_root_id: Option<String>,
    pub author_principal_id: String,
    pub sender_device_id: String,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum DecryptedWire {
    #[serde(rename_all = "camelCase")]
    Message {
        sender: DeviceWire,
        epoch: u64,
        /// The exact content JSON text.
        content: String,
        franking_key: String,
        commitment: String,
    },
    #[serde(rename_all = "camelCase")]
    Invalid {
        sender: Option<DeviceWire>,
        reason: String,
    },
    Own,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatusWire {
    pub epoch: u64,
    pub commit_pending: bool,
    pub awaiting_readd: Option<u64>,
}

/// A message's content before the mentions are read from its body.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DraftWire {
    pub id: String,
    #[serde(default)]
    pub rev: u32,
    #[serde(default)]
    pub thread_root_id: Option<String>,
    pub body: String,
    #[serde(default)]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub forwarded_from: Option<ForwardedFromWire>,
    #[serde(default)]
    pub attachments: Vec<AttachmentWire>,
    #[serde(default)]
    pub link_previews: Vec<LinkPreviewWire>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ForwardedFromWire {
    pub message_id: String,
    pub conversation_id: String,
    pub author_principal_id: String,
    pub sent_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AttachmentWire {
    pub blob_sha256: String,
    pub secret: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LinkPreviewWire {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub site_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatusInput {
    pub available: u32,
    #[serde(default)]
    pub last_resort_not_after: Option<u64>,
    #[serde(default)]
    pub last_resort_claims: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanWire {
    pub one_time: u32,
    pub last_resort: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReaddWire {
    pub principal_id: String,
    pub device_id: String,
    pub conversation_id: String,
    pub incarnation: u32,
    pub last_epoch: Option<u64>,
}
