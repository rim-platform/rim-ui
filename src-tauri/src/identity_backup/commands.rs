//! Tauri commands of the identity key backup. Key storage and archive work runs on the blocking
//! pool.

use tauri::State;
use zeroize::Zeroizing;

use super::{IdentityBackupStatus, Result};
use crate::history_archive::{ArchiveError, ArchiveStatus, HistoryArchiveState};
use crate::key_identity::statement::Statement;
use crate::key_identity::{KeyIdentityState, LogStatus};
use crate::message_cache::AccountId;

async fn blocking<T, F>(
    keys: &State<'_, KeyIdentityState>,
    archive: &State<'_, HistoryArchiveState>,
    f: F,
) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(KeyIdentityState, HistoryArchiveState) -> Result<T> + Send + 'static,
{
    let keys = keys.inner().clone();
    let archive = archive.inner().clone();
    tauri::async_runtime::spawn_blocking(move || f(keys, archive))
        .await
        .map_err(|e| ArchiveError::Io(format!("identity backup task failed: {e}")))?
}

/// Back up the identity key and wrap the archive key under it, if this device can; say where
/// the backup stands.
#[tauri::command]
pub async fn identity_backup_sync(
    keys: State<'_, KeyIdentityState>,
    archive: State<'_, HistoryArchiveState>,
    account: AccountId,
    principal_id: String,
    key_log: Vec<Statement>,
) -> Result<IdentityBackupStatus> {
    blocking(&keys, &archive, move |keys, archive| {
        super::sync(&keys, &archive, &account, &principal_id, &key_log)
    })
    .await
}

/// Turn the backup on with the recovery phrase (or `RK1-` key), on a device that holds the
/// identity key but never saw the kit's secret.
#[tauri::command]
pub async fn identity_backup_enable(
    keys: State<'_, KeyIdentityState>,
    archive: State<'_, HistoryArchiveState>,
    account: AccountId,
    principal_id: String,
    key_log: Vec<Statement>,
    secret: Zeroizing<String>,
) -> Result<IdentityBackupStatus> {
    blocking(&keys, &archive, move |keys, archive| {
        super::enable(&keys, &archive, &account, &principal_id, &key_log, &secret)
    })
    .await
}

/// Take the identity key over from its backup in the archive, with the recovery phrase.
#[tauri::command]
pub async fn identity_backup_take_over(
    keys: State<'_, KeyIdentityState>,
    archive: State<'_, HistoryArchiveState>,
    account: AccountId,
    principal_id: String,
    key_log: Vec<Statement>,
    secret: Zeroizing<String>,
) -> Result<LogStatus> {
    blocking(&keys, &archive, move |keys, archive| {
        super::take_over(&keys, &archive, &account, &principal_id, &key_log, &secret)
    })
    .await
}

/// Whether this device's identity key opens a copy of the archive key.
#[tauri::command]
pub async fn identity_backup_can_unlock_archive(
    keys: State<'_, KeyIdentityState>,
    archive: State<'_, HistoryArchiveState>,
    account: AccountId,
    principal_id: String,
) -> Result<bool> {
    blocking(&keys, &archive, move |keys, archive| {
        super::can_unlock(&keys, &archive, &account, &principal_id)
    })
    .await
}

/// Unlock the archive on this device with its identity key instead of the passphrase.
#[tauri::command]
pub async fn identity_backup_unlock_archive(
    keys: State<'_, KeyIdentityState>,
    archive: State<'_, HistoryArchiveState>,
    account: AccountId,
    principal_id: String,
) -> Result<ArchiveStatus> {
    blocking(&keys, &archive, move |keys, archive| {
        super::unlock(&keys, &archive, &account, &principal_id)
    })
    .await
}
