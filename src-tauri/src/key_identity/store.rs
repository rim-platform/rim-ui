//! Where this device keeps its keys: one secret vault record per principal (through
//! `secret_store`), plus a small index saying which account on which server each principal
//! signs in to. Memory in tests.
//!
//! Each principal's record is sealed a second time under the account's data key
//! (`account_lock`, store key "desktop vault", the record's name as associated data), except
//! what signing in needs before the data key can be had: the device key, the device's id and
//! name, and whether the server and the person confirmed the keys. The identity key, a pending
//! one, the backup key, the recovery kit's entropy and the keys a recovery replaced open only
//! while the account is unlocked. A record written while the account is locked (a signup,
//! recovery or device link, before its first unlock) keeps them under the vault key alone
//! until [`Keys::seal_record`] seals it at the next unlock. Pending device links are sealed
//! whole and written only while their account is unlocked. The index stays under the vault
//! key alone: the sign-in screen lists the accounts before any is unlocked.

#[cfg(test)]
use std::collections::HashMap;
use std::sync::Arc;
#[cfg(test)]
use std::sync::Mutex;

use rim_opaque::StoreKeyLabel;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::account_lock::{AccountLock, AccountLockError};
use crate::secret_store::{SecretVault, VaultError};

use super::device_link::Sealed;
use super::statement::Statement;
use super::KeyIdentityError;

/// Secret name of the account index.
const INDEX_NAME: &str = "key-identity-accounts-v1";
/// Where an unreadable index is kept instead of being overwritten.
const UNREADABLE_INDEX_NAME: &str = "key-identity-accounts-v1.unreadable";

/// Secret name of the list of pending device links (link ids).
const PENDING_LINKS_NAME: &str = "device-links-v1";

fn record_name(principal_id: &str) -> String {
    format!("key-identity-v1:{principal_id}")
}

fn pending_link_name(link_id: &str) -> String {
    format!("device-link-v1:{link_id}")
}

/// Raw secret storage, by name.
pub(crate) trait SecretStore: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, KeyIdentityError>;
    fn write(&self, name: &str, value: &str) -> Result<(), KeyIdentityError>;
    /// Deleting what is not there is not an error.
    fn delete(&self, name: &str) -> Result<(), KeyIdentityError>;
}

/// The secrets in the app's secret vault.
pub(crate) struct VaultSecretStore(pub(crate) Arc<SecretVault>);

impl SecretStore for VaultSecretStore {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, KeyIdentityError> {
        self.0.read(name).map_err(vault_error)
    }

    fn write(&self, name: &str, value: &str) -> Result<(), KeyIdentityError> {
        self.0.write(name, value).map_err(vault_error)
    }

    fn delete(&self, name: &str) -> Result<(), KeyIdentityError> {
        self.0.delete(name).map_err(vault_error)
    }
}

