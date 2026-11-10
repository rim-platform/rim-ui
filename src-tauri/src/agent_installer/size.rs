//! How big an agent is: what it downloads, or takes once npm installed it, before it is
//! installed, and what RIM's agents folder uses on disk.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;
use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Instant;

use semver::{Version, VersionReq};
use serde::Serialize;
use serde_json::Value;

use super::net::{Net, REGISTRY_KEPT, SIZE_TIMEOUT};

/// Where npm package metadata is read from.
const NPM_METADATA: &str = "https://registry.npmjs.org/";
/// npm's abbreviated metadata, which holds what an install needs.
const NPM_ABBREVIATED: &str = "application/vnd.npm.install-v1+json";
/// Most metadata documents one size reads.
pub(crate) const MAX_METADATA_FETCHES: usize = 80;
/// Largest metadata document accepted.
const MAX_METADATA: u64 = 16 * 1024 * 1024;
/// Longest npm package name.
const MAX_NPM_NAME: usize = 214;

/// What a size counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SizeKind {
    /// The archive that is downloaded.
    Download,
    /// The files npm puts on disk.
    Installed,
}

/// How big an agent is before it is installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Size {
    pub(crate) bytes: u64,
    pub(crate) kind: SizeKind,
}

/// `bytes` as the person reads it, in decimal units: one decimal under 10 MB ("4.2 MB"), whole
/// megabytes up to 1000 MB ("120 MB"), and gigabytes with one decimal above ("1.2 GB").
pub(crate) fn size_text(bytes: u64) -> String {
    let tenths_mb = bytes.saturating_add(50_000) / 100_000;
    if tenths_mb < 100 {
        return format!("{}.{} MB", tenths_mb / 10, tenths_mb % 10);
    }
    let mb = bytes.saturating_add(500_000) / 1_000_000;
    if mb < 1000 {
        return format!("{mb} MB");
    }
    let tenths_gb = bytes.saturating_add(50_000_000) / 100_000_000;
    format!("{}.{} GB", tenths_gb / 10, tenths_gb % 10)
}

/// Sizes worked out, by a key that names the version, each kept for as long as the registry is.
#[derive(Default)]
pub(crate) struct SizeCache(Mutex<HashMap<String, (Instant, Option<u64>)>>);

impl SizeCache {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, (Instant, Option<u64>)>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The size kept under `key`, or else what `work` gives, which is then kept, unknown too.
    pub(crate) async fn get_or(
        &self,
        key: String,
        work: impl Future<Output = Option<u64>>,
    ) -> Option<u64> {
        if let Some((at, size)) = self.lock().get(&key) {
            if at.elapsed() < REGISTRY_KEPT {
                return *size;
            }
        }
        let size = work.await;
        let mut kept = self.lock();
        kept.retain(|_, (at, _)| at.elapsed() < REGISTRY_KEPT);
        kept.insert(key, (Instant::now(), size));
        size
    }

    /// Forgets every size kept.
    #[cfg(test)]
    pub(crate) fn clear(&self) {
        self.lock().clear();
    }
}

/// A computer as npm's `os`, `cpu` and `libc` package fields name it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct NpmPlatform {
    os: &'static str,
    cpu: &'static str,
    /// `glibc` or `musl` on Linux; npm checks it nowhere else.
    libc: Option<&'static str>,
}

impl NpmPlatform {
    /// The platform of a registry platform key such as `linux-x86_64` or `linux-aarch64-musl`;
    /// `None` for a key npm has no names for.
    pub(crate) fn from_key(key: &str) -> Option<Self> {
        let (rest, musl) = match key.strip_suffix("-musl") {
            Some(rest) => (rest, true),
            None => (key, false),
        };
        let (os, arch) = rest.split_once('-')?;
        let os = match os {
            "linux" => "linux",
            "darwin" => "darwin",
            "windows" => "win32",
            _ => return None,
        };
        let cpu = match arch {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            _ => return None,
        };
        let libc = (os == "linux").then_some(if musl { "musl" } else { "glibc" });
        Some(Self { os, cpu, libc })
    }

