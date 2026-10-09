//! Tauri commands of end-to-end encryption. Each names its account (the cache database the
//! group state lives in); each runs in one transaction of that database on the blocking pool,
//! committed only when the operation succeeded.

use rim_mls::{DeviceRef, Mls, SignedStatement, MLS_KEY_CONTEXT, READD_CONTEXT};
use rusqlite::Transaction;
use serde::Serialize;
use tauri::State;

use super::attachment::PendingAttachments;
use super::directory::{self, DirectoryInput, ReaddInput, VerifyOutcome};
use super::group::{
    self, ClaimedInput, CommitInput, CommitStep, DeviceView, GroupView, OutgoingCommitView,
};
use super::identity::{self, KeyPackageStatusInput};
use super::outgoing::{self, DraftInput, OutgoingView, SettledView};
use super::{parse_uuid, E2eeError, Result};
use crate::key_identity::statement::Statement;
use crate::key_identity::KeyIdentityState;
use crate::message_cache::{AccountId, MessageCacheState};

/// Run `f` in one transaction of the account's cache database, committed when it succeeds.
async fn in_transaction<T, F>(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    f: F,
) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&Transaction<'_>, &Mls) -> Result<T> + Send + 'static,
{
    let store = cache.store(&account)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mls = Mls::new()?;
        let mut store = store.lock().unwrap_or_else(|e| e.into_inner());
        let tx = store.conn.transaction()?;
        let out = f(&tx, &mls)?;
        tx.commit()?;
        Ok(out)
    })
    .await
    .map_err(|e| E2eeError::Invalid(format!("e2ee task failed: {e}")))?
}

/// This device as the key store knows it for `principal_id`, and a signer for its MLS
/// statements.
fn device_of(keys: &KeyIdentityState, principal_id: &str) -> Result<(DeviceRef, String)> {
    let (device_id, device_key) = keys
        .device(principal_id)
        .map_err(|e| E2eeError::Key(e.to_string()))?;
    Ok((
        DeviceRef {
            principal_id: principal_id.to_string(),
            device_id: parse_uuid(&device_id)?,
        },
        device_key,
    ))
}

fn sign(
    keys: &KeyIdentityState,
    principal_id: &str,
    context: &[u8],
    payload: String,
) -> Result<SignedStatement> {
    let signed = keys
        .sign_mls(principal_id, context, payload)
        .map_err(|e| E2eeError::Key(e.to_string()))?;
    Ok(SignedStatement {
        payload: signed.payload,
        signature: signed.signature,
    })
}

/// The group state of each conversation (of every conversation this device holds group state
/// for in the workspace, when the list is empty), for the timeline and the send path.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationGroupView {
    conversation_id: String,
    #[serde(flatten)]
    group: GroupView,
}

#[tauri::command]
pub async fn e2ee_status(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_ids: Vec<String>,
) -> Result<Vec<ConversationGroupView>> {
    in_transaction(cache, account, move |tx, mls| {
        let conversation_ids = if conversation_ids.is_empty() {
            group::conversations(tx, &workspace_id)?
        } else {
            conversation_ids
        };
        conversation_ids
            .into_iter()
            .map(|conversation_id| {
                Ok(ConversationGroupView {
                    group: group::view(tx, mls, &workspace_id, &conversation_id)?,
                    conversation_id,
                })
            })
            .collect()
    })
    .await
}

/// This device's id and its `mls-key` statement.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityView {
    device_id: String,
    statement: Statement,
}

