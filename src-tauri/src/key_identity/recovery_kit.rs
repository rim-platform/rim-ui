//! The recovery kit: the text shown once at enrollment that lets a person who lost every
//! device take their account back (`key-identity-v1.md`, "Recovery kit").
//!
//! This device writes version 2, a 12-word recovery phrase:
//!
//! ```text
//! RIM recovery kit (v2)
//! Account id: rimp1_…
//! Recovery phrase: word1 word2 … word12
//! ```
//!
//! The phrase is the BIP39 English encoding of 16 random bytes, and its checksum catches most
//! typos before anything is signed. The recovery key is HKDF-SHA256 of those 16 bytes, not
//! BIP39's PBKDF2 seed. Version 1, a `RK1-` base32 key with 3 check bytes, is still read, so an
//! account enrolled with a v1 kit recovers as before:
//!
//! ```text
//! RIM recovery kit (v1)
//! Account id: rimp1_…
//! Recovery key: RK1-ABCD-EFGH-…
//! ```
//!
//! Readers tell the two apart by content, not by the header line.
//!
//! This module and `statement.rs` are the only places that see a raw 32-byte seed: both kits
//! hold an Ed25519 seed by definition. A recovery key of another algorithm needs a new kit
//! version.

use bip39::{Language, Mnemonic};
use hkdf::Hkdf;
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

/// Bytes of entropy behind a recovery phrase: 128 bits, 12 words.
pub(crate) const PHRASE_ENTROPY_LEN: usize = 16;
/// Words in a recovery phrase.
pub(crate) const PHRASE_WORDS: usize = 12;
const PHRASE_SALT: &[u8] = b"rim.recovery-phrase.v1";
const PHRASE_INFO: &[u8] = b"recovery key";
const PHRASE_LABEL: &str = "recovery phrase:";

/// The 16 bytes a recovery phrase spells, wiped on drop.
pub(crate) type PhraseEntropy = Zeroizing<[u8; PHRASE_ENTROPY_LEN]>;

// ─── Version 2: the recovery phrase ──────────────────────────────────────────

/// Fresh entropy for a recovery phrase, from the OS.
pub(crate) fn generate_entropy() -> Result<PhraseEntropy, KeyIdentityError> {
    let mut entropy = Zeroizing::new([0u8; PHRASE_ENTROPY_LEN]);
    getrandom::fill(entropy.as_mut())
        .map_err(|e| KeyIdentityError::Crypto(format!("random generation failed: {e}")))?;
    Ok(entropy)
}

/// The recovery key a phrase's entropy stands for:
/// `HKDF-SHA256(ikm = entropy, salt = "rim.recovery-phrase.v1", info = "recovery key")`,
/// 32 bytes, used as the Ed25519 seed.
pub(crate) fn phrase_key(
    entropy: &[u8; PHRASE_ENTROPY_LEN],
) -> Result<SecretKey, KeyIdentityError> {
    let mut seed: Seed = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(PHRASE_SALT), entropy)
        .expand(PHRASE_INFO, seed.as_mut())
        .map_err(|e| KeyIdentityError::Crypto(format!("recovery key derivation failed: {e}")))?;
    Ok(SecretKey::from_seed(seed))
}

/// The 12 words of the phrase for `entropy`, in order.
pub(crate) fn phrase_words(
    entropy: &[u8; PHRASE_ENTROPY_LEN],
) -> Result<Zeroizing<Vec<String>>, KeyIdentityError> {
    let mnemonic = Mnemonic::from_entropy_in(Language::English, entropy)
        .map_err(|e| KeyIdentityError::Crypto(format!("recovery phrase encoding failed: {e}")))?;
    Ok(Zeroizing::new(
        mnemonic.words().map(str::to_string).collect(),
    ))
}

/// The whole version 2 kit text shown to the person.
pub(crate) fn format_kit(
    principal_id: &str,
    entropy: &[u8; PHRASE_ENTROPY_LEN],
) -> Result<Zeroizing<String>, KeyIdentityError> {
    let words = phrase_words(entropy)?;
    let phrase = Zeroizing::new(words.join(" "));
    Ok(Zeroizing::new(format!(
        "RIM recovery kit (v2)\nAccount id: {principal_id}\nRecovery phrase: {}\n",
        phrase.as_str()
    )))
}

/// A word as written, without numbering such as `1.` or `1)` in front. A bare number (copied
/// from a numbered list) comes out empty.
fn without_numbering(token: &str) -> &str {
    let rest = token.trim_start_matches(|c: char| c.is_ascii_digit());
    if rest.len() == token.len() {
        return token;
    }
    rest.strip_prefix(['.', ')']).unwrap_or(rest)
}

