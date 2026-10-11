//! Creating a file where the storage has no exclusive create: each device stores the bytes
//! under a hidden claim name of its own next to the target, lists the claims, and copies the
//! one every device agrees on to the target. Which claim that is depends on what the storage's
//! listing offers (its order, or the objects' times).

use super::super::crypto::random_bytes;
use super::super::ArchiveError;

const SUFFIX: &str = ".claim";

/// A new claim's name for the file `name`: `.<name>.<12 random hex digits>.claim`.
pub(crate) fn new_claim(name: &str) -> Result<String, ArchiveError> {
    Ok(format!(
        ".{name}.{}{SUFFIX}",
        hex::encode(random_bytes::<6>()?)
    ))
}

/// Whether `entry` is a claim for the file `name` (and not for another name that starts like
/// it).
pub(crate) fn is_claim(entry: &str, name: &str) -> bool {
    entry
        .strip_prefix(&format!(".{name}."))
        .and_then(|rest| rest.strip_suffix(SUFFIX))
        .is_some_and(|random| random.len() == 12 && random.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// `path`'s directory (`""` for the root) and name.
pub(crate) fn split(path: &str) -> (&str, &str) {
    path.rsplit_once('/').unwrap_or(("", path))
}

/// `dir/name`, or `name` in the root.
pub(crate) fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_are_hidden_and_name_their_file() {
        let claim = new_claim("rim-archive.json").unwrap();
        assert!(claim.starts_with(".rim-archive.json.") && claim.len() == 36);
        assert!(is_claim(&claim, "rim-archive.json"));
        assert!(!is_claim(&claim, "rim-archive"));
        assert!(!is_claim("rim-archive.json", "rim-archive.json"));
        assert_eq!(split("a/b/c"), ("a/b", "c"));
        assert_eq!(split("c"), ("", "c"));
        assert_eq!(join("", "c"), "c");
        assert_eq!(join("a/b", "c"), "a/b/c");
    }
}
