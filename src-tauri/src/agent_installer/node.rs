//! RIM's own Node.js, for the agents that come as npm packages: the release it installs, where
//! its programs are, and installing a package with its npm.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use super::unpack::Format;

/// The Node.js release RIM installs: the newest LTS when this was written.
const NODE_VERSION: &str = "26.13.0";
/// Where Node.js releases are downloaded from.
const NODE_DIST: &str = "https://nodejs.org/dist";
/// Each platform's archive of [`NODE_VERSION`] and its SHA-256, from the release's
/// `SHASUMS256.txt`. There is no build for musl Linux.
const NODE_ARCHIVES: &[(&str, &str, &str)] = &[
    (
        "linux-x86_64",
        "node-v26.13.0-linux-x64.tar.gz",
        "5848553868b402d3fabb5b09270649977780a390f832155721025a08b5104455",
    ),
    (
        "linux-aarch64",
        "node-v26.13.0-linux-arm64.tar.gz",
        "439e9c438acdf6a6ffe47418da709153d66c4bed812e30a473faacb107dd2791",
    ),
    (
        "darwin-x86_64",
        "node-v26.13.0-darwin-x64.tar.gz",
        "525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e",
    ),
    (
        "darwin-aarch64",
        "node-v26.13.0-darwin-arm64.tar.gz",
        "d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6",
    ),
    (
        "windows-x86_64",
        "node-v26.13.0-win-x64.zip",
        "dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a",
    ),
    (
        "windows-aarch64",
        "node-v26.13.0-win-arm64.zip",
        "a9427139595156ef484e1fb08957676e09d4232368dd1743a2a9f93f3d241b14",
    ),
];
/// How long one `npm install` may take.
pub(crate) const NPM_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// The npm registry packages are installed from.
const NPM_REGISTRY: &str = "https://registry.npmjs.org/";
/// How many of npm's last stderr lines an error keeps.
const NPM_STDERR_LINES: usize = 12;
/// Keeps npm from opening a console window of its own on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One platform's Node.js archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NodeArchive {
    /// The registry platform key, such as `linux-x86_64`.
    pub(crate) platform: String,
    /// The archive's file name, which is also its top folder's name plus the extension.
    pub(crate) file: String,
    pub(crate) sha256: String,
}

impl NodeArchive {
    /// The folder the archive holds everything in: its file name without the extension.
    pub(crate) fn top_folder(&self) -> &str {
        self.file
            .strip_suffix(".tar.gz")
            .or_else(|| self.file.strip_suffix(".zip"))
            .unwrap_or(&self.file)
    }

    /// The archive's format.
    pub(crate) fn format(&self) -> Format {
        if self.file.ends_with(".zip") {
            Format::Zip
        } else {
            Format::TarGz
        }
    }
}

/// A Node.js release and its archives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NodeRelease {
    /// The version without a leading `v`.
    pub(crate) version: String,
    /// The download folder that holds `v<version>/`.
    pub(crate) dist_url: String,
    pub(crate) archives: Vec<NodeArchive>,
}

impl NodeRelease {
    /// The release built into RIM.
    pub(crate) fn pinned() -> Self {
        Self {
            version: NODE_VERSION.to_owned(),
            dist_url: NODE_DIST.to_owned(),
            archives: NODE_ARCHIVES
                .iter()
                .map(|(platform, file, sha256)| NodeArchive {
                    platform: (*platform).to_owned(),
                    file: (*file).to_owned(),
                    sha256: (*sha256).to_owned(),
                })
                .collect(),
        }
    }

    /// The archive for the registry platform key `platform`.
    pub(crate) fn archive_for(&self, platform: &str) -> Option<&NodeArchive> {
        self.archives
            .iter()
            .find(|archive| archive.platform == platform)
    }

    /// The download URL of `archive`.
    pub(crate) fn url(&self, archive: &NodeArchive) -> String {
        format!("{}/v{}/{}", self.dist_url, self.version, archive.file)
    }
}

/// The `node` program in the Node.js folder `dir`.
pub(crate) fn node_program(dir: &Path) -> PathBuf {
    if cfg!(windows) {
        dir.join("node.exe")
    } else {
        dir.join("bin").join("node")
    }
}

/// The folder in the Node.js folder `dir` that holds `node`, for `PATH`.
pub(crate) fn node_bin(dir: &Path) -> PathBuf {
    if cfg!(windows) {
        dir.to_path_buf()
    } else {
        dir.join("bin")
    }
}

