//! The agents RIM installs, each with its source fixed here, and the check of a registry entry
//! against that source: the registry can choose only the version.

use std::collections::BTreeMap;

use reqwest::Url;
use serde::{Deserialize, Serialize};

use super::node::NodeRelease;
use super::size::Size;
use super::unpack::{self, Format};

/// The problem of an agent with no build for this computer.
pub(crate) const NOT_AVAILABLE: &str = "Not available on this computer.";
/// Longest licence text shown as the registry gives it.
const MAX_LICENSE: usize = 64;
/// Longest version, in characters.
const MAX_VERSION: usize = 40;

/// Where an agent comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Source {
    /// An archive from a GitHub release, its URL starting with this prefix.
    Binary { url_prefix: &'static str },
    /// An npm package with exactly this name.
    Npm { package: &'static str },
}

/// An agent RIM installs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Preset {
    /// The id the page knows the agent by.
    pub(crate) id: &'static str,
    /// The name the dialog and the page show.
    pub(crate) name: &'static str,
    /// The agent's id in the registry.
    pub(crate) registry_id: &'static str,
    pub(crate) source: Source,
    /// The arguments it runs with as an ACP agent.
    pub(crate) args: &'static [&'static str],
}

impl Preset {
    /// Whether it installs from npm, with RIM's Node.js.
    pub(crate) fn is_npm(&self) -> bool {
        matches!(self.source, Source::Npm { .. })
    }
}

/// The agents RIM installs, in the order the page lists them.
pub(crate) const PRESETS: &[Preset] = &[
    Preset {
        id: "claude-code",
        name: "Claude Code",
        registry_id: "claude-acp",
        source: Source::Binary {
            url_prefix:
                "https://github.com/agentclientprotocol/claude-agent-acp/releases/download/",
        },
        args: &[],
    },
    Preset {
        id: "opencode",
        name: "opencode",
        registry_id: "opencode",
        source: Source::Binary {
            url_prefix: "https://github.com/anomalyco/opencode/releases/download/",
        },
        args: &["acp"],
    },
    Preset {
        id: "goose",
        name: "Goose",
        registry_id: "goose",
        source: Source::Binary {
            url_prefix: "https://github.com/block/goose/releases/download/",
        },
        args: &["acp"],
    },
    Preset {
        id: "codex",
        name: "Codex",
        registry_id: "codex-acp",
        source: Source::Npm {
            package: "@agentclientprotocol/codex-acp",
        },
        args: &[],
    },
    Preset {
        id: "gemini-cli",
        name: "Gemini CLI",
        registry_id: "gemini",
        source: Source::Npm {
            package: "@google/gemini-cli",
        },
        args: &["--acp"],
    },
];

/// The preset with id `id`.
pub(crate) fn find(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|preset| preset.id == id)
}

/// What the registry offers for a preset, as the page shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    pub(crate) version: String,
    pub(crate) license: String,
    /// `github.com/<owner>/<repo>` or `npm package <name>`.
    pub(crate) source: String,
    /// How big it is, when that is known.
    pub(crate) size: Option<Size>,
}

/// What to fetch for a preset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Target {
    /// An archive, its SHA-256 in lowercase hex and the program's path inside it, with `/`
    /// between its parts.
    Binary {
        url: String,
        sha256: String,
        format: Format,
        cmd: String,
    },
    /// The npm package of the preset at [`Available::version`].
    Npm { package: &'static str },
}

/// A registry entry that passed its preset's rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Resolved {
    pub(crate) available: Available,
    pub(crate) target: Target,
}

/// The part of a registry entry that is read.
#[derive(Debug, Deserialize)]
struct Entry {
    version: String,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    distribution: Distribution,
}

#[derive(Debug, Default, Deserialize)]
struct Distribution {
    #[serde(default)]
    binary: Option<BTreeMap<String, serde_json::Value>>,
    #[serde(default)]
    npx: Option<Npx>,
}

#[derive(Debug, Deserialize)]
struct BinaryBuild {
    archive: String,
    cmd: String,
    #[serde(default)]
    args: Option<Vec<String>>,
    sha256: String,
}

#[derive(Debug, Deserialize)]
struct Npx {
    package: String,
    #[serde(default)]
    args: Option<Vec<String>>,
}

