//! Tauri commands of the message cache. Each names its account, so a request still in flight
//! from a previous account can only ever touch that account's own database.
//!
//! Database work runs on the blocking pool, never on the main thread.

use tauri::State;

use super::feed::{ChangesRequest, ConversationChanges};
use super::search::{LocalSearchPage, LocalSearchQuery};
use super::store::{TimelineCursor, TimelinePage};
use super::{AccountId, CacheError, MessageCacheState};

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

/// Apply a `messageChanges` answer. Returns the next input, or null when the sync is done.
#[tauri::command]
pub async fn message_cache_sync_apply(
    state: State<'_, MessageCacheState>,
    account: AccountId,
    workspace_id: String,
    changes: Vec<ConversationChanges>,
) -> Result<Option<ChangesRequest>, CacheError> {
    with_store(state, account, move |store| {
        store.apply_changes(&workspace_id, changes)
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