/// npm's own script in the Node.js folder `dir`.
pub(crate) fn npm_cli(dir: &Path) -> PathBuf {
    let modules = if cfg!(windows) {
        dir.join("node_modules")
    } else {
        dir.join("lib").join("node_modules")
    };
    modules.join("npm").join("bin").join("npm-cli.js")
}

/// The arguments `node` gets to install `package` at `version` into `prefix` with npm: no
/// install scripts, no audit, no funding notice, no development dependencies, from the public
/// npm registry, with `cache` as npm's cache.
pub(crate) fn npm_install_args(
    npm_cli: &Path,
    prefix: &Path,
    cache: &Path,
    package: &str,
    version: &str,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![npm_cli.into(), "install".into(), "--prefix".into()];
    args.push(prefix.into());
    for flag in [
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--omit=dev",
        "--save-exact",
    ] {
        args.push(flag.into());
    }
    args.push(format!("--registry={NPM_REGISTRY}").into());
    args.push("--cache".into());
    args.push(cache.into());
    args.push(format!("{package}@{version}").into());
    args
}

/// Runs npm from the Node.js folder `node_dir` to install `package` at `version` into `prefix`,
/// without a shell, with that Node.js first on `PATH`, within [`NPM_TIMEOUT`].
///
/// # Errors
///
/// A sentence for the page with the end of npm's stderr when npm fails, or when it cannot be
/// started or takes too long.
pub(crate) async fn npm_install(
    node_dir: &Path,
    prefix: &Path,
    cache: &Path,
    package: &str,
    version: &str,
) -> Result<(), String> {
    let mut command = tokio::process::Command::new(node_program(node_dir));
    crate::host_env::restore_host_env(&mut command);
    let base = crate::host_env::host_path().unwrap_or_default();
    let mut dirs = vec![node_bin(node_dir)];
    dirs.extend(std::env::split_paths(&base));
    if let Ok(path) = std::env::join_paths(dirs) {
        command.env("PATH", path);
    }
    command
        .args(npm_install_args(
            &npm_cli(node_dir),
            prefix,
            cache,
            package,
            version,
        ))
        .current_dir(prefix)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = match tokio::time::timeout(NPM_TIMEOUT, command.output()).await {
        Err(_) => return Err(format!("npm took too long to install {package}.")),
        Ok(Err(error)) => return Err(format!("npm could not be started: {error}.")),
        Ok(Ok(output)) => output,
    };
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let lines: Vec<&str> = stderr
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let tail = lines[lines.len().saturating_sub(NPM_STDERR_LINES)..].join("\n");
    Err(format!("npm could not install {package}:\n{tail}"))
}