    /// Whether npm installs the package of `manifest` here, by its `os`, `cpu` and `libc`.
    fn accepts(&self, manifest: &Value) -> bool {
        list_accepts(manifest.get("os"), self.os)
            && list_accepts(manifest.get("cpu"), self.cpu)
            && self
                .libc
                .is_none_or(|libc| list_accepts(manifest.get("libc"), libc))
    }
}

/// Whether npm's platform list `field` lets `value` in: no list, `["any"]`, a list naming it,
/// or a list of only `!` entries none of which is it.
fn list_accepts(field: Option<&Value>, value: &str) -> bool {
    let list: Vec<&str> = match field {
        Some(Value::String(entry)) => vec![entry.as_str()],
        Some(Value::Array(entries)) => entries.iter().filter_map(Value::as_str).collect(),
        _ => return true,
    };
    if list == ["any"] {
        return true;
    }
    let mut negated = 0;
    let mut named = false;
    for entry in &list {
        match entry.strip_prefix('!') {
            Some(excluded) if excluded == value => return false,
            Some(_) => negated += 1,
            None => named |= *entry == value,
        }
    }
    named || negated == list.len()
}

/// A package to count: its name, the version or range asked for, and whether it is optional.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Want {
    name: String,
    spec: String,
    optional: bool,
}

/// What npm puts on disk to install `package` at `version` on `platform`: the unpacked size of
/// the package and of its dependencies and optional dependencies, each resolved as npm resolves
/// it and counted once, with an optional one left out when it is for another platform, and a
/// version too old to state its size counted as 0. `None` past [`MAX_METADATA_FETCHES`] or
/// [`SIZE_TIMEOUT`], or when any of it can't be read.
pub(crate) async fn npm_size(
    net: &Net,
    package: &str,
    version: &str,
    platform: NpmPlatform,
) -> Option<u64> {
    tokio::time::timeout(SIZE_TIMEOUT, npm_walk(net, package, version, platform))
        .await
        .ok()
        .flatten()
}

async fn npm_walk(net: &Net, package: &str, version: &str, platform: NpmPlatform) -> Option<u64> {
    let mut documents: HashMap<String, Value> = HashMap::new();
    let mut counted: HashSet<String> = HashSet::new();
    let mut total: u64 = 0;
    let mut wanted = vec![Want {
        name: package.to_owned(),
        spec: version.to_owned(),
        optional: false,
    }];
    while !wanted.is_empty() {
        let mut missing: Vec<String> = wanted
            .iter()
            .filter(|want| !documents.contains_key(&want.name))
            .map(|want| want.name.clone())
            .collect();
        missing.sort_unstable();
        missing.dedup();
        if documents.len() + missing.len() > MAX_METADATA_FETCHES {
            return None;
        }
        let fetched = futures_util::future::join_all(missing.iter().map(|name| async move {
            net.json(&metadata_url(name), NPM_ABBREVIATED, MAX_METADATA)
                .await
        }))
        .await;
        for (name, document) in missing.into_iter().zip(fetched) {
            documents.insert(name, document?);
        }
        let mut next = Vec::new();
        for want in wanted {
            let (picked, manifest) = pick(documents.get(&want.name)?, &want.spec)?;
            if want.optional && !platform.accepts(manifest) {
                continue;
            }
            if !counted.insert(format!("{}@{picked}", want.name)) {
                continue;
            }
            total = total.checked_add(unpacked_size(manifest)?)?;
            next.extend(dependencies(manifest)?);
        }
        wanted = next;
    }
    Some(total)
}

/// The unpacked size `manifest` states; 0 for a version published before npm stated it, which
/// is small. `None` when it is there but not a size.
fn unpacked_size(manifest: &Value) -> Option<u64> {
    match manifest
        .get("dist")
        .and_then(|dist| dist.get("unpackedSize"))
    {
        None => Some(0),
        Some(size) => size.as_u64(),
    }
}

