//! The recovery kit, v1: the text shown once at enrollment that lets a person who lost every
//! device take their account back (`key-identity-v1.md`, "Recovery kit, v1").
//!
//! ```text
//! RIM recovery kit (v1)
//! Account id: rimp1_…
//! Recovery key: RK1-ABCD-EFGH-…
//! ```
//!
//! The recovery key is the base32 of the 32-byte recovery seed and 3 check bytes, so a typo
//! is caught before anything is signed. The 12-word recovery phrase of a later PR replaces this
//! format; readers keep accepting it.

use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::statement::{SecretKey, Seed, PRINCIPAL_PREFIX};
use super::KeyIdentityError;

const KEY_PREFIX: &str = "RK1";
const CHECK_DOMAIN: &[u8] = b"rim.recovery-kit.v1\0";
const CHECK_LEN: usize = 3;
const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/// Length of a principal id: the prefix and 43 base64url characters.
const PRINCIPAL_LEN: usize = PRINCIPAL_PREFIX.len() + 43;

fn check_bytes(seed: &[u8; 32]) -> [u8; CHECK_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(CHECK_DOMAIN);
    hasher.update(seed);
    let digest = hasher.finalize();
    let mut check = [0u8; CHECK_LEN];
    check.copy_from_slice(&digest[..CHECK_LEN]);
    check
}