fn vault_error(e: VaultError) -> KeyIdentityError {
    KeyIdentityError::Keyring(e.to_string())
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct MemorySecretStore(Mutex<HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemorySecretStore {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, KeyIdentityError> {
        let map = self.0.lock().map_err(|_| poisoned())?;
        Ok(map.get(name).cloned().map(Zeroizing::new))
    }

    fn write(&self, name: &str, value: &str) -> Result<(), KeyIdentityError> {
        let mut map = self.0.lock().map_err(|_| poisoned())?;
        map.insert(name.to_string(), value.to_string());
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), KeyIdentityError> {
        let mut map = self.0.lock().map_err(|_| poisoned())?;
        map.remove(name);
        Ok(())
    }
}

#[cfg(test)]
fn poisoned() -> KeyIdentityError {
    KeyIdentityError::Keyring("key store lock poisoned".into())
}

/// One principal's keys on this device.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyRecord {
    pub(crate) v: u8,
    pub(crate) principal_id: String,
    pub(crate) device_id: String,
    pub(crate) device_name: String,
    /// base64url of the device key seed.
    pub(crate) device_seed: Zeroizing<String>,
    /// The identity key, on the device that enrolled it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) identity_seed: Option<Zeroizing<String>>,
    /// A new identity key sent in a rotation the server has not confirmed yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) pending_identity_seed: Option<Zeroizing<String>>,
    /// base64url of the identity backup key, on a device that saw the recovery kit's secret
    /// (it enrolled, recovered or took over the account) or was given it later.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) backup_key: Option<Zeroizing<String>>,
    /// The key log seq the pending rotation creates. Until a verified log reaches it, the
    /// pending key is kept: a log older than the rotation says nothing about it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) pending_identity_seq: Option<u32>,
    /// base64url of the recovery kit's 16 entropy bytes, kept until the person confirms they
    /// saved the kit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) recovery_entropy: Option<Zeroizing<String>>,
    /// Whether the person confirmed saving the recovery kit. Absent on a linked device and on
    /// keys stored before the kit was kept: such a record keeps nothing of the kit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) kit_confirmed: Option<bool>,
    /// The server has shown this principal on the account. Until then the keys may belong to
    /// an enrollment or recovery that never happened, and may be cleaned up.
    #[serde(default)]
    pub(crate) confirmed: bool,
    /// The confirmed keys an unconfirmed recovery replaced, put back if the server refuses
    /// the recovery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) replaced: Option<Box<KeyRecord>>,
    /// The fields of [`SealedFields`] sealed under the account's data key, as stored: set on a
    /// record read while the account is locked, whose sealed fields then read as absent, and
    /// written back unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sealed: Option<String>,
}

impl KeyRecord {
    /// Whether the record's sealed fields did not open: the account is locked.
    pub(crate) fn is_locked(&self) -> bool {
        self.sealed.is_some()
    }

    fn has_sealed_fields(&self) -> bool {
        self.identity_seed.is_some()
            || self.pending_identity_seed.is_some()
            || self.backup_key.is_some()
            || self.recovery_entropy.is_some()
            || self.replaced.is_some()
    }
}

/// The fields of a [`KeyRecord`] that open only while its account is unlocked.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SealedFields {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    identity_seed: Option<Zeroizing<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pending_identity_seed: Option<Zeroizing<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    backup_key: Option<Zeroizing<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recovery_entropy: Option<Zeroizing<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    replaced: Option<Box<KeyRecord>>,
}

impl SealedFields {
    fn take_from(record: &mut KeyRecord) -> Self {
        Self {
            identity_seed: record.identity_seed.take(),
            pending_identity_seed: record.pending_identity_seed.take(),
            backup_key: record.backup_key.take(),
            recovery_entropy: record.recovery_entropy.take(),
            replaced: record.replaced.take(),
        }
    }

    fn put_into(self, record: &mut KeyRecord) {
        record.identity_seed = self.identity_seed;
        record.pending_identity_seed = self.pending_identity_seed;
        record.backup_key = self.backup_key;
        record.recovery_entropy = self.recovery_entropy;
        record.replaced = self.replaced;
    }
}

/// A pending device link as stored: sealed whole under its account's data key.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SealedLink {
    principal_id: String,
    sealed: String,
}

/// Which account on which server a principal signs in to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountLink {
    pub(crate) endpoint: String,
    pub(crate) principal_id: String,
    /// Unknown right after a recovery, until the first sign-in.
    #[serde(default)]
    pub(crate) user_id: Option<String>,
    #[serde(default)]
    pub(crate) username: Option<String>,
}

/// A device link this device confirmed as the old device, written before `addDeviceKey`. A
/// restart uses it to send the answer again or revoke a certified device nobody used.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingLink {
    pub(crate) v: u8,
    pub(crate) link_id: String,
    /// base64url of the link secret.
    pub(crate) secret: Zeroizing<String>,
    pub(crate) endpoint: String,
    pub(crate) principal_id: String,
    pub(crate) device_id: String,
    pub(crate) device_key: String,
    pub(crate) certificate: Statement,
    /// The sealed answer, resent byte for byte.
    pub(crate) answer: Sealed,
}

/// The endpoint as compared: surrounding whitespace and a trailing slash do not matter.
pub(crate) fn same_endpoint(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

fn lock_error(e: AccountLockError) -> KeyIdentityError {
    match e {
        AccountLockError::Locked => KeyIdentityError::Locked,
        other => KeyIdentityError::Crypto(other.to_string()),
    }
}

/// Typed access to the records and the index; `lock` holds the data keys that seal them.
pub(crate) struct Keys<'a> {
    pub(crate) store: &'a dyn SecretStore,
    pub(crate) lock: &'a AccountLock,
}

impl<'a> Keys<'a> {
    pub(crate) fn new(store: &'a dyn SecretStore, lock: &'a AccountLock) -> Self {
        Self { store, lock }
    }

