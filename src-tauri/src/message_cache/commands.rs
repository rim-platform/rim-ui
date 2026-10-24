//! Tauri commands of the message cache. Each names its account, so a request still in flight
//! from a previous account can only ever touch that account's own database.
//!
//! Database work runs on the blocking pool, never on the main thread.

use tauri::{AppHandle, Manager, State};

use serde::Serialize;

use super::feed::{ChangesRequest, ConversationChanges};
use super::plugin_view::{PluginMessage, PluginMessagePage, PluginReadScope};
use super::search::{LocalSearchPage, LocalSearchQuery};
use super::snapshot::{Snapshot, SnapshotKind};
use super::store::{TimelineCursor, TimelinePage};
use super::{AccountId, CacheError, MessageCacheState};
use crate::e2ee::{ConversationInput, Decryptor, SyncNote};

async fn with_store<T, F>(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    f: F,
) -> Result<T, CacheError>
where
    T: Send + 'static,
    F: FnOnce(&mut super::store::CacheStore) -> Result<T, CacheError> + Send + 'static,
{
    let store = state.store(&account)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = store.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut store)
    })
    .await
    .map_err(|e| CacheError::Io(format!("cache task failed: {e}")))?
}

/// Remove the account's cache from this device: close its database and delete its files.
#[tauri::command]
pub async fn message_cache_remove_account(
    app: AppHandle,
    account: AccountId,
) -> Result<(), CacheError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<MessageCacheState>().remove(&account))
        .await
        .map_err(|e| CacheError::Io(format!("cache task failed: {e}")))?
}

/// The user opened a conversation: follow it from now on and remember when it was viewed.
#[tauri::command]
pub async fn message_cache_track(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
) -> Result<(), CacheError> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    with_store(state, account, move |store| {
        store.track(&workspace_id, &conversation_id, now_ms)
    })
    .await
}

/// Start a sync: `conversationIds` for a real-time signal, omitted for "everything recent".
/// Returns the first `messageChanges` input, or null when there is nothing to sync.
#[tauri::command]
pub async fn message_cache_sync_begin(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_ids: Option<Vec<String>>,
) -> Result<Option<ChangesRequest>, CacheError> {
    with_store(state, account, move |store| {
        store.begin_sync(&workspace_id, conversation_ids.as_deref())
    })
    .await
}

/// What applying a feed answer did.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncStep {
    /// The next `messageChanges` input, or null when the sync is done.
    next: Option<ChangesRequest>,
    /// What happened in each end-to-end encrypted conversation of the answer.
    e2ee: Vec<SyncNote>,
}

/// Apply a `messageChanges` answer. Encrypted entries are decrypted with the Commits and
/// thread roots `mls` hands in for their conversations.
#[tauri::command]
pub async fn message_cache_sync_apply(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    changes: Vec<ConversationChanges>,
    mls: Option<Vec<ConversationInput>>,
) -> Result<SyncStep, CacheError> {
    with_store(state, account, move |store| {
        let engine = rim_mls::Mls::new().map_err(|e| CacheError::Invalid(e.to_string()))?;
        let mut decryptor = Decryptor::new(&engine, mls.unwrap_or_default());
        let next = store.apply_changes_with(&workspace_id, changes, &mut decryptor)?;
        Ok(SyncStep {
            next,
            e2ee: decryptor.into_notes(),
        })
    })
    .await
}

/// A timeline page from the cache, or null when the conversation is not fully cached yet.
#[tauri::command]
pub async fn message_cache_timeline(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    before: Option<TimelineCursor>,
    limit: u32,
) -> Result<Option<TimelinePage>, CacheError> {
    with_store(state, account, move |store| {
        store.timeline(&workspace_id, &conversation_id, before.as_ref(), limit)
    })
    .await
}

/// A thread's cached replies, oldest first, after its root message when that is cached.
#[tauri::command]
pub async fn message_cache_thread(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    thread_id: String,
    root_message_id: Option<String>,
) -> Result<Vec<serde_json::Value>, CacheError> {
    with_store(state, account, move |store| {
        store.thread(
            &workspace_id,
            &conversation_id,
            &thread_id,
            root_message_id.as_deref(),
        )
    })
    .await
}

/// One cached message as the timeline renders it, or null.
#[tauri::command]
pub async fn message_cache_message(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    message_id: String,
) -> Result<Option<serde_json::Value>, CacheError> {
    with_store(state, account, move |store| store.message(&message_id)).await
}

/// A conversation's messages as a plugin reads them (`rim.chat.list_messages`), or null
/// while its history is not fully cached.
#[tauri::command]
pub async fn message_cache_plugin_messages(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    conversation_id: String,
    before: Option<String>,
    limit: Option<u32>,
    scope: PluginReadScope,
) -> Result<Option<PluginMessagePage>, CacheError> {
    with_store(state, account, move |store| {
        store.plugin_messages(
            &workspace_id,
            &conversation_id,
            before.as_deref(),
            limit,
            &scope,
        )
    })
    .await
}

/// One message as a plugin reads it (`rim.chat.get_message`), or null.
#[tauri::command]
pub async fn message_cache_plugin_message(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    message_id: String,
    scope: PluginReadScope,
) -> Result<Option<PluginMessage>, CacheError> {
    with_store(state, account, move |store| {
        store.plugin_message(&workspace_id, &message_id, &scope)
    })
    .await
}

/// Local search as a plugin reads it (`rim.chat.search_messages`), newest first.
#[tauri::command]
pub async fn message_cache_plugin_search(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    query: String,
    conversation_id: Option<String>,
    limit: Option<u32>,
    scope: PluginReadScope,
) -> Result<Vec<PluginMessage>, CacheError> {
    with_store(state, account, move |store| {
        store.plugin_search(
            &workspace_id,
            &query,
            conversation_id.as_deref(),
            limit,
            &scope,
        )
    })
    .await
}

/// Search the account's cached messages in a workspace: a page of hits, newest first, older
/// than `after` (the previous page's last hit) when given.
#[tauri::command]
pub async fn message_cache_search(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    query: LocalSearchQuery,
    after: Option<TimelineCursor>,
    limit: u32,
) -> Result<LocalSearchPage, CacheError> {
    with_store(state, account, move |store| {
        store.search(&workspace_id, &query, after.as_ref(), limit)
    })
    .await
}

/// Keep the latest copy of a list the app needs offline (see `snapshot.rs`). `workspaceId` is
/// null for the account-wide kinds.
#[tauri::command]
pub async fn message_cache_snapshot_put(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    kind: SnapshotKind,
    workspace_id: Option<String>,
    value: serde_json::Value,
) -> Result<(), CacheError> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    with_store(state, account, move |store| {
        store.put_snapshot(kind, workspace_id.as_deref(), &value, now_ms)
    })
    .await
}

/// The latest copy of a list, or null when none was saved on this device.
#[tauri::command]
pub async fn message_cache_snapshot_get(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    kind: SnapshotKind,
    workspace_id: Option<String>,
) -> Result<Option<Snapshot>, CacheError> {
    with_store(state, account, move |store| {
        store.get_snapshot(kind, workspace_id.as_deref())
    })
    .await
}