fn base32(bytes: &[u8]) -> Zeroizing<String> {
    let mut out = Zeroizing::new(String::with_capacity(bytes.len() * 8 / 5 + 1));
    let (mut buffer, mut bits) = (0u32, 0u32);
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
        buffer &= (1 << bits) - 1;
    }
    if bits > 0 {
        out.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

fn unbase32(text: &str) -> Option<Zeroizing<Vec<u8>>> {
    let mut out = Zeroizing::new(Vec::with_capacity(text.len() * 5 / 8));
    let (mut buffer, mut bits) = (0u32, 0u32);
    for c in text.chars() {
        let value = ALPHABET.iter().position(|&a| a as char == c)? as u32;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
        buffer &= (1 << bits) - 1;
    }
    // Leftover bits are padding and must be zero, so each key has one spelling.
    (buffer == 0).then_some(out)
}

/// The recovery key as written in the kit: `RK1-` and groups of 4.
pub(crate) fn format_recovery_key(seed: &[u8; 32]) -> Zeroizing<String> {
    let mut bytes = Zeroizing::new(Vec::with_capacity(32 + CHECK_LEN));
    bytes.extend_from_slice(seed);
    bytes.extend_from_slice(&check_bytes(seed));
    let encoded = base32(&bytes);
    let mut out = Zeroizing::new(String::from(KEY_PREFIX));
    for chunk in encoded.as_bytes().chunks(4) {
        out.push('-');
        out.push_str(std::str::from_utf8(chunk).unwrap_or_default());
    }
    out
}

/// The whole kit text shown to the person.
pub(crate) fn format_kit(principal_id: &str, recovery: &SecretKey) -> Zeroizing<String> {
    let key = format_recovery_key(recovery.seed());
    Zeroizing::new(format!(
        "RIM recovery kit (v1)\nAccount id: {principal_id}\nRecovery key: {}\n",
        key.as_str()
    ))
}

/// Read a recovery key, forgiving case, spaces, dashes and the 0/O and 1/I mix-ups.
pub(crate) fn parse_recovery_key(text: &str) -> Result<Seed, KeyIdentityError> {
    let mut cleaned = Zeroizing::new(String::with_capacity(text.len()));
    cleaned.extend(
        text.chars()
            .filter(|c| !matches!(c, ' ' | '-' | '\t' | '\n' | '\r'))
            .map(|c| c.to_ascii_uppercase()),
    );
    let body = cleaned
        .strip_prefix(KEY_PREFIX)
        .ok_or_else(|| KeyIdentityError::Invalid("a recovery key starts with RK1".into()))?;
    let body: Zeroizing<String> = Zeroizing::new(
        body.chars()
            .map(|c| match c {
                '0' => 'O',
                '1' => 'I',
                c => c,
            })
            .collect(),
    );
    let bytes = unbase32(&body)
        .filter(|b| b.len() == 32 + CHECK_LEN)
        .ok_or_else(|| {
            KeyIdentityError::Invalid("this recovery key is incomplete or mistyped".into())
        })?;
    let mut seed = Zeroizing::new([0u8; 32]);
    seed.copy_from_slice(&bytes[..32]);
    if bytes[32..] != check_bytes(&seed) {
        return Err(KeyIdentityError::Invalid(
            "this recovery key has a typo: its check characters do not match".into(),
        ));
    }
    Ok(seed)
}

/// The account id and recovery key of a pasted kit. `account_id` comes from its own field when
/// the person typed it separately, else from the kit text.
pub(crate) fn parse_kit(
    kit: &str,
    account_id: Option<&str>,
) -> Result<(String, SecretKey), KeyIdentityError> {
    let principal_id = match account_id.map(str::trim).filter(|a| !a.is_empty()) {
        Some(id) => id.to_string(),
        None => find_principal_id(kit).ok_or_else(|| {
            KeyIdentityError::Invalid("the kit has no account id (it starts with rimp1_)".into())
        })?,
    };
    if principal_id.len() != PRINCIPAL_LEN || !principal_id.starts_with(PRINCIPAL_PREFIX) {
        return Err(KeyIdentityError::Invalid(
            "an account id is rimp1_ and 43 more characters".into(),
        ));
    }
    let key_text = kit
        .lines()
        .find_map(|line| {
            let line = line.trim();
            let upper = line.to_ascii_uppercase();
            upper
                .find(KEY_PREFIX)
                .filter(|_| !line.contains(PRINCIPAL_PREFIX))
                .map(|at| &line[at..])
        })
        .ok_or_else(|| KeyIdentityError::Invalid("the kit has no recovery key (RK1-…)".into()))?;
    Ok((
        principal_id,
        SecretKey::from_seed(parse_recovery_key(key_text)?),
    ))
}

fn find_principal_id(text: &str) -> Option<String> {
    let at = text.find(PRINCIPAL_PREFIX)?;
    let id: String = text[at..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    Some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRINCIPAL: &str = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";

    #[test]
    fn a_recovery_key_round_trips_and_has_fourteen_groups() {
        let seed = [101u8; 32];
        let key = format_recovery_key(&seed);
        assert!(key.starts_with("RK1-"));
        assert_eq!(key.split('-').count(), 15);
        assert!(key.split('-').skip(1).all(|g| g.len() == 4));
        assert_eq!(*parse_recovery_key(&key).unwrap(), seed);
        // Lowercase, spaces instead of dashes, and 0/1 for O/I still read.
        let sloppy = key.to_lowercase().replace('-', " ").replace('o', "0");
        assert_eq!(*parse_recovery_key(&sloppy).unwrap(), seed);
    }

    #[test]
    fn a_typo_is_caught_by_the_check_bytes() {
        let key = format_recovery_key(&[7u8; 32]).to_string();
        let groups: Vec<&str> = key.split('-').collect();
        let first = groups[1];
        let swapped = if first.starts_with('A') { "B" } else { "A" };
        let typo = key.replacen(first, &format!("{swapped}{}", &first[1..]), 1);
        assert!(parse_recovery_key(&typo).is_err());
        assert!(parse_recovery_key(&key[..key.len() - 5]).is_err());
        assert!(parse_recovery_key("RK1-!!!!").is_err());
        assert!(parse_recovery_key("ABCD").is_err());
    }

    #[test]
    fn the_kit_text_parses_back() {
        let seed = [42u8; 32];
        let kit = format_kit(PRINCIPAL, &SecretKey::from_seed(Zeroizing::new(seed)));
        assert!(kit.contains(PRINCIPAL));
        let (principal, parsed) = parse_kit(&kit, None).unwrap();
        assert_eq!(principal, PRINCIPAL);
        assert_eq!(parsed.seed(), &seed);

        // Only the key pasted, with the account id typed separately.
        let key = format_recovery_key(&seed);
        let (principal, parsed) = parse_kit(&key, Some(PRINCIPAL)).unwrap();
        assert_eq!(principal, PRINCIPAL);
        assert_eq!(parsed.seed(), &seed);

        assert!(parse_kit(&key, None).is_err());
        assert!(parse_kit(&key, Some("rimp1_short")).is_err());
        assert!(parse_kit(PRINCIPAL, None).is_err());
    }
}
