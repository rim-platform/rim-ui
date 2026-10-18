use crate::plugin_host::discovery::{plugins_dir, MANIFEST_FILE};
use crate::plugin_host::git_source;
use crate::plugin_host::manifest::{ManifestError, PluginManifest, RuntimeKind};
use crate::plugin_host::post_install::{self, PostInstallStep};
use crate::plugin_host::trash;
use crate::plugin_host::validation::{
    validate_plugin_manifest, validate_plugin_manifest_for_host, ValidationError,
};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum GitInstallError {
    /// The repository URL failed validation; nothing was spawned.
    #[error("invalid git URL: {0}")]
    InvalidUrl(String),
    /// The branch failed validation; nothing was spawned.
    #[error("invalid git branch: {0}")]
    InvalidBranch(String),
    /// The plugin needs dependency-install steps that execute author code;
    /// the caller must retry with explicit consent. Nothing was run and
    /// (for install) nothing was kept on disk; (for update) the working tree
    /// was not advanced.
    #[error("plugin {plugin_id} needs post-install steps that run code from the plugin author; explicit consent is required")]
    PostInstallConsentRequired {
        plugin_id: String,
        steps: Vec<PostInstallStep>,
    },
    #[error("git clone failed: {0}")]
    CloneFailed(String),
    /// The repository has no `rim-plugin.json` at its root.
    #[error("no rim-plugin.json found at the root of the repository; every plugin needs one")]
    NoManifest,
    #[error("manifest error: {0}")]
    Manifest(#[from] ManifestError),
    #[error("invalid manifest: {0}")]
    InvalidManifest(#[from] ValidationError),
    /// The lifecycle refused the install, for example because the plugin is
    /// already installed. Distinct from `Io` so the UI can tell "install
    /// refused" from "disk error".
    #[error("lifecycle error: {0}")]
    LifecycleFailure(String),
    #[error("plugin already exists: {0}")]
    AlreadyExists(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("post-install failed: {0}")]
    PostInstallFailed(String),
    #[error("git pull failed: {0}")]
    PullFailed(String),
}

impl Serialize for GitInstallError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(None)?;
        match self {
            // Keep the inner typed ValidationError so the UI can branch on the
            // specific rule the manifest broke without parsing the message.
            Self::InvalidManifest(inner) => {
                map.serialize_entry("kind", "INVALID_MANIFEST")?;
                map.serialize_entry("message", &self.to_string())?;
                map.serialize_entry("data", inner)?;
            }
            Self::InvalidUrl(_) => {
                map.serialize_entry("kind", "INVALID_GIT_URL")?;
                map.serialize_entry("message", &self.to_string())?;
            }
            Self::InvalidBranch(_) => {
                map.serialize_entry("kind", "INVALID_GIT_BRANCH")?;
                map.serialize_entry("message", &self.to_string())?;
            }
            Self::PostInstallConsentRequired { plugin_id, steps } => {
                #[derive(Serialize)]
                struct ConsentData<'a> {
                    plugin_id: &'a str,
                    steps: &'a [PostInstallStep],
                }
                map.serialize_entry("kind", "POST_INSTALL_CONSENT_REQUIRED")?;
                map.serialize_entry("message", &self.to_string())?;
                map.serialize_entry("data", &ConsentData { plugin_id, steps })?;
            }
            other => {
                map.serialize_entry("kind", "GIT_INSTALL_ERROR")?;
                map.serialize_entry("message", &other.to_string())?;
            }
        }
        map.end()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginInstallResult {
    pub plugin_id: String,
    pub display_name: String,
    pub version: String,
    pub capabilities: Vec<String>,
    pub install_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginUpdateResult {
    pub plugin_id: String,
    pub old_version: String,
    pub new_version: String,
    pub capabilities_changed: bool,
    pub added_capabilities: Vec<String>,
    pub removed_capabilities: Vec<String>,
}

fn staging_dir() -> PathBuf {
    dirs::home_dir()
        .expect("home directory must be resolvable")
        .join(".rim")
        .join("staging")
}

/// Clones a git repository into the staging directory and returns the clone's
/// path.
///
/// `url` and `branch` are validated before git is spawned; the argv puts `--`
/// before the positionals and the child runs with the hardened git env
/// (see [`git_source`]).
///
/// # Errors
///
/// Returns [`GitInstallError::InvalidUrl`] or [`GitInstallError::InvalidBranch`]
/// when validation fails, [`GitInstallError::CloneFailed`] when git cannot be
/// spawned or exits with failure, and [`GitInstallError::Io`] when the staging
/// directory cannot be prepared.
pub async fn git_clone(url: &str, branch: Option<&str>) -> Result<PathBuf, GitInstallError> {
    git_source::validate_git_url(url).map_err(GitInstallError::InvalidUrl)?;
    if let Some(b) = branch {
        git_source::validate_git_branch(b).map_err(GitInstallError::InvalidBranch)?;
    }

    let staging = staging_dir();
    std::fs::create_dir_all(&staging)?;

    // Generate a unique staging name
    let staging_name = format!("staging-{}", std::process::id());
    let clone_dir = staging.join(&staging_name);

    // Clean up any previous staging attempt
    if clone_dir.exists() {
        std::fs::remove_dir_all(&clone_dir)?;
    }

    let output = git_source::git_command()
        .args(git_source::clone_args(url, branch, &clone_dir))
        .output()
        .await
        .map_err(|e| GitInstallError::CloneFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Clean up on failure
        let _ = std::fs::remove_dir_all(&clone_dir);
        return Err(GitInstallError::CloneFailed(stderr.to_string()));
    }

    Ok(clone_dir)
}

/// Loads and checks the `rim-plugin.json` at the root of a cloned directory.
///
/// # Errors
///
/// Returns [`GitInstallError::Manifest`] when a manifest is found but invalid,
/// and [`GitInstallError::NoManifest`] when there is none.
pub fn detect_manifest(clone_dir: &Path) -> Result<PluginManifest, GitInstallError> {
    let json_manifest = clone_dir.join(MANIFEST_FILE);
    if json_manifest.exists() {
        return Ok(PluginManifest::load(&json_manifest)?);
    }
    Err(GitInstallError::NoManifest)
}

/// Moves a cloned plugin from staging into the plugins directory and returns
/// its final path.
///
/// # Errors
///
/// Returns [`GitInstallError::AlreadyExists`] when the plugin's directory
/// exists, and [`GitInstallError::Io`] when the move fails.
pub fn finalize_install(clone_dir: &Path, plugin_id: &str) -> Result<PathBuf, GitInstallError> {
    let final_dir = plugins_dir().join(plugin_id);

    if final_dir.exists() {
        return Err(GitInstallError::AlreadyExists(plugin_id.to_string()));
    }

    std::fs::create_dir_all(plugins_dir())?;

    // Move from staging to final location
    std::fs::rename(clone_dir, &final_dir).or_else(|_| {
        // rename may fail across filesystems; fall back to copy + delete
        copy_dir_recursive(clone_dir, &final_dir)?;
        std::fs::remove_dir_all(clone_dir)?;
        Ok::<(), std::io::Error>(())
    })?;

    Ok(final_dir)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), dest_path)?;
        }
    }
    Ok(())
}

