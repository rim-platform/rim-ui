//! Tauri commands of the history archive. File and crypto work runs on the blocking pool.
//!
//! The folder picker is a native dialog opened from here, so the webview needs no `dialog:*`
//! permission and never sees the file system beyond the path the user chose.

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use super::cloud::endpoint::{EndpointCheck, EndpointSetup};
use super::cloud::s3::{S3Check, S3Setup};
use super::cloud::{CloudAuthorization, CloudKind, CloudService};
use super::{
    ArchiveError, ArchiveStatus, ConnectOutcome, ConnectTarget, ExportReport, FolderInfo,
    HistoryArchiveState, RestoreReport,
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

/// The cloud services this build offers (those it has an OAuth client id for).
#[tauri::command]
pub fn history_archive_cloud_services(state: State<'_, HistoryArchiveState>) -> Vec<CloudService> {
    state.cloud_services()
}

/// Sign in to Google Drive or Dropbox in the system browser and look for an archive in the
/// app's folder there. The webview never sees a token: the browser hands the code to a
/// loopback listener on this side.
#[tauri::command]
pub async fn history_archive_cloud_authorize(
    app: AppHandle,
    state: State<'_, HistoryArchiveState>,
    kind: CloudKind,
) -> Result<CloudAuthorization, ArchiveError> {
    let state = state.inner().clone();
    blocking(move || {
        state.cloud_authorize(kind, |url| {
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| ArchiveError::Io(format!("cannot open the browser: {e}")))
        })
    })
    .await
}

/// Check the user's backup endpoint (store, list and read back a probe file) and look for an
/// archive in it. The password or token stays in memory until the archive is connected.
#[tauri::command]
pub async fn history_archive_endpoint_check(
    state: State<'_, HistoryArchiveState>,
    setup: EndpointSetup,
) -> Result<EndpointCheck, ArchiveError> {
    let state = state.inner().clone();
    blocking(move || state.endpoint_check(setup)).await
}

/// Check an S3 bucket (write, read back, list and delete a probe object) and look for an
/// archive in it. The secret access key stays in memory until the archive is connected.
#[tauri::command]
pub async fn history_archive_s3_check(
    state: State<'_, HistoryArchiveState>,
    setup: S3Setup,
) -> Result<S3Check, ArchiveError> {
    let state = state.inner().clone();
    blocking(move || state.s3_check(setup)).await
}

/// Stop waiting for a sign-in in the browser.
#[tauri::command]
pub fn history_archive_cloud_cancel(state: State<'_, HistoryArchiveState>) {
    state.cloud_cancel();
}

/// Drop a signed-in cloud account, or a checked endpoint or bucket, the user did not go on
/// with.
#[tauri::command]
pub async fn history_archive_cloud_discard(
    state: State<'_, HistoryArchiveState>,
    connection_id: String,
) -> Result<(), ArchiveError> {
    let state = state.inner().clone();
    blocking(move || {
        state.cloud_discard(&connection_id);
        Ok(())
    })
    .await
}

/// Archive this account into `target` (a folder, or a cloud account just signed in to): join
/// the archive there with its passphrase, or start one with a new passphrase if there is none.
#[tauri::command]
pub async fn history_archive_connect(
    state: State<'_, HistoryArchiveState>,
    account: AccountId,
    target: ConnectTarget,
    passphrase: String,
) -> Result<ConnectOutcome, ArchiveError> {
    let state = state.inner().clone();
    let passphrase = zeroize::Zeroizing::new(passphrase);
    blocking(move || state.connect(&account, &target, &passphrase)).await
}

/// Give this device the archive key again (the secret vault lost it).
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
