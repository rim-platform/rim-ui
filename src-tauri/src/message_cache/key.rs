//! The cache keys: one random 256-bit key per account, kept in the secret vault sealed under
//! the account's data key (`account_lock`, store key "cache key", the record's name as
//! associated data), so an account's cache opens only while the account is unlocked.
//!
//! Every account's cache database is encrypted with its key (SQLCipher raw key). All key
//! handling stays in this module; the rest of the cache only sees [`CacheKey`].

use std::sync::Arc;

use rim_opaque::StoreKeyLabel;
use zeroize::Zeroizing;

use crate::account_lock::{AccountLock, AccountLockError};
use crate::key_identity::KeyIdentityState;
use crate::secret_store::SecretVault;

use super::{AccountId, CacheError};

/// Secret name prefix of the cache keys; the name ends with the account's file stem, a hash
/// of its endpoint and user id.
const SECRET_PREFIX: &str = "message-cache-key-v1:";
/// Secret name of the one key per installation that every cache used before the per-account
/// keys. It is deleted once an account's key is made; the caches under it are recreated.
const LEGACY_SECRET_NAME: &str = "message-cache-key-v1";

fn secret_name(account: &AccountId) -> String {
    format!("{SECRET_PREFIX}{}", account.file_stem())
}

/// A 256-bit SQLCipher key. Zeroed on drop.
#[derive(Clone)]
pub(crate) struct CacheKey(Zeroizing<[u8; 32]>);

impl CacheKey {
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    /// The key as SQLCipher's raw-key literal, `x'<64 hex digits>'`, so SQLCipher uses it
    /// directly instead of running it through its password KDF.
    pub(crate) fn sqlcipher_literal(&self) -> Zeroizing<String> {
        Zeroizing::new(format!("x'{}'", hex::encode(*self.0)))
    }
}

/// An account's cache key and the principal whose data key seals it.
pub(crate) struct AccountKey {
    pub(crate) principal_id: String,
    pub(crate) key: CacheKey,
}

/// Where the cache keys come from. The secret vault in the app; a fixed key in tests.
pub(crate) trait KeySource: Send + Sync {
    /// The account's key, made on first use.
    ///
    /// # Errors
    /// [`CacheError::Locked`] while the account is locked, or when this device holds no keys
    /// for it; [`CacheError::Key`] when the secret vault fails.
    fn load_or_create(&self, account: &AccountId) -> Result<AccountKey, CacheError>;
    /// Whether `principal_id` is still unlocked.
    fn is_unlocked(&self, principal_id: &str) -> bool;
    /// Deletes the account's key. Deleting what is not there is not an error.
    fn forget(&self, account: &AccountId) -> Result<(), CacheError>;
}

/// Reads each account's key from the secret vault, sealed under its data key, generating and
/// storing one on first use.
pub(crate) struct VaultKeySource {
    pub(crate) vault: Arc<SecretVault>,
    pub(crate) account_lock: AccountLock,
    /// Which principal an account signs in with.
    pub(crate) keys: KeyIdentityState,
}

fn lock_error(e: AccountLockError) -> CacheError {
    match e {
        AccountLockError::Locked => CacheError::Locked,
        other => CacheError::Key(other.to_string()),
    }
}

impl KeySource for VaultKeySource {
    fn load_or_create(&self, account: &AccountId) -> Result<AccountKey, CacheError> {
        let principal_id = self
            .keys
            .principal_of(&account.endpoint, &account.user_id)
            .map_err(|e| CacheError::Key(e.to_string()))?
            .ok_or(CacheError::Locked)?;
        if !self.account_lock.is_unlocked(&principal_id) {
            return Err(CacheError::Locked);
        }
        let name = secret_name(account);
        let stored = self
            .vault
            .read(&name)
            .map_err(|e| CacheError::Key(e.to_string()))?;
        if let Some(stored) = stored {
            match self.account_lock.open_record(
                &principal_id,
                StoreKeyLabel::CacheKey,
                &name,
                &stored,
            ) {
                Ok(bytes) => {
                    return Ok(AccountKey {
                        principal_id,
                        key: decode(&bytes)?,
                    })
                }
                Err(AccountLockError::Locked) => return Err(CacheError::Locked),
                // Sealed under an earlier data key: the account started empty on this device,
                // and its cache goes with a new key.
                Err(e) => log::warn!("[message_cache] a cache key does not open: {e}"),
            }
        }

        let mut bytes = Zeroizing::new([0u8; 32]);
        getrandom::fill(bytes.as_mut())
            .map_err(|e| CacheError::Key(format!("random generation failed: {e}")))?;
        let sealed = self
            .account_lock
            .seal_record(
                &principal_id,
                StoreKeyLabel::CacheKey,
                &name,
                bytes.as_ref(),
            )
            .map_err(lock_error)?;
        self.vault
            .write(&name, &sealed)
            .map_err(|e| CacheError::Key(e.to_string()))?;
        if let Err(e) = self.vault.delete(LEGACY_SECRET_NAME) {
            log::warn!("[message_cache] could not delete the old cache key: {e}");
        }
        log::info!("[message_cache] generated a new cache key in the secret vault");
        Ok(AccountKey {
            principal_id,
            key: CacheKey::from_bytes(*bytes),
        })
    }

    fn is_unlocked(&self, principal_id: &str) -> bool {
        self.account_lock.is_unlocked(principal_id)
    }

    fn forget(&self, account: &AccountId) -> Result<(), CacheError> {
        self.vault
            .delete(&secret_name(account))
            .map_err(|e| CacheError::Key(e.to_string()))
    }
}

fn decode(bytes: &[u8]) -> Result<CacheKey, CacheError> {
    let array: [u8; 32] = bytes
        .try_into()
        .map_err(|_| CacheError::Key("stored cache key has the wrong length".into()))?;
    Ok(CacheKey::from_bytes(array))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_is_a_raw_sqlcipher_key() {
        let key = CacheKey::from_bytes([0xab; 32]);
        let literal = key.sqlcipher_literal();
        assert_eq!(literal.len(), 3 + 64);
        assert!(literal.starts_with("x'abab"));
        assert!(literal.ends_with("ab'"));
    }

    #[test]
    fn decode_takes_32_bytes_only() {
        assert_eq!(*decode(&[7u8; 32]).unwrap().0, [7u8; 32]);
        assert!(decode(&[7u8; 16]).is_err());
    }
}