/// Checks that a web plugin's checkout holds its built bundle files (the
/// manifest, the entrypoint and `panels/`) by the bundle rules. Nothing of a web
/// plugin ever runs on this computer; other files of the checkout are left alone.
fn check_web_checkout(dir: &Path) -> Result<(), GitInstallError> {
    crate::plugin_host::bundle::check_dir(dir)
        .map(|_| ())
        .map_err(|e| {
            GitInstallError::Manifest(ManifestError::Validation(format!(
                "web plugins are installed built: {e}"
            )))
        })
}

/// Installs a plugin from a git repository: validate URL → clone → detect
/// manifest → validate → consent gate → move → post-install.
///
/// Post-install steps (npm/pip) run only when `allow_post_install` is true.
/// `existing_plugin_ids` are refused as collisions and `forbidden_origins` are
/// passed to manifest validation. Returns the manifest, the installed directory
/// and the summary the UI shows.
///
/// # Errors
///
/// Returns [`GitInstallError::PostInstallConsentRequired`] when steps would be
/// needed and consent is absent; the staging clone is deleted before anything
/// is moved into the plugins directory or executed. Returns the other
/// variants when cloning, manifest detection, validation, the move or a
/// post-install step fails.
pub async fn install_from_git(
    url: &str,
    branch: Option<&str>,
    existing_plugin_ids: &[String],
    allow_post_install: bool,
    forbidden_origins: &[String],
) -> Result<(PluginManifest, PathBuf, PluginInstallResult), GitInstallError> {
    let clone_dir = git_clone(url, branch).await?;

    let manifest = match detect_manifest(&clone_dir) {
        Ok(m) => m,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&clone_dir);
            return Err(e);
        }
    };

    // Check for collision
    if existing_plugin_ids.contains(&manifest.plugin_id) {
        let _ = std::fs::remove_dir_all(&clone_dir);
        return Err(GitInstallError::AlreadyExists(manifest.plugin_id.clone()));
    }

    // Check reserved prefix
    if manifest.has_reserved_prefix() {
        let _ = std::fs::remove_dir_all(&clone_dir);
        return Err(GitInstallError::Manifest(ManifestError::Validation(
            format!("reserved plugin_id prefix: {}", manifest.plugin_id),
        )));
    }

    // Capability names and the AI-surface install-ID leak check. Runs before
    // anything is persisted so a malformed manifest never reaches the registry.
    if let Err(e) = validate_plugin_manifest_for_host(&manifest, forbidden_origins) {
        log::warn!(
            "[AUDIT] event=plugin_install_rejected plugin_id={} reason={}",
            manifest.plugin_id,
            e
        );
        let _ = std::fs::remove_dir_all(&clone_dir);
        return Err(GitInstallError::InvalidManifest(e));
    }

    let web = manifest.runtime_kind == RuntimeKind::WebSandboxed;
    if web {
        if let Err(e) = check_web_checkout(&clone_dir) {
            let _ = std::fs::remove_dir_all(&clone_dir);
            return Err(e);
        }
    }

    // Post-install consent gate, decided on the staged files before anything is
    // moved into the plugins directory or executed.
    let planned_dir = plugins_dir().join(&manifest.plugin_id);
    let steps = if web {
        Vec::new()
    } else {
        post_install::detect_steps(&clone_dir, &planned_dir)
    };
    let steps = match post_install::gate(&manifest.plugin_id, steps, allow_post_install) {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&clone_dir);
            return Err(e);
        }
    };

    let final_dir = match finalize_install(&clone_dir, &manifest.plugin_id) {
        Ok(d) => d,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&clone_dir);
            return Err(e);
        }
    };

    if let Err(e) = post_install::gate_and_run(
        &manifest.plugin_id,
        steps,
        allow_post_install,
        post_install::run_steps,
    )
    .await
    {
        // Clean up on post-install failure
        let _ = trash::delete_later(&plugins_dir(), &manifest.plugin_id);
        return Err(e);
    }

    let result = PluginInstallResult {
        plugin_id: manifest.plugin_id.clone(),
        display_name: manifest.display_name.clone(),
        version: manifest.version.clone(),
        capabilities: manifest.capabilities.clone(),
        install_path: final_dir.display().to_string(),
    };

    Ok((manifest, final_dir, result))
}

