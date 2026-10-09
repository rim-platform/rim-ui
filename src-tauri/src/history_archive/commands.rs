//! Tauri commands of the history archive. File and crypto work runs on the blocking pool.
//!
//! The folder picker is a native dialog opened from here, so the webview needs no `dialog:*`
//! permission and never sees the file system beyond the path the user chose.

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use super::{
    ArchiveError, ArchiveStatus, ConnectOutcome, ExportReport, FolderInfo, HistoryArchiveState,
    RestoreReport,
};
use crate::message_cache::{AccountId, MessageCacheState};

async fn blocking<T, F>(f: F) -> Result<T, ArchiveError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ArchiveError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| ArchiveError::Io(format!("archive task failed: {e}")))?
}

/// Ask the user for a folder. `null` when they cancel.
#[tauri::command]
pub async fn history_archive_pick_folder(app: AppHandle) -> Result<Option<String>, ArchiveError> {
    blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose a folder for your RIM history")
            .blocking_pick_folder();
        match picked {
            None => Ok(None),
            Some(path) => path
                .into_path()
                .map(|p| Some(p.display().to_string()))
                .map_err(|e| ArchiveError::Invalid(format!("not a local folder: {e}"))),
        }
    })
    .await
}

/// Whether `folder` already holds an archive.
#[tauri::command]
pub async fn history_archive_inspect_folder(folder: String) -> Result<FolderInfo, ArchiveError> {
    blocking(move || HistoryArchiveState::inspect_folder(&folder)).await
}

#[tauri::command]
pub async fn history_archive_status(
    state: State<'_, HistoryArchiveState>,
    account: AccountId,
) -> Result<ArchiveStatus, ArchiveError> {
    let state = state.inner().clone();
    blocking(move || state.status(&account)).await
}

/// Archive this account into `folder`: join the archive there with its passphrase, or start
/// one with a new passphrase if the folder has none.
#[tauri::command]
pub async fn history_archive_connect(
    state: State<'_, HistoryArchiveState>,
    account: AccountId,
    folder: String,
    passphrase: String,
) -> Result<ConnectOutcome, ArchiveError> {
    let state = state.inner().clone();
    let passphrase = zeroize::Zeroizing::new(passphrase);
    blocking(move || state.connect(&account, &folder, &passphrase)).await
}

/// Give this device the archive key again (the OS keyring lost it).
#[tauri::command]
pub async fn history_archive_unlock(
    state: State<'_, HistoryArchiveState>,
    account: AccountId,
    passphrase: String,
) -> Result<ArchiveStatus, ArchiveError> {
    let state = state.inner().clone();
    let passphrase = zeroize::Zeroizing::new(passphrase);
    blocking(move || state.unlock(&account, &passphrase)).await
}

/// Stop archiving this account on this device; the archive's files stay.
#[tauri::command]
pub async fn history_archive_disconnect(
    state: State<'_, HistoryArchiveState>,
    account: AccountId,
) -> Result<(), ArchiveError> {
    let state = state.inner().clone();
    blocking(move || state.disconnect(&account)).await
}

/// Export what the cache changed since the last export.
#[tauri::command]
pub async fn history_archive_export(
    state: State<'_, HistoryArchiveState>,
    cache: State<'_, MessageCacheState>,
    account: AccountId,
) -> Result<ExportReport, ArchiveError> {
    let state = state.inner().clone();
    let store = cache.store(&account)?;
    blocking(move || state.export(&store, &account)).await
}

/// Merge every device's archived history into the cache.
#[tauri::command]
pub async fn history_archive_restore(
    state: State<'_, HistoryArchiveState>,
    cache: State<'_, MessageCacheState>,
    account: AccountId,
) -> Result<RestoreReport, ArchiveError> {
    let state = state.inner().clone();
    let store = cache.store(&account)?;
    blocking(move || state.restore(&store, &account)).await
}