/// Read a recovery phrase, alone or inside a kit: ignores case, extra whitespace and line
/// breaks, numbering in front of words, and the kit's header and account id lines. Refuses a
/// phrase that is not 12 words, names the first word that is not in the word list, and refuses
/// one whose checksum fails.
pub(crate) fn parse_recovery_phrase(text: &str) -> Result<PhraseEntropy, KeyIdentityError> {
    let mut words: Vec<Zeroizing<String>> = Vec::with_capacity(PHRASE_WORDS);
    for line in text.lines() {
        let lower = Zeroizing::new(line.trim().to_lowercase());
        if lower.starts_with("rim recovery kit")
            || lower.starts_with("account id")
            || lower.contains(PRINCIPAL_PREFIX)
        {
            continue;
        }
        let rest = lower.strip_prefix(PHRASE_LABEL).unwrap_or(&lower);
        words.extend(
            rest.split_whitespace()
                .map(without_numbering)
                .filter(|w| !w.is_empty())
                .map(|w| Zeroizing::new(w.to_string())),
        );
    }
    if words.is_empty() {
        return Err(KeyIdentityError::Invalid(
            "paste the recovery kit, its 12-word recovery phrase or its RK1- recovery key".into(),
        ));
    }
    if words.len() != PHRASE_WORDS {
        return Err(KeyIdentityError::Invalid(format!(
            "a recovery phrase has {PHRASE_WORDS} words; this one has {}",
            words.len()
        )));
    }
    if let Some((at, word)) = words
        .iter()
        .enumerate()
        .find(|(_, w)| Language::English.find_word(w).is_none())
    {
        return Err(KeyIdentityError::Invalid(format!(
            "word {} of the recovery phrase, \"{}\", is not in the word list",
            at + 1,
            word.as_str()
        )));
    }
    let joined = Zeroizing::new(
        words
            .iter()
            .map(|w| w.as_str())
            .collect::<Vec<_>>()
            .join(" "),
    );
    let mnemonic = Mnemonic::parse_in_normalized(Language::English, &joined).map_err(|e| {
        KeyIdentityError::Invalid(match e {
            bip39::Error::InvalidChecksum => {
                "this recovery phrase has a typo: its words do not fit together. Check the \
                 spelling and the order of every word"
                    .into()
            }
            other => format!("this recovery phrase cannot be read: {other}"),
        })
    })?;
    let (bytes, len) = mnemonic.to_entropy_array();
    let bytes = Zeroizing::new(bytes);
    if len != PHRASE_ENTROPY_LEN {
        return Err(KeyIdentityError::Invalid(format!(
            "a recovery phrase has {PHRASE_WORDS} words"
        )));
    }
    let mut entropy = Zeroizing::new([0u8; PHRASE_ENTROPY_LEN]);
    entropy.copy_from_slice(&bytes[..PHRASE_ENTROPY_LEN]);
    Ok(entropy)
}

// ─── Version 1: the RK1- recovery key ────────────────────────────────────────

fn check_bytes(seed: &[u8; 32]) -> [u8; CHECK_LEN] {
    let mut hasher = Sha256::new();
    hasher.update(CHECK_DOMAIN);
    hasher.update(seed);
    let digest = hasher.finalize();
    let mut check = [0u8; CHECK_LEN];
    check.copy_from_slice(&digest[..CHECK_LEN]);
    check
}