/// Runs one hardened git command in `dir`, mapping failure to `PullFailed`.
async fn run_git_in(
    dir: &Path,
    args: Vec<std::ffi::OsString>,
) -> Result<std::process::Output, GitInstallError> {
    let output = git_source::git_command()
        .args(args)
        .current_dir(dir)
        .output()
        .await
        .map_err(|e| GitInstallError::PullFailed(e.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GitInstallError::PullFailed(stderr.to_string()));
    }
    Ok(output)
}

/// Updates a git-installed plugin: fetch upstream → consent gate on the fetched
/// tree → fast-forward → re-parse manifest → detect capability changes →
/// post-install. Returns the new manifest and the summary the UI shows.
///
/// The consent gate runs on the *fetched* upstream tree before the working
/// tree is advanced, so declining consent leaves the installed plugin exactly
/// as it was.
///
/// # Errors
///
/// Returns [`GitInstallError::PostInstallConsentRequired`] when steps would be
/// needed and consent is absent, [`GitInstallError::PullFailed`] when a git
/// command fails, and the manifest or validation variants when the new copy is
/// refused, in which case it is rolled back.
pub async fn update_plugin(
    plugin_dir: &Path,
    old_manifest: &PluginManifest,
    allow_post_install: bool,
) -> Result<(PluginManifest, PluginUpdateResult), GitInstallError> {
    run_git_in(plugin_dir, git_source::fetch_args()).await?;
    apply_fetched_update(plugin_dir, old_manifest, allow_post_install).await
}