/// Checks the registry's `entry` for `preset` on `platform`, a registry platform key such as
/// `linux-x86_64`, and returns what to install. An npm agent needs `node` to have a build for
/// the platform.
///
/// # Errors
///
/// The problem the page shows: no entry, no build for this computer, or an entry that breaks
/// the preset's rule.
pub(crate) fn resolve(
    preset: &Preset,
    entry: Option<&serde_json::Value>,
    platform: Option<&str>,
    node: &NodeRelease,
) -> Result<Resolved, String> {
    let entry = entry.ok_or_else(|| format!("The registry has no entry for {}.", preset.name))?;
    let broken = |why: &str| {
        format!(
            "The registry's entry for {} is not what RIM expects ({why}), so it can't be \
             installed.",
            preset.name
        )
    };
    let entry: Entry =
        serde_json::from_value(entry.clone()).map_err(|_| broken("it can't be read"))?;
    if !is_version(&entry.version) {
        return Err(broken("the version is not valid"));
    }
    let license = license_text(entry.license.as_deref());
    let platform = platform.ok_or(NOT_AVAILABLE)?;
    match preset.source {
        Source::Binary { url_prefix } => {
            let build = entry
                .distribution
                .binary
                .as_ref()
                .and_then(|builds| builds.get(platform))
                .ok_or(NOT_AVAILABLE)?;
            let build: BinaryBuild = serde_json::from_value(build.clone())
                .map_err(|_| broken("its build can't be read"))?;
            if !is_source_url(&build.archive, url_prefix) {
                return Err(broken("the download is not from its project"));
            }
            let format = unpack::format_of(&build.archive)
                .ok_or_else(|| broken("the download is not a known kind of archive"))?;
            let sha256 = build.sha256.to_ascii_lowercase();
            if !is_sha256(&sha256) {
                return Err(broken("the checksum is not valid"));
            }
            if build.args.unwrap_or_default() != preset.args {
                return Err(broken("the arguments differ"));
            }
            let cmd =
                normalize_cmd(&build.cmd).ok_or_else(|| broken("the program path is not valid"))?;
            Ok(Resolved {
                available: Available {
                    version: entry.version,
                    license,
                    source: github_source(url_prefix),
                    size: None,
                },
                target: Target::Binary {
                    url: build.archive,
                    sha256,
                    format,
                    cmd,
                },
            })
        }
        Source::Npm { package } => {
            let npx = entry
                .distribution
                .npx
                .as_ref()
                .ok_or_else(|| broken("it is not an npm package"))?;
            let (name, version) = split_package(&npx.package)
                .ok_or_else(|| broken("the package name can't be read"))?;
            if name != package {
                return Err(broken("the package is not its own"));
            }
            if version != entry.version {
                return Err(broken("the package's version differs"));
            }
            if npx.args.clone().unwrap_or_default() != preset.args {
                return Err(broken("the arguments differ"));
            }
            if node.archive_for(platform).is_none() {
                return Err(NOT_AVAILABLE.to_owned());
            }
            Ok(Resolved {
                available: Available {
                    version: entry.version,
                    license,
                    source: format!("npm package {package}"),
                    size: None,
                },
                target: Target::Npm { package },
            })
        }
    }
}

/// Whether `version` matches `^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$`.
pub(crate) fn is_version(version: &str) -> bool {
    let mut chars = version.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && version.len() <= MAX_VERSION
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'))
}