    /// The principal's record, every field open.
    ///
    /// # Errors
    /// [`KeyIdentityError::Locked`] when its sealed fields need the data key and the account is
    /// locked.
    pub(crate) fn record(&self, principal_id: &str) -> Result<Option<KeyRecord>, KeyIdentityError> {
        match self.device_record(principal_id)? {
            Some(record) if record.is_locked() => Err(KeyIdentityError::Locked),
            other => Ok(other),
        }
    }

    /// The principal's record as far as it opens: while the account is locked, a sealed
    /// record's sealed fields read as absent and [`KeyRecord::is_locked`] says so. Enough for
    /// the device key and the record's plain fields.
    pub(crate) fn device_record(
        &self,
        principal_id: &str,
    ) -> Result<Option<KeyRecord>, KeyIdentityError> {
        let name = record_name(principal_id);
        let Some(raw) = self.store.read(&name)? else {
            return Ok(None);
        };
        let mut record: KeyRecord = serde_json::from_str(&raw)
            .map_err(|e| KeyIdentityError::Keyring(format!("stored keys are not readable: {e}")))?;
        let Some(sealed) = record.sealed.clone() else {
            return Ok(Some(record));
        };
        let opened =
            match self
                .lock
                .open_record(principal_id, StoreKeyLabel::DesktopVault, &name, &sealed)
            {
                Ok(opened) => opened,
                Err(AccountLockError::Locked) => return Ok(Some(record)),
                Err(e) => {
                    // Sealed under an earlier data key: the account started empty on this device,
                    // so the sealed fields are gone, and the next write drops them.
                    log::warn!("[key_identity] the sealed keys of an account do not open: {e}");
                    record.sealed = None;
                    return Ok(Some(record));
                }
            };
        let fields: SealedFields = serde_json::from_slice(&opened)
            .map_err(|e| KeyIdentityError::Keyring(format!("stored keys are not readable: {e}")))?;
        fields.put_into(&mut record);
        record.sealed = None;
        Ok(Some(record))
    }

    /// Writes `record`. Its sealed fields are sealed under the account's data key while it is
    /// unlocked, and kept under the vault key alone while it is locked. A record read locked is
    /// written back with its sealed fields as they were.
    ///
    /// # Errors
    /// [`KeyIdentityError::Locked`] for a record read locked that was given sealed fields.
    pub(crate) fn put_record(&self, record: &KeyRecord) -> Result<(), KeyIdentityError> {
        let name = record_name(&record.principal_id);
        let mut stored = record.clone();
        if stored.is_locked() {
            if stored.has_sealed_fields() {
                return Err(KeyIdentityError::Locked);
            }
        } else if stored.has_sealed_fields() && self.lock.is_unlocked(&record.principal_id) {
            let fields = Zeroizing::new(
                serde_json::to_vec(&SealedFields::take_from(&mut stored))
                    .map_err(|e| KeyIdentityError::Keyring(format!("cannot encode keys: {e}")))?,
            );
            stored.sealed = Some(
                self.lock
                    .seal_record(
                        &record.principal_id,
                        StoreKeyLabel::DesktopVault,
                        &name,
                        &fields,
                    )
                    .map_err(lock_error)?,
            );
        }
        let raw = Zeroizing::new(
            serde_json::to_string(&stored)
                .map_err(|e| KeyIdentityError::Keyring(format!("cannot encode keys: {e}")))?,
        );
        self.store.write(&name, &raw)
    }

    /// Seals the principal's record under its data key when it holds sealed fields under the
    /// vault key alone, and its pending device links likewise. Keys a recovery replaced go
    /// once the server confirmed the record. Nothing happens while the account is locked.
    pub(crate) fn seal_record(&self, principal_id: &str) -> Result<(), KeyIdentityError> {
        if !self.lock.is_unlocked(principal_id) {
            return Ok(());
        }
        let raw = self.store.read(&record_name(principal_id))?;
        let plain = raw.as_deref().is_some_and(|raw| {
            serde_json::from_str::<KeyRecord>(raw)
                .is_ok_and(|r| !r.is_locked() && r.has_sealed_fields())
        });
        if let Some(mut record) = self.record(principal_id)? {
            let stale = record.confirmed && record.replaced.is_some();
            if stale {
                record.replaced = None;
            }
            if plain || stale {
                self.put_record(&record)?;
            }
        }
        for link_id in self.pending_link_ids()? {
            let Some(raw) = self.store.read(&pending_link_name(&link_id))? else {
                continue;
            };
            if let Ok(link) = serde_json::from_str::<PendingLink>(&raw) {
                if link.principal_id == principal_id {
                    self.write_pending_link(&link)?;
                }
            }
        }
        Ok(())
    }