/// RFC 4648 base32, uppercase, no padding. Also the device link fingerprint's encoding.
pub(crate) fn base32(bytes: &[u8]) -> Zeroizing<String> {
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

/// The version 1 recovery key as written in the kit: `RK1-` and groups of 4. This device no
/// longer writes it; tests use it to check that it is still read.
#[cfg(test)]
pub(crate) fn format_recovery_key(seed: &[u8; 32]) -> Zeroizing<String> {
    let mut bytes = Zeroizing::new(Vec::with_capacity(32 + CHECK_LEN));
    bytes.extend_from_slice(seed);
    bytes.extend_from_slice(&check_bytes(seed));
    let encoded = Zeroizing::new(base32(&bytes));
    let mut out = Zeroizing::new(String::from(KEY_PREFIX));
    for chunk in encoded.as_bytes().chunks(4) {
        out.push('-');
        out.push_str(std::str::from_utf8(chunk).unwrap_or_default());
    }
    out
}

/// The whole version 1 kit text, as older clients wrote it. Tests only.
#[cfg(test)]
pub(crate) fn format_kit_v1(principal_id: &str, recovery: &SecretKey) -> Zeroizing<String> {
    let key = format_recovery_key(recovery.seed());
    Zeroizing::new(format!(
        "RIM recovery kit (v1)\nAccount id: {principal_id}\nRecovery key: {}\n",
        key.as_str()
    ))
}

/// Read a version 1 recovery key, forgiving case, spaces, dashes and the 0/O and 1/I mix-ups.
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
        .map(Zeroizing::new)
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

/// The version 1 recovery key in `text`, from its `RK1` on: the first line, other than the
/// account id's, with a word that starts with `RK1`. A phrase never has one (its words are
/// letters, its numbering digits).
fn v1_key_text(text: &str) -> Option<&str> {
    text.lines()
        .filter(|line| !line.contains(PRINCIPAL_PREFIX))
        .find_map(|line| {
            // ASCII uppercasing keeps every byte offset, so `at` indexes `line` too.
            let upper = Zeroizing::new(line.to_ascii_uppercase());
            let at = upper.match_indices(KEY_PREFIX).find_map(|(at, _)| {
                let starts_word = upper[..at]
                    .chars()
                    .next_back()
                    .is_none_or(|c| c.is_whitespace() || c == ':');
                starts_word.then_some(at)
            })?;
            Some(&line[at..])
        })
}

// ─── Either version ──────────────────────────────────────────────────────────

/// The recovery key in a pasted kit or bare secret, whichever version: a `RK1-` key (v1) or a
/// 12-word phrase (v2), told apart by content.
pub(crate) fn parse_recovery_secret(text: &str) -> Result<SecretKey, KeyIdentityError> {
    match v1_key_text(text) {
        Some(key) => Ok(SecretKey::from_seed(parse_recovery_key(key)?)),
        None => phrase_key(&*parse_recovery_phrase(text)?),
    }
}

/// The account id and recovery key of a pasted kit, phrase or key. `account_id` comes from its
/// own field when the person typed it separately, else from the kit text.
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
    Ok((principal_id, parse_recovery_secret(kit)?))
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

    // Known-answer vector of the recovery phrase (key-identity-v1.md, "Recovery kit").
    const VECTOR_ENTROPY: &str = "000102030405060708090a0b0c0d0e0f";
    const VECTOR_WORDS: &str =
        "abandon amount liar amount expire adjust cage candy arch gather drum buyer";
    const VECTOR_RECOVERY_KEY: &str = "ed25519:K2c3c55QDKnCUKWO8yTdZm25JIT20PKr5vaNC91F4cw";

    fn vector_entropy() -> [u8; PHRASE_ENTROPY_LEN] {
        let mut entropy = [0u8; PHRASE_ENTROPY_LEN];
        entropy.copy_from_slice(&hex::decode(VECTOR_ENTROPY).unwrap());
        entropy
    }

    fn message(err: KeyIdentityError) -> String {
        err.to_string()
    }

    #[test]
    fn the_phrase_matches_its_known_answer_vector() {
        let entropy = vector_entropy();
        assert_eq!(phrase_words(&entropy).unwrap().join(" "), VECTOR_WORDS);
        assert_eq!(
            phrase_key(&entropy).unwrap().public_key(),
            VECTOR_RECOVERY_KEY
        );
        // The word list and checksum are BIP39's: its first English test vector.
        assert_eq!(
            phrase_words(&[0u8; 16]).unwrap().join(" "),
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon about"
        );
    }

    #[test]
    fn a_phrase_round_trips_through_its_words() {
        for _ in 0..16 {
            let entropy = generate_entropy().unwrap();
            let words = phrase_words(&entropy).unwrap();
            assert_eq!(words.len(), PHRASE_WORDS);
            let parsed = parse_recovery_phrase(&words.join(" ")).unwrap();
            assert_eq!(*parsed, *entropy);
        }
    }

    #[test]
    fn a_phrase_forgives_case_spacing_line_breaks_and_numbering() {
        let entropy = vector_entropy();
        let words = phrase_words(&entropy).unwrap();
        let numbered: String = words
            .iter()
            .enumerate()
            .map(|(i, w)| {
                let w = if i % 2 == 0 {
                    w.to_uppercase()
                } else {
                    w.clone()
                };
                match i % 3 {
                    0 => format!("{}. {w}\n", i + 1),
                    1 => format!("  {})  {w}\t", i + 1),
                    _ => format!("{}.{w}\r\n", i + 1),
                }
            })
            .collect();
        assert_eq!(*parse_recovery_phrase(&numbered).unwrap(), entropy);
        // Copied from a grid: each number on its own line.
        let grid: String = words
            .iter()
            .enumerate()
            .map(|(i, w)| format!("{}\n{w}\n", i + 1))
            .collect();
        assert_eq!(*parse_recovery_phrase(&grid).unwrap(), entropy);
    }

    #[test]
    fn a_word_outside_the_list_is_named() {
        let words = phrase_words(&vector_entropy()).unwrap();
        let mut typo: Vec<String> = words.to_vec();
        typo[4] = "zzzq".into();
        let err = message(parse_recovery_phrase(&typo.join(" ")).unwrap_err());
        assert!(err.contains("word 5"), "{err}");
        assert!(err.contains("\"zzzq\""), "{err}");
    }

    #[test]
    fn a_phrase_whose_checksum_fails_is_refused() {
        let words = phrase_words(&vector_entropy()).unwrap();
        // Two words swapped: every word is in the list, the checksum is not.
        let mut swapped: Vec<String> = words.to_vec();
        swapped.swap(0, 1);
        assert_ne!(swapped, *words);
        let err = message(parse_recovery_phrase(&swapped.join(" ")).unwrap_err());
        assert!(err.contains("typo"), "{err}");
        assert!(err.contains("order"), "{err}");

        let short = words[..11].join(" ");
        let err = message(parse_recovery_phrase(&short).unwrap_err());
        assert!(err.contains("this one has 11"), "{err}");
        assert!(parse_recovery_phrase("").is_err());
    }

    #[test]
    fn the_kit_text_names_the_account_and_the_phrase() {
        let entropy = vector_entropy();
        let kit = format_kit(PRINCIPAL, &entropy).unwrap();
        assert_eq!(
            kit.as_str(),
            format!(
                "RIM recovery kit (v2)\nAccount id: {PRINCIPAL}\nRecovery phrase: {VECTOR_WORDS}\n"
            )
        );
    }

    #[test]
    fn parse_recovery_secret_reads_both_kits_and_both_bare_secrets() {
        let entropy = vector_entropy();
        let v2_key = phrase_key(&entropy).unwrap();
        let v1_key = SecretKey::from_seed(Zeroizing::new([42u8; 32]));

        // A v2 kit, and a bare phrase with numbering and odd casing.
        let v2_kit = format_kit(PRINCIPAL, &entropy).unwrap();
        assert!(parse_recovery_secret(&v2_kit).unwrap() == v2_key);
        let bare: String = VECTOR_WORDS
            .split(' ')
            .enumerate()
            .map(|(i, w)| format!("{}) {}{} ", i + 1, w[..1].to_uppercase(), &w[1..]))
            .collect();
        assert!(parse_recovery_secret(&bare).unwrap() == v2_key);

        // A v1 kit, and a bare RK1 key.
        let v1_kit = format_kit_v1(PRINCIPAL, &v1_key);
        assert!(parse_recovery_secret(&v1_kit).unwrap() == v1_key);
        let rk1 = format_recovery_key(v1_key.seed());
        assert!(parse_recovery_secret(&rk1).unwrap() == v1_key);
        assert!(parse_recovery_secret(&rk1.to_lowercase()).unwrap() == v1_key);
    }

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
        for (kit, key) in [
            (
                format_kit(PRINCIPAL, &vector_entropy()).unwrap(),
                phrase_key(&vector_entropy()).unwrap(),
            ),
            (
                format_kit_v1(PRINCIPAL, &SecretKey::from_seed(Zeroizing::new([42u8; 32]))),
                SecretKey::from_seed(Zeroizing::new([42u8; 32])),
            ),
        ] {
            assert!(kit.contains(PRINCIPAL));
            let (principal, parsed) = parse_kit(&kit, None).unwrap();
            assert_eq!(principal, PRINCIPAL);
            assert!(parsed == key);
        }

        // Only the secret pasted, with the account id typed separately.
        for secret in [
            format_recovery_key(&[42u8; 32]),
            Zeroizing::new(VECTOR_WORDS.to_string()),
        ] {
            let (principal, _) = parse_kit(&secret, Some(PRINCIPAL)).unwrap();
            assert_eq!(principal, PRINCIPAL);
            assert!(parse_kit(&secret, None).is_err());
            assert!(parse_kit(&secret, Some("rimp1_short")).is_err());
        }
        assert!(parse_kit(PRINCIPAL, None).is_err());
    }
}
