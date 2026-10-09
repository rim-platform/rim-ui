//! Spellings shared by RIM's JSON formats: unpadded base64url, principal ids, UUIDs, and the
//! strict reading rules (unknown and duplicate fields refused, every field present).

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Deserializer};
use uuid::Uuid;

use crate::error::{Error, Result};

pub(crate) const PRINCIPAL_PREFIX: &str = "rimp1_";

/// Unpadded base64url.
pub fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Unpadded base64url, decoded strictly: padding and non-canonical trailing bits are refused.
pub fn unb64(text: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|e| Error::malformed("base64url", e))
}

/// Exactly 32 bytes of unpadded base64url.
pub(crate) fn unb64_32(text: &str, what: &'static str) -> Result<[u8; 32]> {
    unb64(text)?
        .try_into()
        .map_err(|_| Error::malformed(what, "not 32 bytes"))
}

/// Whether `text` is a principal id: `rimp1_` and the base64url of 32 bytes.
pub(crate) fn is_principal_id(text: &str) -> bool {
    text.strip_prefix(PRINCIPAL_PREFIX)
        .is_some_and(|hash| hash.len() == 43 && unb64(hash).is_ok_and(|bytes| bytes.len() == 32))
}

/// A UUID in its one accepted spelling: lowercase and hyphenated.
pub(crate) fn parse_uuid(text: &str, what: &'static str) -> Result<Uuid> {
    let id = Uuid::try_parse(text).map_err(|e| Error::malformed(what, e))?;
    if id.hyphenated().to_string() != text {
        return Err(Error::malformed(what, "not a lowercase hyphenated UUID"));
    }
    Ok(id)
}

/// Deserializes an `Option` field that must be present (as a value or `null`). Without it, serde
/// would read a missing field as `None`.
pub(crate) fn required<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// Parses strict JSON: the target type refuses unknown fields, and serde refuses duplicates.
pub(crate) fn strict_json<'a, T: Deserialize<'a>>(
    bytes: &'a [u8],
    what: &'static str,
) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|e| Error::malformed(what, e))
}

/// JSON of a plain struct; serializing these cannot fail.
pub(crate) fn to_json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_is_strict() {
        assert_eq!(b64(&[0xff, 0xee]), "_-4");
        assert_eq!(unb64("_-4").unwrap(), vec![0xff, 0xee]);
        assert!(unb64("_-4=").is_err());
        // Non-zero trailing bits.
        assert!(unb64("_-5").is_err());
        assert!(unb64("+/4").is_err());
    }

    #[test]
    fn principal_ids_and_uuids_have_one_spelling() {
        assert!(is_principal_id(
            "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0"
        ));
        assert!(!is_principal_id(
            "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje"
        ));
        assert!(!is_principal_id(
            "rimp0_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0"
        ));
        assert!(parse_uuid("0199d1a0-0000-7000-8000-000000000001", "id").is_ok());
        assert!(parse_uuid("0199D1A0-0000-7000-8000-000000000001", "id").is_err());
        assert!(parse_uuid("0199d1a000007000800000000000000 1", "id").is_err());
        assert!(parse_uuid("0199d1a0000070008000000000000001", "id").is_err());
    }
}