    pub(crate) fn delete_record(&self, principal_id: &str) -> Result<(), KeyIdentityError> {
        self.store.delete(&record_name(principal_id))
    }

    /// The principal a signed-in account on `endpoint` belongs to, as far as the index knows.
    pub(crate) fn principal_of(
        &self,
        endpoint: &str,
        user_id: &str,
    ) -> Result<Option<String>, KeyIdentityError> {
        Ok(self
            .links()?
            .into_iter()
            .find(|l| same_endpoint(&l.endpoint, endpoint) && l.user_id.as_deref() == Some(user_id))
            .map(|l| l.principal_id))
    }

    /// The index. An unreadable index is moved aside and read as empty: it holds no secret,
    /// only where keys are used, and the copy keeps what it said for a later repair.
    pub(crate) fn links(&self) -> Result<Vec<AccountLink>, KeyIdentityError> {
        let Some(raw) = self.store.read(INDEX_NAME)? else {
            return Ok(Vec::new());
        };
        match serde_json::from_str(&raw) {
            Ok(links) => Ok(links),
            Err(e) => {
                log::warn!("[key_identity] account index is not readable, starting over: {e}");
                self.store.write(UNREADABLE_INDEX_NAME, &raw)?;
                self.store.delete(INDEX_NAME)?;
                Ok(Vec::new())
            }
        }
    }

    pub(crate) fn put_links(&self, links: &[AccountLink]) -> Result<(), KeyIdentityError> {
        let raw = serde_json::to_string(links)
            .map_err(|e| KeyIdentityError::Keyring(format!("cannot encode index: {e}")))?;
        self.store.write(INDEX_NAME, &raw)
    }

    /// The pending device links of unlocked accounts. One that cannot be read, or whose
    /// account is locked, is skipped and kept, so a later version or unlock can still read it.
    pub(crate) fn pending_links(&self) -> Result<Vec<PendingLink>, KeyIdentityError> {
        let mut out = Vec::new();
        for link_id in self.pending_link_ids()? {
            let name = pending_link_name(&link_id);
            let Some(raw) = self.store.read(&name)? else {
                continue;
            };
            let link = match serde_json::from_str::<SealedLink>(&raw) {
                Ok(sealed) => self
                    .lock
                    .open_record(
                        &sealed.principal_id,
                        StoreKeyLabel::DesktopVault,
                        &name,
                        &sealed.sealed,
                    )
                    .map_err(|e| e.to_string())
                    .and_then(|opened| {
                        serde_json::from_slice::<PendingLink>(&opened).map_err(|e| e.to_string())
                    }),
                Err(_) => serde_json::from_str::<PendingLink>(&raw).map_err(|e| e.to_string()),
            };
            match link {
                Ok(link) => out.push(link),
                Err(e) => log::warn!("[key_identity] a pending device link is not readable: {e}"),
            }
        }
        Ok(out)
    }

    /// Write a pending link, sealed under its account's data key, and add it to the list.
    ///
    /// # Errors
    /// [`KeyIdentityError::Locked`] while the account is locked.
    pub(crate) fn put_pending_link(&self, link: &PendingLink) -> Result<(), KeyIdentityError> {
        self.write_pending_link(link)?;
        let mut ids = self.pending_link_ids()?;
        if !ids.contains(&link.link_id) {
            ids.push(link.link_id.clone());
            self.put_pending_link_ids(&ids)?;
        }
        Ok(())
    }

    fn write_pending_link(&self, link: &PendingLink) -> Result<(), KeyIdentityError> {
        let name = pending_link_name(&link.link_id);
        let plain = Zeroizing::new(
            serde_json::to_vec(link)
                .map_err(|e| KeyIdentityError::Keyring(format!("cannot encode a link: {e}")))?,
        );
        let sealed = SealedLink {
            principal_id: link.principal_id.clone(),
            sealed: self
                .lock
                .seal_record(
                    &link.principal_id,
                    StoreKeyLabel::DesktopVault,
                    &name,
                    &plain,
                )
                .map_err(lock_error)?,
        };
        let raw = serde_json::to_string(&sealed)
            .map_err(|e| KeyIdentityError::Keyring(format!("cannot encode a link: {e}")))?;
        self.store.write(&name, &raw)
    }

    /// Delete a pending link and drop it from the list.
    pub(crate) fn delete_pending_link(&self, link_id: &str) -> Result<(), KeyIdentityError> {
        self.store.delete(&pending_link_name(link_id))?;
        let mut ids = self.pending_link_ids()?;
        if ids.iter().any(|id| id == link_id) {
            ids.retain(|id| id != link_id);
            self.put_pending_link_ids(&ids)?;
        }
        Ok(())
    }