/// Make sure this device has an MLS key certified by its device key.
#[tauri::command]
pub async fn e2ee_ensure_identity(
    cache: State<'_, MessageCacheState>,
    keys: State<'_, KeyIdentityState>,
    account: AccountId,
    principal_id: String,
) -> Result<IdentityView> {
    let keys = keys.inner().clone();
    in_transaction(cache, account, move |tx, mls| {
        let (device, device_key) = device_of(&keys, &principal_id)?;
        let mut sign_error = None;
        let statement =
            identity::ensure_identity(tx, mls, &device, &device_key, |context, payload| {
                debug_assert_eq!(context, MLS_KEY_CONTEXT);
                sign(&keys, &principal_id, context, payload).unwrap_or_else(|e| {
                    sign_error = Some(e);
                    SignedStatement {
                        payload: String::new(),
                        signature: String::new(),
                    }
                })
            });
        if let Some(e) = sign_error {
            return Err(e);
        }
        let statement = statement?;
        Ok(IdentityView {
            device_id: device.device_id.hyphenated().to_string(),
            statement: Statement {
                payload: statement.payload,
                signature: statement.signature,
            },
        })
    })
    .await
}

/// Key packages to upload, given the server's status (null when unknown): see
/// `identity::refresh_key_packages`.
#[tauri::command]
pub async fn e2ee_key_packages(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    status: Option<KeyPackageStatusInput>,
    min_one_time: Option<u32>,
) -> Result<Vec<String>> {
    let now = chrono::Utc::now().timestamp().max(0) as u64;
    in_transaction(cache, account, move |tx, mls| {
        identity::refresh_key_packages(
            tx,
            mls,
            status.as_ref(),
            min_one_time.unwrap_or(0) as usize,
            now,
        )
    })
    .await
}

/// Create incarnation `incarnation` of the conversation's group with the claimed devices.
#[tauri::command]
pub async fn e2ee_create_group(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    incarnation: u32,
    claimed: Vec<ClaimedInput>,
) -> Result<OutgoingCommitView> {
    in_transaction(cache, account, move |tx, mls| {
        group::create(
            tx,
            mls,
            &workspace_id,
            &conversation_id,
            incarnation,
            &claimed,
        )
    })
    .await
}

/// Stage one Commit with every pending change (empty lists: a self-update).
#[tauri::command]
pub async fn e2ee_commit(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    claimed: Vec<ClaimedInput>,
    removes: Vec<DeviceView>,
) -> Result<OutgoingCommitView> {
    in_transaction(cache, account, move |tx, mls| {
        group::commit(tx, mls, &workspace_id, &conversation_id, &claimed, &removes)
    })
    .await
}

/// The server's answer to this device's pending Commit. `readds`: the devices it re-added.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn e2ee_settle_commit(
    cache: State<'_, MessageCacheState>,
    keys: State<'_, KeyIdentityState>,
    account: AccountId,
    principal_id: String,
    workspace_id: String,
    conversation_id: String,
    accepted: bool,
    readds: Vec<DeviceView>,
) -> Result<GroupView> {
    let me = device_of(keys.inner(), &principal_id)
        .ok()
        .map(|(device, _)| device);
    in_transaction(cache, account, move |tx, mls| {
        group::settle(
            tx,
            mls,
            me.as_ref(),
            &workspace_id,
            &conversation_id,
            accepted,
        )?;
        if accepted {
            group::note_readds_honored(tx, &conversation_id, &readds)?;
        }
        group::view(tx, mls, &workspace_id, &conversation_id)
    })
    .await
}

/// What applying fetched Commits did.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessedView {
    /// `applied`, `skipped`, `gap` or `cannotProcess`.
    step: &'static str,
    group: GroupView,
}

/// Apply fetched Commits in order (outside a feed sync).
#[tauri::command]
pub async fn e2ee_process_commits(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    commits: Vec<CommitInput>,
) -> Result<ProcessedView> {
    in_transaction(cache, account, move |tx, mls| {
        let step = group::process_commits(tx, mls, &workspace_id, &conversation_id, &commits)?;
        Ok(ProcessedView {
            step: match step {
                CommitStep::Applied => "applied",
                CommitStep::Skipped => "skipped",
                CommitStep::Gap => "gap",
                CommitStep::CannotProcess => "cannotProcess",
            },
            group: group::view(tx, mls, &workspace_id, &conversation_id)?,
        })
    })
    .await
}

