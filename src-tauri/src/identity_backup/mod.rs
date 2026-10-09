//! The identity key's backup in the history archive, joining the two Tauri states that hold
//! its parts: key identity holds the identity key and the backup key, the history archive
//! holds the archive key and the files. Keys pass between them here, never through the
//! webview.
//!
//! - **Sync** writes this device's backup of the identity key (sealed under the backup key)
//!   and its wrap of the archive key under the identity key, when this device holds the
//!   head's identity key and the archive is unlocked. It writes nothing that is already there.
//! - **Take over** gives a device that holds only a device key the identity key from a backup,
//!   opened with the recovery phrase and checked against the server's key log.
//! - **Unlock** puts the archive key back on a device from a wrap its identity key opens.

pub(crate) mod commands;

use serde::Serialize;

use crate::history_archive::{ArchiveError, ArchiveStatus, HistoryArchiveState};
use crate::key_identity::statement::Statement;
use crate::key_identity::{KeyIdentityError, KeyIdentityState, LogStatus};
use crate::message_cache::AccountId;

#[derive(Debug, thiserror::Error)]
pub(crate) enum IdentityBackupError {
    #[error(transparent)]
    Keys(#[from] KeyIdentityError),
    #[error(transparent)]
    Archive(#[from] ArchiveError),
    #[error(
        "the history archive holds no backup of this account's identity key: back it up from \
         the computer that holds it"
    )]
    NotFound,
    #[error("no identity key backup in the history archive opens with this recovery phrase")]
    Unreadable,
    #[error(
        "the backups in the history archive hold an older identity key than the account's: \
         open Settings > Security on the computer that holds the current one to back it up"
    )]
    Stale,
}

/// Serialized as `{ kind, message }`, the shape `safeInvoke` narrows; key and archive errors
/// keep their own kinds.
impl Serialize for IdentityBackupError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let kind = match self {
            Self::Keys(e) => return e.serialize(serializer),
            Self::Archive(e) => return e.serialize(serializer),
            Self::NotFound => "IDENTITY_BACKUP_NOT_FOUND",
            Self::Unreadable => "IDENTITY_BACKUP_UNREADABLE",
            Self::Stale => "IDENTITY_BACKUP_STALE",
        };
        let mut s = serializer.serialize_struct("IdentityBackupError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub(crate) type Result<T> = std::result::Result<T, IdentityBackupError>;

/// Where the account's history archive stands on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ArchiveState {
    NotConfigured,
    Locked,
    Ready,
}

/// The identity key's backup as this device sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityBackupStatus {
    pub archive: ArchiveState,
    /// This device holds the head's identity key.
    pub holds_identity_key: bool,
    /// This device holds the backup key, so it can write a backup.
    pub has_backup_key: bool,
    /// The archive holds this device's backup of the current identity key.
    pub backed_up: bool,
    /// The archive holds a wrap of its key under the current identity key.
    pub wrapped: bool,
}

fn archive_state(archive: &HistoryArchiveState, account: &AccountId) -> Result<ArchiveState> {
    let status = archive.status(account)?;
    Ok(if !status.configured {
        ArchiveState::NotConfigured
    } else if !status.unlocked {
        ArchiveState::Locked
    } else {
        ArchiveState::Ready
    })
}

/// Write this device's backup and wrap for the account, if it holds the head's identity key
/// and the archive is unlocked here; otherwise only report why not.
pub(crate) fn sync(
    keys: &KeyIdentityState,
    archive: &HistoryArchiveState,
    account: &AccountId,
    principal_id: &str,
    log: &[Statement],
) -> Result<IdentityBackupStatus> {
    let material = match keys.backup_material(principal_id, log) {
        Ok(material) => Some(material),
        Err(KeyIdentityError::NoIdentityKey | KeyIdentityError::NoKeys) => None,
        Err(e) => return Err(e.into()),
    };
    let state = archive_state(archive, account)?;
    let mut status = IdentityBackupStatus {
        archive: state,
        holds_identity_key: material.is_some(),
        has_backup_key: material.as_ref().is_some_and(|m| m.record.is_some()),
        backed_up: false,
        wrapped: false,
    };
    let Some(material) = material else {
        return Ok(status);
    };
    if state != ArchiveState::Ready {
        return Ok(status);
    }
    let backup = material
        .record
        .as_ref()
        .map(|(key, plaintext)| (&**key, plaintext.as_slice()));
    archive.write_identity(account, backup, &material.wrap_key)?;
    status.backed_up = status.has_backup_key;
    status.wrapped = true;
    Ok(status)
}

/// Keep the backup key of `secret` on this device, then sync.
pub(crate) fn enable(
    keys: &KeyIdentityState,
    archive: &HistoryArchiveState,
    account: &AccountId,
    principal_id: &str,
    log: &[Statement],
    secret: &str,
) -> Result<IdentityBackupStatus> {
    keys.set_backup_key(principal_id, log, secret)?;
    sync(keys, archive, account, principal_id, log)
}

/// Take the identity key over from the archive's backups, opened with `secret`. Then this
/// device writes a backup and wrap of its own; a failure there is logged, since the takeover
/// itself is done.
pub(crate) fn take_over(
    keys: &KeyIdentityState,
    archive: &HistoryArchiveState,
    account: &AccountId,
    principal_id: &str,
    log: &[Statement],
    secret: &str,
) -> Result<LogStatus> {
    let backup_key = keys.begin_takeover(principal_id, log, secret)?;
    let backups = archive.read_identity_backups(account, &backup_key)?;
    if backups.found == 0 {
        return Err(IdentityBackupError::NotFound);
    }
    if backups.opened.is_empty() {
        return Err(IdentityBackupError::Unreadable);
    }
    let status = keys
        .finish_takeover(principal_id, log, &backup_key, &backups.opened)?
        .ok_or(IdentityBackupError::Stale)?;
    if let Err(e) = sync(keys, archive, account, principal_id, log) {
        log::warn!("[identity_backup] backing up after a takeover failed: {e}");
    }
    Ok(status)
}

/// Whether a wrap in the archive opens with an identity key this device holds.
pub(crate) fn can_unlock(
    keys: &KeyIdentityState,
    archive: &HistoryArchiveState,
    account: &AccountId,
    principal_id: &str,
) -> Result<bool> {
    let wrap_keys = keys.archive_wrap_keys(principal_id)?;
    Ok(archive.can_unlock_with_identity(account, &wrap_keys)?)
}

/// Put the archive key back on this device from a wrap its identity key opens.
pub(crate) fn unlock(
    keys: &KeyIdentityState,
    archive: &HistoryArchiveState,
    account: &AccountId,
    principal_id: &str,
) -> Result<ArchiveStatus> {
    let wrap_keys = keys.archive_wrap_keys(principal_id)?;
    Ok(archive.unlock_with_identity(account, &wrap_keys)?)
}

#[cfg(test)]
mod tests;