/// The script `package`'s command runs, after it was installed into `prefix`: its
/// `package.json` `bin` when that is one path, its only entry, or the entry named after the last
/// part of the package's name. The path is inside `prefix` and a file.
///
/// # Errors
///
/// A sentence for the page when `package.json` cannot be read or names no single script, or
/// the script is outside `prefix` or missing.
pub(crate) fn package_bin(prefix: &Path, package: &str) -> Result<PathBuf, String> {
    let package_dir = package
        .split('/')
        .fold(prefix.join("node_modules"), |dir, part| dir.join(part));
    let missing = || format!("{package} was installed without a program to start.");
    let raw = std::fs::read(package_dir.join("package.json")).map_err(|_| missing())?;
    let manifest: serde_json::Value = serde_json::from_slice(&raw).map_err(|_| missing())?;
    let short_name = package.rsplit('/').next().unwrap_or(package);
    let script = match manifest.get("bin") {
        Some(serde_json::Value::String(path)) => path.clone(),
        Some(serde_json::Value::Object(entries)) => {
            let only = (entries.len() == 1)
                .then(|| entries.values().next())
                .flatten();
            only.or_else(|| entries.get(short_name))
                .and_then(serde_json::Value::as_str)
                .ok_or_else(missing)?
                .to_owned()
        }
        _ => return Err(missing()),
    };
    let relative = Path::new(&script);
    if relative
        .components()
        .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err(missing());
    }
    let path = package_dir.join(relative);
    let inside = std::fs::canonicalize(&path)
        .ok()
        .zip(std::fs::canonicalize(prefix).ok())
        .is_some_and(|(path, prefix)| path.starts_with(prefix) && path.is_file());
    if !inside {
        return Err(missing());
    }
    Ok(path
        .components()
        .filter(|part| !matches!(part, Component::CurDir))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn the_pinned_release_covers_six_platforms() {
        let release = NodeRelease::pinned();
        assert_eq!(release.archives.len(), 6);
        let linux = release.archive_for("linux-x86_64").unwrap();
        assert_eq!(linux.top_folder(), "node-v26.13.0-linux-x64");
        assert_eq!(linux.format(), Format::TarGz);
        assert_eq!(
            release.url(linux),
            "https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.gz"
        );
        let windows = release.archive_for("windows-x86_64").unwrap();
        assert_eq!(windows.top_folder(), "node-v26.13.0-win-x64");
        assert_eq!(windows.format(), Format::Zip);
        assert!(release.archive_for("linux-x86_64-musl").is_none());
        for archive in &release.archives {
            assert_eq!(archive.sha256.len(), 64);
            assert!(archive.file.contains(NODE_VERSION));
        }
    }

    #[test]
    fn the_npm_command_installs_one_exact_package_without_scripts() {
        let args = npm_install_args(
            Path::new("/n/lib/node_modules/npm/bin/npm-cli.js"),
            Path::new("/a/codex/.staging-x"),
            Path::new("/a/.npm-cache"),
            "@agentclientprotocol/codex-acp",
            "2.6.0",
        );
        let text: Vec<String> = args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            text,
            [
                "/n/lib/node_modules/npm/bin/npm-cli.js",
                "install",
                "--prefix",
                "/a/codex/.staging-x",
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--omit=dev",
                "--save-exact",
                "--registry=https://registry.npmjs.org/",
                "--cache",
                "/a/.npm-cache",
                "@agentclientprotocol/codex-acp@2.6.0",
            ]
        );
    }

    #[test]
    fn node_paths_follow_the_platform_layout() {
        let dir = Path::new("/n");
        if cfg!(windows) {
            assert_eq!(node_program(dir), dir.join("node.exe"));
            assert_eq!(npm_cli(dir), dir.join("node_modules/npm/bin/npm-cli.js"));
        } else {
            assert_eq!(node_program(dir), Path::new("/n/bin/node"));
            assert_eq!(node_bin(dir), Path::new("/n/bin"));
            assert_eq!(
                npm_cli(dir),
                Path::new("/n/lib/node_modules/npm/bin/npm-cli.js")
            );
        }
    }

    fn package(prefix: &Path, name: &str, manifest: serde_json::Value, files: &[&str]) {
        let dir = name
            .split('/')
            .fold(prefix.join("node_modules"), |dir, part| dir.join(part));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), manifest.to_string()).unwrap();
        for file in files {
            let path = dir.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "#!/usr/bin/env node\n").unwrap();
        }
    }

    #[test]
    fn the_bin_script_is_found_in_each_form() {
        let prefix = TempDir::new().unwrap();
        let root = prefix.path();
        package(
            root,
            "@google/gemini-cli",
            serde_json::json!({ "bin": { "gemini": "bundle/gemini.js" } }),
            &["bundle/gemini.js"],
        );
        assert_eq!(
            package_bin(root, "@google/gemini-cli").unwrap(),
            root.join("node_modules/@google/gemini-cli/bundle/gemini.js")
        );

        package(
            root,
            "@agentclientprotocol/codex-acp",
            serde_json::json!({ "bin": { "other": "o.js", "codex-acp": "./bin/codex-acp.js" } }),
            &["bin/codex-acp.js", "o.js"],
        );
        assert_eq!(
            package_bin(root, "@agentclientprotocol/codex-acp").unwrap(),
            root.join("node_modules/@agentclientprotocol/codex-acp/bin/codex-acp.js")
        );

        package(
            root,
            "plain",
            serde_json::json!({ "bin": "cli.js" }),
            &["cli.js"],
        );
        assert_eq!(
            package_bin(root, "plain").unwrap(),
            root.join("node_modules/plain/cli.js")
        );
    }

    #[test]
    fn a_bin_that_is_missing_ambiguous_or_outside_is_refused() {
        let prefix = TempDir::new().unwrap();
        let root = prefix.path();
        package(
            root,
            "two",
            serde_json::json!({ "bin": { "a": "a.js", "b": "b.js" } }),
            &["a.js", "b.js"],
        );
        package(root, "none", serde_json::json!({}), &[]);
        package(root, "gone", serde_json::json!({ "bin": "gone.js" }), &[]);
        package(root, "up", serde_json::json!({ "bin": "../../x.js" }), &[]);
        std::fs::write(root.join("x.js"), "").unwrap();
        package(
            root,
            "abs",
            serde_json::json!({ "bin": "/etc/passwd" }),
            &[],
        );
        for name in ["two", "none", "gone", "up", "abs", "never-installed"] {
            assert!(package_bin(root, name).is_err(), "{name}");
        }
    }
}