/// The metadata URL of npm package `name`, its scope's `/` encoded.
fn metadata_url(name: &str) -> String {
    format!("{NPM_METADATA}{}", name.replacen('/', "%2f", 1))
}

/// Whether `name` is an npm package name RIM asks the registry for: a lowercase-safe name, or
/// `@scope/name`, of letters, digits, `-`, `.`, `_` and `~`, not starting with `.`.
fn is_npm_name(name: &str) -> bool {
    let part = |part: &str| {
        !part.is_empty()
            && !part.starts_with('.')
            && part
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~'))
    };
    let valid = match name.strip_prefix('@') {
        Some(scoped) => scoped
            .split_once('/')
            .is_some_and(|(scope, rest)| part(scope) && part(rest)),
        None => part(name),
    };
    valid && name.len() <= MAX_NPM_NAME
}

/// The packages `manifest` depends on, optional ones marked, without the ones it bundles; an
/// entry in both lists is optional. `None` when one is not a registry package.
fn dependencies(manifest: &Value) -> Option<Vec<Want>> {
    let bundled = manifest
        .get("bundleDependencies")
        .or_else(|| manifest.get("bundledDependencies"));
    let is_bundled = |name: &str| match bundled {
        Some(Value::Bool(all)) => *all,
        Some(Value::Array(names)) => names.iter().any(|entry| entry.as_str() == Some(name)),
        _ => false,
    };
    let mut specs: BTreeMap<&str, (&str, bool)> = BTreeMap::new();
    for (field, optional) in [("dependencies", false), ("optionalDependencies", true)] {
        if let Some(entries) = manifest.get(field).and_then(Value::as_object) {
            for (name, spec) in entries {
                specs.insert(name, (spec.as_str()?, optional));
            }
        }
    }
    specs
        .into_iter()
        .filter(|(name, _)| !is_bundled(name))
        .map(|(name, (spec, optional))| {
            let (name, spec) = registry_dependency(name, spec)?;
            Some(Want {
                name,
                spec,
                optional,
            })
        })
        .collect()
}

/// The registry package and the range a dependency `name: spec` asks for: an `npm:` alias names
/// another package. `None` for a git, file or URL dependency, or a name RIM does not ask for.
fn registry_dependency(name: &str, spec: &str) -> Option<(String, String)> {
    let (package, range) = match spec.strip_prefix("npm:") {
        Some(alias) => match alias.rfind('@') {
            Some(at) if at > 0 => (&alias[..at], &alias[at + 1..]),
            _ => (alias, "*"),
        },
        None if spec.contains([':', '/']) => return None,
        None => (name, spec),
    };
    is_npm_name(package).then(|| (package.to_owned(), range.to_owned()))
}

/// The version npm picks for `spec` from the package metadata `document`, with its manifest:
/// the exact version, the version a dist-tag names, `latest` when the range allows it, or else
/// the highest version the range allows.
fn pick<'a>(document: &'a Value, spec: &str) -> Option<(&'a str, &'a Value)> {
    let versions = document.get("versions")?.as_object()?;
    let tags = document.get("dist-tags").and_then(Value::as_object);
    let tagged = |tag: &str| tags?.get(tag)?.as_str();
    let spec = spec.trim();
    let exact = |version: &str| {
        versions
            .get_key_value(version)
            .map(|(key, manifest)| (key.as_str(), manifest))
    };
    if let Some(found) = exact(spec).or_else(|| tagged(spec).and_then(exact)) {
        return Some(found);
    }
    let ranges = npm_range(spec)?;
    let allows = |version: &Version| ranges.iter().any(|range| range.matches(version));
    if let Some(latest) = tagged("latest").and_then(exact) {
        if Version::parse(latest.0).is_ok_and(|version| allows(&version)) {
            return Some(latest);
        }
    }
    versions
        .iter()
        .filter_map(|(key, manifest)| {
            let version = Version::parse(key).ok()?;
            allows(&version).then_some((version, key.as_str(), manifest))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, key, manifest)| (key, manifest))
}