/// Join a conversation's group from a Welcome.
#[tauri::command]
pub async fn e2ee_join(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    incarnation: u32,
    welcome: String,
) -> Result<GroupView> {
    in_transaction(cache, account, move |tx, mls| {
        group::join(
            tx,
            mls,
            &workspace_id,
            &conversation_id,
            incarnation,
            &welcome,
        )
    })
    .await
}

/// Check the group's leaves against fetched key logs and device lists.
#[tauri::command]
pub async fn e2ee_verify(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    directory: DirectoryInput,
) -> Result<VerifyOutcome> {
    in_transaction(cache, account, move |tx, mls| {
        directory::verify(tx, mls, &workspace_id, &conversation_id, &directory)
    })
    .await
}

/// Sign a re-add request for the conversation's `incarnation`; this device's state of it goes.
#[tauri::command]
pub async fn e2ee_readd_request(
    cache: State<'_, MessageCacheState>,
    keys: State<'_, KeyIdentityState>,
    account: AccountId,
    principal_id: String,
    workspace_id: String,
    conversation_id: String,
    incarnation: u32,
) -> Result<Statement> {
    let keys = keys.inner().clone();
    in_transaction(cache, account, move |tx, mls| {
        let payload = group::prepare_readd(tx, mls, &workspace_id, &conversation_id, incarnation)?;
        let signed = sign(&keys, &principal_id, READD_CONTEXT, payload)?;
        Ok(Statement {
            payload: signed.payload,
            signature: signed.signature,
        })
    })
    .await
}

/// The re-add requests this device may act on now.
#[tauri::command]
pub async fn e2ee_readd_check(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    requests: Vec<ReaddInput>,
    directory: DirectoryInput,
) -> Result<Vec<DeviceView>> {
    in_transaction(cache, account, move |tx, _mls| {
        directory::honorable_readds(tx, &workspace_id, &conversation_id, &requests, &directory)
    })
    .await
}

/// Encrypt a message or an edit and store its plaintext; send the envelope next.
#[tauri::command]
pub async fn e2ee_encrypt_message(
    cache: State<'_, MessageCacheState>,
    pending: State<'_, PendingAttachments>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    draft: DraftInput,
    forward_of: Option<String>,
) -> Result<OutgoingView> {
    let mut attachments = Vec::new();
    for hash in &draft.attachments {
        if let Some(entry) = pending.get(hash) {
            attachments.push(entry);
        }
    }
    let hashes = draft.attachments.clone();
    let view = in_transaction(cache, account, move |tx, mls| {
        let mut lookup = |hash: &str| {
            attachments
                .iter()
                .find(|a| super::b64(&a.blob_sha256) == hash)
                .cloned()
                .or_else(|| {
                    let source = forward_of.as_deref()?;
                    super::attachment::attachment_entry(tx, source, hash).ok()
                })
        };
        outgoing::encrypt(
            tx,
            mls,
            &workspace_id,
            &conversation_id,
            &draft,
            &mut lookup,
        )
    })
    .await?;
    pending.forget(&hashes);
    Ok(view)
}

/// Encrypt a message waiting for acknowledgement again, in the group's current epoch.
#[tauri::command]
pub async fn e2ee_reencrypt_message(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    message_id: String,
) -> Result<OutgoingView> {
    in_transaction(cache, account, move |tx, mls| {
        outgoing::reencrypt(tx, mls, &message_id)
    })
    .await
}

/// The server's answer to a message or an edit: the message it returned, or null when it
/// refused it for good.
#[tauri::command]
pub async fn e2ee_settle_message(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    message_id: String,
    accepted: Option<serde_json::Value>,
) -> Result<SettledView> {
    in_transaction(cache, account, move |tx, _mls| {
        outgoing::settle(tx, &message_id, accepted.as_ref())
    })
    .await
}

/// Forget a conversation's group state (this device left it, or it is gone).
#[tauri::command]
pub async fn e2ee_forget(
    cache: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
) -> Result<()> {
    in_transaction(cache, account, move |tx, mls| {
        group::forget(tx, mls, &workspace_id, &conversation_id)
    })
    .await
}