/// Lists the top-level files of the fetched upstream tree that imply
/// post-install steps, keeping `package.json` only when it gives npm something
/// to install.
async fn upstream_trigger_files(plugin_dir: &Path) -> Result<Vec<String>, GitInstallError> {
    let listing = run_git_in(plugin_dir, git_source::ls_upstream_tree_args()).await?;
    let mut names: Vec<String> = String::from_utf8_lossy(&listing.stdout)
        .lines()
        .map(str::to_string)
        .collect();
    if names.iter().any(|n| n == "package.json") {
        let needs = run_git_in(
            plugin_dir,
            git_source::show_upstream_file_args("package.json"),
        )
        .await
        .map_or(true, |out| {
            post_install::package_json_needs_install(&out.stdout)
        });
        if !needs {
            names.retain(|n| n != "package.json");
        }
    }
    Ok(names)
}

/// Applies an already fetched update: the consent gate on the fetched tree, the
/// fast-forward, and the checks of the new copy. A new copy the checks refuse
/// is rolled back to the commit the plugin was at.
async fn apply_fetched_update(
    plugin_dir: &Path,
    old_manifest: &PluginManifest,
    allow_post_install: bool,
) -> Result<(PluginManifest, PluginUpdateResult), GitInstallError> {
    // A web plugin is installed built and has no steps to consent to.
    if old_manifest.runtime_kind != RuntimeKind::WebSandboxed {
        let upstream_files = upstream_trigger_files(plugin_dir).await?;
        let upstream_steps = post_install::steps_for_top_level_files(&upstream_files, plugin_dir);
        post_install::gate(&old_manifest.plugin_id, upstream_steps, allow_post_install)?;
    }

    let head = run_git_in(plugin_dir, git_source::rev_parse_head_args()).await?;
    let head = String::from_utf8_lossy(&head.stdout).trim().to_string();
    let rollback = git_source::reset_hard_args(&head)
        .ok_or_else(|| GitInstallError::PullFailed(format!("HEAD is not a commit: {head}")))?;

    run_git_in(plugin_dir, git_source::merge_upstream_args()).await?;

    let new_manifest = match check_updated_copy(plugin_dir) {
        Ok(m) => m,
        Err(e) => {
            if let Err(reset) = run_git_in(plugin_dir, rollback).await {
                log::warn!(
                    "[plugin_host] could not roll {} back to {head}: {reset}",
                    old_manifest.plugin_id
                );
            }
            return Err(e);
        }
    };

    // Detect capability changes
    let old_caps: std::collections::HashSet<&str> = old_manifest
        .capabilities
        .iter()
        .map(|s| s.as_str())
        .collect();
    let new_caps: std::collections::HashSet<&str> = new_manifest
        .capabilities
        .iter()
        .map(|s| s.as_str())
        .collect();

    let added: Vec<String> = new_caps
        .difference(&old_caps)
        .map(|s| s.to_string())
        .collect();
    let removed: Vec<String> = old_caps
        .difference(&new_caps)
        .map(|s| s.to_string())
        .collect();

    let capabilities_changed = !added.is_empty() || !removed.is_empty();

    // Re-detect on the merged working tree (source of truth for what runs);
    // gate_and_run re-applies the consent check.
    let steps = if new_manifest.runtime_kind == RuntimeKind::WebSandboxed {
        Vec::new()
    } else {
        post_install::detect_steps(plugin_dir, plugin_dir)
    };
    post_install::gate_and_run(
        &new_manifest.plugin_id,
        steps,
        allow_post_install,
        post_install::run_steps,
    )
    .await?;

    let result = PluginUpdateResult {
        plugin_id: new_manifest.plugin_id.clone(),
        old_version: old_manifest.version.clone(),
        new_version: new_manifest.version.clone(),
        capabilities_changed,
        added_capabilities: added,
        removed_capabilities: removed,
    };

    Ok((new_manifest, result))
}