/// npm's range `range` as the ranges any of which it allows; `None` when it is not one RIM
/// reads.
fn npm_range(range: &str) -> Option<Vec<VersionReq>> {
    range
        .split("||")
        .map(|alternative| {
            let alternative = alternative.trim();
            let comparators = match alternative.split_once(" - ") {
                Some((low, high)) => vec![
                    comparator(">=", low.trim())?,
                    comparator("<=", high.trim())?,
                ],
                None => comparators(alternative)?,
            };
            let comparators: Vec<String> = comparators.into_iter().flatten().collect();
            let text = if comparators.is_empty() {
                "*".to_owned()
            } else {
                comparators.join(", ")
            };
            VersionReq::parse(&text).ok()
        })
        .collect()
}

/// The comparators of one alternative of an npm range, written apart by spaces, an operator
/// standing apart from its version allowed. `None` in the list stands for one that allows any
/// version.
fn comparators(alternative: &str) -> Option<Vec<Option<String>>> {
    let mut out = Vec::new();
    let mut pending: Option<&str> = None;
    for token in alternative.split_whitespace() {
        let token_operator = operator_of(token);
        if token_operator.len() == token.len() {
            pending = Some(token);
            continue;
        }
        let (operator, version) = match pending.take() {
            Some(operator) => (operator, token),
            None => (token_operator, &token[token_operator.len()..]),
        };
        out.push(comparator(operator, version)?);
    }
    if pending.is_some() {
        return None;
    }
    Some(out)
}

/// The operator `token` starts with, or `""`.
fn operator_of(token: &str) -> &str {
    for operator in [">=", "<=", "~>", ">", "<", "=", "^", "~"] {
        if token.starts_with(operator) {
            return &token[..operator.len()];
        }
    }
    ""
}

/// One npm comparator as the `semver` crate reads it, with the same meaning: a version's
/// trailing `x`, `X` or `*` parts left out, and a bare version exact when it is whole and a
/// tilde range when it is partial. `Some(None)` for one that allows any version; `None` when it
/// can't be read.
fn comparator(operator: &str, version: &str) -> Option<Option<String>> {
    let version = version.trim_start_matches(['v', '=']);
    let (core, suffix) = match version.find(['-', '+']) {
        Some(at) => version.split_at(at),
        None => (version, ""),
    };
    let parts: Vec<&str> = core
        .split('.')
        .take_while(|part| !matches!(*part, "x" | "X" | "*" | ""))
        .collect();
    if parts.is_empty() {
        return match operator {
            "" | "=" | ">=" | "<=" | "^" | "~" | "~>" => Some(None),
            _ => None,
        };
    }
    if parts.len() > 3
        || !parts
            .iter()
            .all(|part| part.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let whole = parts.len() == 3;
    if !whole && !suffix.is_empty() {
        return None;
    }
    let operator = match operator {
        "" if whole => "=",
        "" => "~",
        "~>" => "~",
        other => other,
    };
    let core = parts.join(".");
    Some(Some(format!("{operator}{core}{suffix}")))
}

/// The bytes of the regular files under `path`, symlinks not followed and, on Unix, a file with
/// several hard links counted once. `None` when any of it can't be read, or `path` is missing.
pub(crate) fn disk_size(path: &Path) -> Option<u64> {
    walk(path, true)
}

/// The bytes of the regular files under `path`, as [`disk_size`] counts them, leaving out what
/// can't be read; 0 when `path` is missing.
pub(crate) fn disk_size_readable(path: &Path) -> u64 {
    walk(path, false).unwrap_or(0)
}

/// Sums the regular files under `root`; a part that can't be read ends the walk with `None`
/// when `strict`, and is left out otherwise.
fn walk(root: &Path, strict: bool) -> Option<u64> {
    let mut links = HashSet::new();
    let mut total: u64 = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) if strict => return None,
            Err(_) => continue,
        };
        if metadata.is_dir() {
            let entries = match std::fs::read_dir(&path) {
                Ok(entries) => entries,
                Err(_) if strict => return None,
                Err(_) => continue,
            };
            for entry in entries {
                match entry {
                    Ok(entry) => stack.push(entry.path()),
                    Err(_) if strict => return None,
                    Err(_) => {}
                }
            }
        } else if metadata.is_file() && first_link(&metadata, &mut links) {
            total = total.saturating_add(metadata.len());
        }
    }
    Some(total)
}