    /// An unreadable list reads as empty: the records it named stay stored, unused.
    fn pending_link_ids(&self) -> Result<Vec<String>, KeyIdentityError> {
        let Some(raw) = self.store.read(PENDING_LINKS_NAME)? else {
            return Ok(Vec::new());
        };
        Ok(serde_json::from_str(&raw).unwrap_or_else(|e| {
            log::warn!("[key_identity] the pending device link list is not readable: {e}");
            Vec::new()
        }))
    }

    fn put_pending_link_ids(&self, ids: &[String]) -> Result<(), KeyIdentityError> {
        let raw = serde_json::to_string(ids)
            .map_err(|e| KeyIdentityError::Keyring(format!("cannot encode the links: {e}")))?;
        self.store.write(PENDING_LINKS_NAME, &raw)
    }

    /// Delete a principal's keys and every link to them.
    pub(crate) fn forget(&self, principal_id: &str) -> Result<(), KeyIdentityError> {
        let links: Vec<AccountLink> = self
            .links()?
            .into_iter()
            .filter(|l| l.principal_id != principal_id)
            .collect();
        self.put_links(&links)?;
        self.delete_record(principal_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(principal: &str) -> KeyRecord {
        KeyRecord {
            v: 1,
            principal_id: principal.into(),
            device_id: "d".into(),
            device_name: "Laptop".into(),
            device_seed: Zeroizing::new("seed".into()),
            identity_seed: None,
            pending_identity_seed: None,
            pending_identity_seq: None,
            backup_key: None,
            recovery_entropy: None,
            kit_confirmed: None,
            confirmed: false,
            replaced: None,
            sealed: None,
        }
    }

    #[test]
    fn records_and_links_round_trip_and_forget_removes_both() {
        let store = MemorySecretStore::default();
        let lock = AccountLock::in_memory();
        let keys = Keys::new(&store, &lock);
        keys.put_record(&record("rimp1_a")).unwrap();
        keys.put_links(&[AccountLink {
            endpoint: "http://localhost:8080/api".into(),
            principal_id: "rimp1_a".into(),
            user_id: Some("u".into()),
            username: None,
        }])
        .unwrap();
        assert_eq!(
            keys.record("rimp1_a").unwrap().unwrap().device_name,
            "Laptop"
        );
        assert_eq!(keys.links().unwrap().len(), 1);

        keys.forget("rimp1_a").unwrap();
        assert!(keys.record("rimp1_a").unwrap().is_none());
        assert!(keys.links().unwrap().is_empty());
    }

    #[test]
    fn the_record_omits_absent_keys_and_an_unreadable_index_is_empty() {
        let json = serde_json::to_value(record("rimp1_a")).unwrap();
        assert!(json.get("identitySeed").is_none());
        assert!(json.get("recoveryEntropy").is_none() && json.get("kitConfirmed").is_none());
        assert_eq!(json["confirmed"], false);

        let store = MemorySecretStore::default();
        store.write(INDEX_NAME, "not json").unwrap();
        assert!(Keys::new(&store, &AccountLock::in_memory())
            .links()
            .unwrap()
            .is_empty());
        assert_eq!(
            store
                .read(UNREADABLE_INDEX_NAME)
                .unwrap()
                .as_deref()
                .map(String::as_str),
            Some("not json")
        );
    }

    #[test]
    fn a_record_written_before_the_kit_was_kept_still_loads_and_keeps_nothing_of_it() {
        let store = MemorySecretStore::default();
        store
            .write(
                &record_name("rimp1_a"),
                r#"{"v":1,"principalId":"rimp1_a","deviceId":"d","deviceName":"Laptop","deviceSeed":"seed","identitySeed":"id","backupKey":"bk","confirmed":true}"#,
            )
            .unwrap();
        let loaded = Keys::new(&store, &AccountLock::in_memory())
            .record("rimp1_a")
            .unwrap()
            .unwrap();
        assert!(loaded.recovery_entropy.is_none());
        assert_eq!(loaded.kit_confirmed, None);
        assert!(loaded.confirmed);
    }

    #[test]
    fn endpoints_compare_without_a_trailing_slash() {
        assert!(same_endpoint("http://h/api", "http://h/api/"));
        assert!(!same_endpoint("http://h/api", "http://other/api"));
    }
}