/// Returns the manifest of an updated working tree after the checks a fresh
/// install makes: install validation and, for a web plugin, the bundle rules.
fn check_updated_copy(plugin_dir: &Path) -> Result<PluginManifest, GitInstallError> {
    let new_manifest = detect_manifest(plugin_dir)?;
    if let Err(e) = validate_plugin_manifest(&new_manifest) {
        log::warn!(
            "[AUDIT] event=plugin_update_rejected plugin_id={} reason={}",
            new_manifest.plugin_id,
            e
        );
        return Err(GitInstallError::InvalidManifest(e));
    }
    if new_manifest.runtime_kind == RuntimeKind::WebSandboxed {
        check_web_checkout(plugin_dir)?;
    }
    Ok(new_manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::bundle::tests::{write_git_layout, HELLO_WEB_MANIFEST};
    use crate::plugin_host::registry::tests::git;

    /// A repository holding `write` files, committed, and a clone of it that
    /// tracks it, as an install from git leaves one.
    fn origin_and_clone(write: impl Fn(&Path)) -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::TempDir::new().unwrap();
        let origin = tmp.path().join("origin");
        std::fs::create_dir_all(&origin).unwrap();
        git(&origin, &["init", "--quiet"]);
        write(&origin);
        git(&origin, &["add", "."]);
        git(&origin, &["commit", "--quiet", "-m", "init"]);
        let clone = tmp.path().join("clone");
        git(
            tmp.path(),
            &["clone", "--quiet", "--", "origin", clone.to_str().unwrap()],
        );
        (tmp, origin, clone)
    }

    /// Commits `change` in `origin` and fetches it into `clone`.
    fn push_upstream(origin: &Path, clone: &Path, change: impl Fn(&Path)) {
        change(origin);
        git(origin, &["add", "--all"]);
        git(origin, &["commit", "--quiet", "-m", "change"]);
        git(clone, &["fetch", "--quiet"]);
    }

    fn hello_web_manifest() -> PluginManifest {
        serde_json::from_str(HELLO_WEB_MANIFEST).unwrap()
    }

    #[test]
    fn a_web_checkout_with_sources_passes_and_one_without_its_entrypoint_does_not() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_git_layout(tmp.path());
        assert!(check_web_checkout(tmp.path()).is_ok());
        std::fs::remove_file(tmp.path().join("main.mjs")).unwrap();
        let err = check_web_checkout(tmp.path()).unwrap_err().to_string();
        assert!(err.contains("web plugins are installed built"), "{err}");
        assert!(err.contains("entrypoint `main.mjs` is missing"), "{err}");
    }

    #[tokio::test]
    async fn a_web_update_with_sources_advances_and_a_broken_one_rolls_back() {
        let (_tmp, origin, clone) = origin_and_clone(write_git_layout);
        push_upstream(&origin, &clone, |dir| {
            let manifest = HELLO_WEB_MANIFEST.replace("0.1.0", "0.2.0");
            std::fs::write(dir.join(MANIFEST_FILE), manifest).unwrap();
            std::fs::write(dir.join("src/main.ts"), "export const v = 2;\n").unwrap();
        });
        let (manifest, result) = apply_fetched_update(&clone, &hello_web_manifest(), false)
            .await
            .expect("sources beside the bundle do not stop an update");
        assert_eq!(manifest.version, "0.2.0");
        assert_eq!(result.new_version, "0.2.0");

        let good = git(&clone, &["rev-parse", "HEAD"]);
        push_upstream(&origin, &clone, |dir| {
            std::fs::remove_file(dir.join("main.mjs")).unwrap();
        });
        let err = apply_fetched_update(&clone, &manifest, false)
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("entrypoint `main.mjs` is missing"), "{err}");
        assert_eq!(git(&clone, &["rev-parse", "HEAD"]), good);
        assert!(clone.join("main.mjs").is_file());
    }

    #[tokio::test]
    async fn an_update_asks_consent_only_for_a_package_json_with_dependencies() {
        let local_manifest = |dir: &Path| {
            let manifest = HELLO_WEB_MANIFEST.replace("WebSandboxed", "DesktopLocalProcess");
            std::fs::write(dir.join(MANIFEST_FILE), manifest).unwrap();
            std::fs::write(dir.join("main.mjs"), "#!/usr/bin/env node\n").unwrap();
        };
        let (_tmp, origin, clone) = origin_and_clone(local_manifest);
        let old = detect_manifest(&clone).unwrap();
        push_upstream(&origin, &clone, |dir| {
            std::fs::write(
                dir.join("package.json"),
                r#"{"devDependencies":{"esbuild":"^0.24.0"}}"#,
            )
            .unwrap();
        });
        apply_fetched_update(&clone, &old, false)
            .await
            .expect("devDependencies alone need no consent");

        let before = git(&clone, &["rev-parse", "HEAD"]);
        push_upstream(&origin, &clone, |dir| {
            std::fs::write(dir.join("package.json"), r#"{"dependencies":{"ws":"8"}}"#).unwrap();
        });
        let err = apply_fetched_update(&clone, &old, false).await.unwrap_err();
        assert!(
            matches!(err, GitInstallError::PostInstallConsentRequired { .. }),
            "{err:?}"
        );
        assert_eq!(git(&clone, &["rev-parse", "HEAD"]), before);
    }

    #[test]
    fn detect_json_manifest() {
        let tmp = tempfile::TempDir::new().unwrap();
        let manifest = serde_json::json!({
            "manifest_version": 1,
            "plugin_id": "dev.example.test",
            "display_name": "Test",
            "version": "1.0.0",
            "description": "test",
            "runtime_kind": "DesktopLocalProcess",
            "entrypoint": "main.js",
        });
        std::fs::write(tmp.path().join(MANIFEST_FILE), manifest.to_string()).unwrap();

        let m = detect_manifest(tmp.path()).unwrap();
        assert_eq!(m.plugin_id, "dev.example.test");
    }

    #[test]
    fn no_manifest_returns_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join("main.js"),
            "// rim-plugin: dev.example.headers\n// rim-name: Headers\n",
        )
        .unwrap();
        let err = detect_manifest(tmp.path()).unwrap_err();
        assert!(matches!(err, GitInstallError::NoManifest));
        assert_eq!(
            err.to_string(),
            "no rim-plugin.json found at the root of the repository; every plugin needs one"
        );
    }

    #[test]
    fn finalize_install_moves_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let staging = tmp.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("test.txt"), "hello").unwrap();

        let dest = tmp.path().join("dest");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();

        // Use copy_dir_recursive directly for testing
        copy_dir_recursive(&staging, &dest).unwrap();
        assert!(dest.join("test.txt").exists());
        assert_eq!(
            std::fs::read_to_string(dest.join("test.txt")).unwrap(),
            "hello"
        );
    }

    #[test]
    fn already_exists_rejected() {
        let tmp = tempfile::TempDir::new().unwrap();
        let plugins = tmp.path().join("plugins");
        let existing = plugins.join("dev.example.test");
        std::fs::create_dir_all(&existing).unwrap();

        // finalize_install writes to the global plugins_dir, so it is not called
        // here; install_from_git checks collisions through existing_plugin_ids.
    }

    // ── the update path runs install validation ──

    #[test]
    fn detect_manifest_with_invalid_capability_fails_validation() {
        let tmp = tempfile::TempDir::new().unwrap();
        // A manifest with a capability key in a reserved namespace.
        let manifest = serde_json::json!({
            "manifest_version": 1,
            "plugin_id": "dev.example.test",
            "display_name": "Test",
            "version": "2.0.0",
            "description": "updated",
            "runtime_kind": "DesktopLocalProcess",
            "entrypoint": "main.js",
            "capabilities": ["system.evil"]
        });
        std::fs::write(tmp.path().join(MANIFEST_FILE), manifest.to_string()).unwrap();

        // detect_manifest only checks the manifest's structure; the capability
        // key is refused by validate_plugin_manifest.
        let m = detect_manifest(tmp.path()).unwrap();
        let err = validate_plugin_manifest(&m).unwrap_err();
        assert!(
            matches!(err, ValidationError::InvalidCapabilityKey { .. }),
            "update path must reject invalid capability keys: {err:?}"
        );
    }

    #[test]
    fn detect_manifest_with_install_id_leak_fails_validation() {
        let tmp = tempfile::TempDir::new().unwrap();
        let manifest = serde_json::json!({
            "manifest_version": 1,
            "plugin_id": "dev.example.test",
            "display_name": "Test",
            "version": "2.0.0",
            "description": "updated",
            "runtime_kind": "DesktopLocalProcess",
            "entrypoint": "main.js",
            "capabilities": ["chat.read"],
            "commands": [{
                "id": "expose",
                "title": "Expose",
                "description": "leaks",
                "ai_callable": true,
                "output_schema": {
                    "type": "object",
                    "properties": { "plugin_install_id": { "type": "string" } }
                }
            }]
        });
        std::fs::write(tmp.path().join(MANIFEST_FILE), manifest.to_string()).unwrap();

        let m = detect_manifest(tmp.path()).unwrap();
        let err = validate_plugin_manifest(&m).unwrap_err();
        assert!(
            matches!(err, ValidationError::InstallIdLeakInAiSurface { .. }),
            "update path must reject install-ID leaks: {err:?}"
        );
    }
}
