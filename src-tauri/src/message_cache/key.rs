//! The cache key: one random 256-bit key per installation, kept in the OS keyring.
//!
//! Every account's cache database is encrypted with it (SQLCipher raw key). This is the
//! Stage 2 cache key of the master plan; Stage 3 re-wraps it under the device key, so all
//! key handling stays in this module and the rest of the cache only sees [`CacheKey`].

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use zeroize::Zeroizing;

use super::CacheError;

/// Keyring user name of the cache key (service is `secret_store::SERVICE`).
const KEYRING_USER: &str = "message-cache-key-v1";

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

/// Where the cache key comes from. The keyring in the app; a fixed key in tests.
pub(crate) trait KeySource: Send + Sync {
    fn load_or_create(&self) -> Result<CacheKey, CacheError>;
}

/// Reads the key from the OS keyring, generating and storing one on first use.
pub(crate) struct KeyringKeySource;

impl KeySource for KeyringKeySource {
    fn load_or_create(&self) -> Result<CacheKey, CacheError> {
        let entry = crate::secret_store::entry(KEYRING_USER)
            .map_err(|e| CacheError::Key(format!("keyring init failed: {e}")))?;

        match entry.get_password() {
            Ok(stored) => decode(&stored),
            Err(keyring::Error::NoEntry) => {
                let mut bytes = Zeroizing::new([0u8; 32]);
                getrandom::fill(bytes.as_mut())
                    .map_err(|e| CacheError::Key(format!("random generation failed: {e}")))?;
                let encoded = Zeroizing::new(URL_SAFE_NO_PAD.encode(*bytes));
                entry
                    .set_password(&encoded)
                    .map_err(|e| CacheError::Key(format!("keyring store failed: {e}")))?;
                log::info!("[message_cache] generated a new cache key in the OS keyring");
                Ok(CacheKey::from_bytes(*bytes))
            }
            Err(e) => Err(CacheError::Key(format!("keyring read failed: {e}"))),
        }
    }
}

fn decode(stored: &str) -> Result<CacheKey, CacheError> {
    let bytes = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(stored)
            .map_err(|_| CacheError::Key("stored cache key is not valid base64".into()))?,
    );
    let array: [u8; 32] = bytes
        .as_slice()
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
    fn decode_round_trips_and_rejects_bad_input() {
        let encoded = URL_SAFE_NO_PAD.encode([7u8; 32]);
        assert_eq!(*decode(&encoded).unwrap().0, [7u8; 32]);
        assert!(decode("not base64!").is_err());
        assert!(decode(&URL_SAFE_NO_PAD.encode([7u8; 16])).is_err());
    }
}