/// Whether the file of `metadata` is counted: it has one link, or it is the first of its inode
/// seen, recorded in `links`.
#[cfg(unix)]
fn first_link(metadata: &std::fs::Metadata, links: &mut HashSet<(u64, u64)>) -> bool {
    use std::os::unix::fs::MetadataExt;
    metadata.nlink() <= 1 || links.insert((metadata.dev(), metadata.ino()))
}

/// Every file is counted where hard links are not told apart.
#[cfg(not(unix))]
fn first_link(_metadata: &std::fs::Metadata, _links: &mut HashSet<(u64, u64)>) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sizes_read_like_the_page_shows_them() {
        for (bytes, text) in [
            (0, "0.0 MB"),
            (49_999, "0.0 MB"),
            (50_000, "0.1 MB"),
            (2_250_000, "2.3 MB"),
            (9_949_999, "9.9 MB"),
            (9_950_000, "10 MB"),
            (120_400_000, "120 MB"),
            (999_499_999, "999 MB"),
            (999_500_000, "1.0 GB"),
            (1_249_999_999, "1.2 GB"),
            (1_250_000_000, "1.3 GB"),
        ] {
            assert_eq!(size_text(bytes), text, "{bytes}");
        }
    }

    #[test]
    fn npm_ranges_mean_what_npm_means() {
        let allows = |range: &str, version: &str| {
            npm_range(range)
                .unwrap_or_else(|| panic!("{range}"))
                .iter()
                .any(|req| req.matches(&Version::parse(version).unwrap()))
        };
        for (range, yes, no) in [
            ("1.2.3", "1.2.3", "1.2.4"),
            ("=1.2.3", "1.2.3", "1.3.0"),
            ("v1.2.3", "1.2.3", "1.2.4"),
            ("^1.2.3", "1.9.0", "2.0.0"),
            ("~1.2.3", "1.2.9", "1.3.0"),
            ("1.2", "1.2.7", "1.3.0"),
            ("1.2.x", "1.2.7", "1.3.0"),
            ("1", "1.9.9", "2.0.0"),
            ("1.x", "1.9.9", "2.0.0"),
            ("*", "4.0.0", "4.0.0-beta.1"),
            ("", "4.0.0", "4.0.0-beta.1"),
            (">=1.2.3 <2.0.0", "1.5.0", "2.0.0"),
            (">= 1.2.3 < 2", "1.5.0", "2.0.0"),
            ("1.2.3 - 2.3", "2.3.9", "2.4.0"),
            ("^1.0.0 || ^3.0.0", "3.1.0", "2.0.0"),
            ("^0.2.3", "0.2.9", "0.3.0"),
            ("^1.2.3-beta.1", "1.2.3-beta.2", "1.2.4-beta.1"),
            ("0.167.0-linux-x64", "0.167.0-linux-x64", "0.167.0"),
        ] {
            assert!(allows(range, yes), "{range} allows {yes}");
            assert!(!allows(range, no), "{range} refuses {no}");
        }
        assert!(npm_range("git+https://x").is_none());
        assert!(npm_range(">=").is_none());
    }

    #[test]
    fn platform_lists_follow_npm() {
        let linux = NpmPlatform::from_key("linux-x86_64").unwrap();
        assert!(linux.accepts(&json!({})));
        assert!(linux.accepts(&json!({ "os": ["linux"], "cpu": ["x64"], "libc": ["glibc"] })));
        assert!(!linux.accepts(&json!({ "os": ["darwin"] })));
        assert!(!linux.accepts(&json!({ "cpu": ["arm64"] })));
        assert!(!linux.accepts(&json!({ "libc": ["musl"] })));
        assert!(linux.accepts(&json!({ "os": ["!win32"] })));
        assert!(!linux.accepts(&json!({ "os": ["!linux"] })));
        assert!(linux.accepts(&json!({ "os": ["any"] })));
        let musl = NpmPlatform::from_key("linux-aarch64-musl").unwrap();
        assert!(musl.accepts(&json!({ "cpu": ["arm64"], "libc": ["musl"] })));
        let windows = NpmPlatform::from_key("windows-x86_64").unwrap();
        assert!(windows.accepts(&json!({ "os": ["win32"], "libc": ["glibc"] })));
        assert!(NpmPlatform::from_key("freebsd-x86_64").is_none());
    }

    #[test]
    fn aliases_and_odd_dependencies_are_told_apart() {
        assert_eq!(
            registry_dependency(
                "@openai/codex-linux-x64",
                "npm:@openai/codex@0.167.0-linux-x64"
            ),
            Some(("@openai/codex".into(), "0.167.0-linux-x64".into()))
        );
        assert_eq!(
            registry_dependency("x", "npm:plain"),
            Some(("plain".into(), "*".into()))
        );
        assert_eq!(registry_dependency("x", "github:a/b"), None);
        assert_eq!(registry_dependency("x", "file:../x"), None);
        assert_eq!(registry_dependency("../x", "1.0.0"), None);
        assert_eq!(
            metadata_url("@google/gemini-cli"),
            "https://registry.npmjs.org/@google%2fgemini-cli"
        );
    }

    #[test]
    fn latest_wins_when_the_range_allows_it() {
        let document = json!({
            "dist-tags": { "latest": "1.2.0", "next": "2.0.0-rc.1" },
            "versions": { "1.2.0": {}, "1.3.0": {}, "2.0.0-rc.1": {}, "0.9.0": {} }
        });
        assert_eq!(pick(&document, "^1.0.0").unwrap().0, "1.2.0");
        assert_eq!(pick(&document, "~1.3.0").unwrap().0, "1.3.0");
        assert_eq!(pick(&document, "next").unwrap().0, "2.0.0-rc.1");
        assert_eq!(pick(&document, "0.9.0").unwrap().0, "0.9.0");
        assert!(pick(&document, "^3").is_none());
    }

    #[test]
    fn disk_sizes_count_regular_files_once() {
        let outside = tempfile::TempDir::new().unwrap();
        std::fs::write(outside.path().join("big"), vec![0u8; 1000]).unwrap();
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().join("agents");
        std::fs::create_dir_all(root.join("sub/deeper")).unwrap();
        std::fs::write(root.join("a"), vec![0u8; 100]).unwrap();
        std::fs::write(root.join("sub/deeper/d"), vec![0u8; 10]).unwrap();
        #[cfg(unix)]
        {
            std::fs::hard_link(root.join("a"), root.join("sub/a-again")).unwrap();
            std::os::unix::fs::symlink(outside.path().join("big"), root.join("link")).unwrap();
            std::os::unix::fs::symlink(outside.path(), root.join("folder-link")).unwrap();
        }
        assert_eq!(disk_size(&root), Some(110));
        assert_eq!(disk_size_readable(&root), 110);
        assert_eq!(disk_size(&root.join("sub/deeper")), Some(10));
        assert_eq!(disk_size(&dir.path().join("missing")), None);
        assert_eq!(disk_size_readable(&dir.path().join("missing")), 0);
    }

    #[test]
    fn bundled_dependencies_are_not_counted_again() {
        let manifest = json!({
            "dependencies": { "a": "^1", "b": "^2" },
            "optionalDependencies": { "b": "^2", "c": "1.0.0" },
            "bundleDependencies": ["a"]
        });
        assert_eq!(
            dependencies(&manifest).unwrap(),
            vec![
                Want {
                    name: "b".into(),
                    spec: "^2".into(),
                    optional: true
                },
                Want {
                    name: "c".into(),
                    spec: "1.0.0".into(),
                    optional: true
                },
            ]
        );
        assert_eq!(
            dependencies(&json!({ "dependencies": { "a": "1" }, "bundleDependencies": true }))
                .unwrap(),
            Vec::new()
        );
    }
}