/// Whether `sha256` is 64 lowercase hex digits.
fn is_sha256(sha256: &str) -> bool {
    sha256.len() == 64
        && sha256
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Whether `url` is a plain `https://` URL under `prefix`: no credentials, port, query or
/// fragment, and nothing a URL parser would rewrite, such as `..` or `%2e%2e`.
fn is_source_url(url: &str, prefix: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    parsed.as_str() == url
        && parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.port().is_none()
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && url.len() > prefix.len()
        && url.starts_with(prefix)
}

/// `github.com/<owner>/<repo>` from a release download prefix.
fn github_source(url_prefix: &str) -> String {
    url_prefix
        .trim_start_matches("https://")
        .trim_end_matches("/releases/download/")
        .to_owned()
}

/// `name@version` split at the `@` before the version; a scoped name keeps its leading `@`.
fn split_package(package: &str) -> Option<(&str, &str)> {
    let (name, version) = package.rsplit_once('@')?;
    (!name.is_empty() && name != "@").then_some((name, version))
}

/// The program's path inside an archive with `/` between its parts and without a leading
/// `./`; `None` when it is absolute or has an empty, `.` or `..` part.
pub(crate) fn normalize_cmd(cmd: &str) -> Option<String> {
    let cmd = cmd.replace('\\', "/");
    let cmd = cmd.strip_prefix("./").unwrap_or(&cmd);
    let valid = !cmd.is_empty()
        && !cmd.contains(['\0', ':'])
        && cmd
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..");
    valid.then(|| cmd.to_owned())
}

/// The licence as the registry gives it when it is short, printable text, otherwise "not
/// stated".
fn license_text(license: Option<&str>) -> String {
    match license.map(str::trim) {
        Some(text)
            if !text.is_empty()
                && text.chars().count() <= MAX_LICENSE
                && text.chars().all(|c| !c.is_control()) =>
        {
            text.to_owned()
        }
        _ => "not stated".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node() -> NodeRelease {
        NodeRelease::pinned()
    }

    fn binary_entry(build: serde_json::Value) -> serde_json::Value {
        json!({
            "id": "goose",
            "version": "1.58.0",
            "license": "Apache-2.0",
            "distribution": { "binary": { "linux-x86_64": build } }
        })
    }

    fn goose() -> &'static Preset {
        find("goose").unwrap()
    }

    fn good_build() -> serde_json::Value {
        json!({
            "archive": "https://github.com/block/goose/releases/download/v1.58.0/goose.tar.bz2",
            "cmd": "./goose",
            "args": ["acp"],
            "sha256": "95A51039211CE21AF1527C3BA9AF849146E6F429FF0C96CF14759E3FA84876E6"
        })
    }

    fn resolve_build(build: serde_json::Value) -> Result<Resolved, String> {
        resolve(
            goose(),
            Some(&binary_entry(build)),
            Some("linux-x86_64"),
            &node(),
        )
    }

    #[test]
    fn a_good_binary_entry_resolves() {
        let resolved = resolve_build(good_build()).unwrap();
        assert_eq!(
            resolved.available,
            Available {
                version: "1.58.0".into(),
                license: "Apache-2.0".into(),
                source: "github.com/block/goose".into(),
                size: None,
            }
        );
        assert_eq!(
            resolved.target,
            Target::Binary {
                url: "https://github.com/block/goose/releases/download/v1.58.0/goose.tar.bz2"
                    .into(),
                sha256: "95a51039211ce21af1527c3ba9af849146e6f429ff0c96cf14759e3fa84876e6".into(),
                format: Format::TarBz2,
                cmd: "goose".into(),
            }
        );
    }

    #[test]
    fn a_binary_entry_that_breaks_its_rule_is_refused() {
        let with = |key: &str, value: serde_json::Value| {
            let mut build = good_build();
            build[key] = value;
            build
        };
        for (build, why) in [
            (
                with("archive", json!("https://github.com/evil/goose/releases/download/v1/goose.tar.bz2")),
                "not from its project",
            ),
            (
                with("archive", json!("http://github.com/block/goose/releases/download/v1/goose.tar.bz2")),
                "not from its project",
            ),
            (
                with("archive", json!("https://github.com/block/goose/releases/download/../../../evil/x/releases/download/a.tar.bz2")),
                "not from its project",
            ),
            (
                with("archive", json!("https://github.com/block/goose/releases/download/v1/goose.tar.bz2?x=1")),
                "not from its project",
            ),
            (
                with("archive", json!("https://github.com/block/goose/releases/download/v1/goose.exe")),
                "known kind of archive",
            ),
            (with("sha256", json!("abc")), "checksum"),
            (with("args", json!([])), "arguments differ"),
            (with("args", json!(["acp", "--yolo"])), "arguments differ"),
            (with("cmd", json!("/usr/bin/goose")), "program path"),
            (with("cmd", json!("../goose")), "program path"),
            (with("cmd", json!("a/../../goose")), "program path"),
        ] {
            let error = resolve_build(build).expect_err(why);
            assert!(error.contains(why), "{why}: {error}");
        }
    }

    #[test]
    fn a_bad_version_is_refused() {
        for version in ["", "-1", "1 0", "1/2", &"1".repeat(41)] {
            let mut entry = binary_entry(good_build());
            entry["version"] = json!(version);
            let error = resolve(goose(), Some(&entry), Some("linux-x86_64"), &node()).unwrap_err();
            assert!(error.contains("version is not valid"), "{version}: {error}");
        }
        assert!(is_version("1.0.0-rc.1+build"));
    }

    #[test]
    fn missing_builds_are_not_available() {
        let entry = binary_entry(good_build());
        assert_eq!(
            resolve(goose(), Some(&entry), Some("windows-aarch64"), &node()),
            Err(NOT_AVAILABLE.to_owned())
        );
        assert_eq!(
            resolve(goose(), Some(&entry), None, &node()),
            Err(NOT_AVAILABLE.to_owned())
        );
        assert!(resolve(goose(), None, Some("linux-x86_64"), &node())
            .unwrap_err()
            .contains("no entry"));
    }

    #[test]
    fn missing_args_are_no_args() {
        let preset = find("claude-code").unwrap();
        let entry = json!({
            "version": "0.102.0",
            "license": "proprietary",
            "distribution": { "binary": { "linux-x86_64": {
                "archive": "https://github.com/agentclientprotocol/claude-agent-acp/releases/download/v0.102.0/a.tar.gz",
                "cmd": "./claude-agent-acp",
                "sha256": "b3f99ebf7580b2eb30d3efb1b42a9a81be5669e7e2a341e6bfed722a8f56eacb"
            } } }
        });
        let resolved = resolve(preset, Some(&entry), Some("linux-x86_64"), &node()).unwrap();
        assert_eq!(
            resolved.available.source,
            "github.com/agentclientprotocol/claude-agent-acp"
        );
    }

    #[test]
    fn npm_entries_must_name_their_own_package() {
        let preset = find("gemini-cli").unwrap();
        let entry = |package: &str, args: serde_json::Value| {
            json!({
                "version": "0.67.0",
                "license": "Apache-2.0",
                "distribution": { "npx": { "package": package, "args": args } }
            })
        };
        let resolved = resolve(
            preset,
            Some(&entry("@google/gemini-cli@0.67.0", json!(["--acp"]))),
            Some("linux-x86_64"),
            &node(),
        )
        .unwrap();
        assert_eq!(resolved.available.source, "npm package @google/gemini-cli");
        assert_eq!(
            resolved.target,
            Target::Npm {
                package: "@google/gemini-cli"
            }
        );

        for (package, args, why) in [
            ("@evil/gemini-cli@0.67.0", json!(["--acp"]), "not its own"),
            (
                "@google/gemini-cli-x@0.67.0",
                json!(["--acp"]),
                "not its own",
            ),
            (
                "@google/gemini-cli@0.68.0",
                json!(["--acp"]),
                "version differs",
            ),
            ("@google/gemini-cli@0.67.0", json!([]), "arguments differ"),
            (
                "@google/gemini-cli",
                json!(["--acp"]),
                "package name can't be read",
            ),
        ] {
            let error = resolve(
                preset,
                Some(&entry(package, args)),
                Some("linux-x86_64"),
                &node(),
            )
            .expect_err(package);
            assert!(error.contains(why), "{package}: {error}");
        }
        assert_eq!(
            resolve(
                preset,
                Some(&entry("@google/gemini-cli@0.67.0", json!(["--acp"]))),
                Some("linux-x86_64-musl"),
                &node(),
            ),
            Err(NOT_AVAILABLE.to_owned())
        );
    }

    #[test]
    fn commands_are_normalized() {
        assert_eq!(
            normalize_cmd("./goose-package\\goose.exe").as_deref(),
            Some("goose-package/goose.exe")
        );
        assert_eq!(normalize_cmd("./opencode").as_deref(), Some("opencode"));
        assert_eq!(normalize_cmd("bin/./x"), None);
        assert_eq!(normalize_cmd("C:\\x.exe"), None);
        assert_eq!(normalize_cmd("./"), None);
        assert_eq!(normalize_cmd("a//b"), None);
    }

    #[test]
    fn odd_licences_are_not_shown_as_they_are() {
        assert_eq!(license_text(Some("MIT")), "MIT");
        assert_eq!(license_text(None), "not stated");
        assert_eq!(license_text(Some("a\nb")), "not stated");
        assert_eq!(license_text(Some(&"x".repeat(65))), "not stated");
    }

    #[test]
    fn presets_are_in_table_order() {
        let ids: Vec<&str> = PRESETS.iter().map(|preset| preset.id).collect();
        assert_eq!(
            ids,
            ["claude-code", "opencode", "goose", "codex", "gemini-cli"]
        );
    }
}
