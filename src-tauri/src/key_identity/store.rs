//! Where this device keeps its keys: one OS keyring entry per principal (through
//! `secret_store`), plus a small index saying which account on which server each principal
//! signs in to. Memory in tests.
//!
//! Each entry stays small (a few hundred bytes), well under the 2.5 KB Windows Credential
//! Manager allows per secret.

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::KeyIdentityError;

/// Keyring user name of the account index.
const INDEX_NAME: &str = "key-identity-accounts-v1";
/// Where an unreadable index is kept instead of being overwritten.
const UNREADABLE_INDEX_NAME: &str = "key-identity-accounts-v1.unreadable";

fn record_name(principal_id: &str) -> String {
    format!("key-identity-v1:{principal_id}")
}

/// Raw secret storage, by name.
pub(crate) trait SecretStore: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, KeyIdentityError>;
    fn write(&self, name: &str, value: &str) -> Result<(), KeyIdentityError>;
    /// Deleting what is not there is not an error.
    fn delete(&self, name: &str) -> Result<(), KeyIdentityError>;
}

pub(crate) struct KeyringSecretStore;

impl KeyringSecretStore {
    fn entry(name: &str) -> Result<keyring::Entry, KeyIdentityError> {
        crate::secret_store::entry(name)
            .map_err(|e| KeyIdentityError::Keyring(format!("keyring init failed: {e}")))
    }
}

impl SecretStore for KeyringSecretStore {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<String>>, KeyIdentityError> {
        match Self::entry(name)?.get_password() {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(KeyIdentityError::Keyring(format!(
                "keyring read failed: {e}"
            ))),
        }
    }

    fn write(&self, name: &str, value: &str) -> Result<(), KeyIdentityError> {
        Self::entry(name)?
            .set_password(value)
            .map_err(|e| KeyIdentityError::Keyring(format!("keyring store failed: {e}")))
    }

    fn delete(&self, name: &str) -> Result<(), KeyIdentityError> {
        match Self::entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(KeyIdentityError::Keyring(format!(
                "keyring delete failed: {e}"
            ))),
        }
    }
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
    /// The key log seq the pending rotation creates. Until a verified log reaches it, the
    /// pending key is kept: a log older than the rotation says nothing about it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) pending_identity_seq: Option<u32>,
    /// The server has shown this principal on the account. Until then the keys may belong to
    /// an enrollment or recovery that never happened, and may be cleaned up.
    #[serde(default)]
    pub(crate) confirmed: bool,
    /// The confirmed keys an unconfirmed recovery replaced, put back if the server refuses
    /// the recovery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) replaced: Option<Box<KeyRecord>>,
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

/// The endpoint as compared: surrounding whitespace and a trailing slash do not matter.
pub(crate) fn same_endpoint(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

/// Typed access to the records and the index.
pub(crate) struct Keys<'a>(pub(crate) &'a dyn SecretStore);

impl Keys<'_> {
    pub(crate) fn record(&self, principal_id: &str) -> Result<Option<KeyRecord>, KeyIdentityError> {
        let Some(raw) = self.0.read(&record_name(principal_id))? else {
            return Ok(None);
        };
        let record: KeyRecord = serde_json::from_str(&raw)
            .map_err(|e| KeyIdentityError::Keyring(format!("stored keys are not readable: {e}")))?;
        Ok(Some(record))
    }

    pub(crate) fn put_record(&self, record: &KeyRecord) -> Result<(), KeyIdentityError> {
        let raw = Zeroizing::new(
            serde_json::to_string(record)
                .map_err(|e| KeyIdentityError::Keyring(format!("cannot encode keys: {e}")))?,
        );
        self.0.write(&record_name(&record.principal_id), &raw)
    }

    pub(crate) fn delete_record(&self, principal_id: &str) -> Result<(), KeyIdentityError> {
        self.0.delete(&record_name(principal_id))
    }

    /// The index. An unreadable index is moved aside and read as empty: it holds no secret,
    /// only where keys are used, and the copy keeps what it said for a later repair.
    pub(crate) fn links(&self) -> Result<Vec<AccountLink>, KeyIdentityError> {
        let Some(raw) = self.0.read(INDEX_NAME)? else {
            return Ok(Vec::new());
        };
        match serde_json::from_str(&raw) {
            Ok(links) => Ok(links),
            Err(e) => {
                log::warn!("[key_identity] account index is not readable, starting over: {e}");
                self.0.write(UNREADABLE_INDEX_NAME, &raw)?;
                self.0.delete(INDEX_NAME)?;
                Ok(Vec::new())
            }
        }
    }

    pub(crate) fn put_links(&self, links: &[AccountLink]) -> Result<(), KeyIdentityError> {
        let raw = serde_json::to_string(links)
            .map_err(|e| KeyIdentityError::Keyring(format!("cannot encode index: {e}")))?;
        self.0.write(INDEX_NAME, &raw)
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
            confirmed: false,
            replaced: None,
        }
    }

    #[test]
    fn records_and_links_round_trip_and_forget_removes_both() {
        let store = MemorySecretStore::default();
        let keys = Keys(&store);
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
        assert_eq!(json["confirmed"], false);

        let store = MemorySecretStore::default();
        store.write(INDEX_NAME, "not json").unwrap();
        assert!(Keys(&store).links().unwrap().is_empty());
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
    fn endpoints_compare_without_a_trailing_slash() {
        assert!(same_endpoint("http://h/api", "http://h/api/"));
        assert!(!same_endpoint("http://h/api", "http://other/api"));
    }
}
