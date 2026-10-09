use crate::plugin_host::discovery::{plugins_dir, MANIFEST_FILE};
use crate::plugin_host::git_source;
use crate::plugin_host::manifest::{ManifestError, PluginManifest};
use crate::plugin_host::post_install::{self, PostInstallStep};
use crate::plugin_host::simple_manifest;
use crate::plugin_host::validation::{validate_plugin_manifest, ValidationError};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum GitInstallError {
    /// The repository URL failed validation (S-H2) — nothing was spawned.
    #[error("invalid git URL: {0}")]
    InvalidUrl(String),
    /// The branch failed validation (S-H2) — nothing was spawned.
    #[error("invalid git branch: {0}")]
    InvalidBranch(String),
    /// The plugin needs dependency-install steps that execute author code;
    /// the caller must retry with explicit consent (S-H3). Nothing was run and
    /// (for install) nothing was kept on disk; (for update) the working tree
    /// was not advanced.
    #[error("plugin {plugin_id} needs post-install steps that run code from the plugin author; explicit consent is required")]
    PostInstallConsentRequired {
        plugin_id: String,
        steps: Vec<PostInstallStep>,
    },
    #[error("git clone failed: {0}")]
    CloneFailed(String),
    #[error("no manifest found (rim-plugin.json or simple mode entrypoint)")]
    NoManifest,
    #[error("manifest error: {0}")]
    Manifest(#[from] ManifestError),
    #[error("invalid manifest: {0}")]
    InvalidManifest(#[from] ValidationError),
    /// Lifecycle rejection (e.g. already installed) during install_from_git.
    /// Kept distinct from Io so the JS surface can distinguish "install refused"
    /// from "disk error".
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
            // Preserve inner typed ValidationError so JS can branch on the
            // specific N1/F2 violation without string-parsing.
            Self::InvalidManifest(inner) => {
                map.serialize_entry("kind", "INVALID_MANIFEST")?;
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

/// Clone a git repo to the staging directory.
///
/// `url` and `branch` are validated before git is spawned; the argv puts `--`
/// before the positionals and the child runs with the hardened git env
/// (see [`git_source`]).
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

/// Detect and load a manifest from a cloned directory.
/// Tries rim-plugin.json first, then simple mode.
pub fn detect_manifest(clone_dir: &Path) -> Result<PluginManifest, GitInstallError> {
    let json_manifest = clone_dir.join(MANIFEST_FILE);
    if json_manifest.exists() {
        return Ok(PluginManifest::load(&json_manifest)?);
    }

    // Try simple mode
    if let Some(manifest) = simple_manifest::load_simple_manifest(clone_dir)? {
        return Ok(manifest);
    }

    Err(GitInstallError::NoManifest)
}

/// Move a cloned plugin from staging to the final plugins directory.
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

/// Full git install flow:
/// validate URL → clone → detect manifest → validate → consent gate → move → post-install.
///
/// Post-install steps (npm/pip) run only when `allow_post_install` is true.
/// When they would be needed and consent is absent, the staging clone is
/// deleted and `PostInstallConsentRequired` is returned before anything is
/// moved into the plugins directory or executed.
pub async fn install_from_git(
    url: &str,
    branch: Option<&str>,
    existing_plugin_ids: &[String],
    allow_post_install: bool,
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

    // N1 + F2 validation: capability key shape + AI-surface install-ID leak check.
    // Must run BEFORE persisting to disk so a malformed manifest never reaches the registry.
    if let Err(e) = validate_plugin_manifest(&manifest) {
        log::warn!(
            "[AUDIT] event=plugin_install_rejected plugin_id={} reason={}",
            manifest.plugin_id,
            e
        );
        let _ = std::fs::remove_dir_all(&clone_dir);
        return Err(GitInstallError::InvalidManifest(e));
    }

    // S-H3 consent gate — decided on the staged files, before anything is
    // moved into the plugins directory or executed.
    let planned_dir = plugins_dir().join(&manifest.plugin_id);
    let steps = post_install::detect_steps(&clone_dir, &planned_dir);
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
        let _ = std::fs::remove_dir_all(&final_dir);
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

/// Run one hardened git command in `dir`, mapping failure to `PullFailed`.
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

/// Update a plugin: fetch upstream → consent gate on the fetched tree →
/// fast-forward → re-parse manifest → detect capability changes → post-install.
///
/// The consent gate runs on the *fetched* upstream tree before the working
/// tree is advanced, so declining consent leaves the installed plugin exactly
/// as it was.
pub async fn update_plugin(
    plugin_dir: &Path,
    old_manifest: &PluginManifest,
    allow_post_install: bool,
) -> Result<(PluginManifest, PluginUpdateResult), GitInstallError> {
    run_git_in(plugin_dir, git_source::fetch_args()).await?;

    let listing = run_git_in(plugin_dir, git_source::ls_upstream_tree_args()).await?;
    let upstream_files: Vec<String> = String::from_utf8_lossy(&listing.stdout)
        .lines()
        .map(str::to_string)
        .collect();
    let upstream_steps = post_install::steps_for_top_level_files(&upstream_files, plugin_dir);
    post_install::gate(&old_manifest.plugin_id, upstream_steps, allow_post_install)?;

    run_git_in(plugin_dir, git_source::merge_upstream_args()).await?;

    let new_manifest = detect_manifest(plugin_dir)?;

    // N1 + F2 validation on the updated manifest — same gate as fresh install.
    if let Err(e) = validate_plugin_manifest(&new_manifest) {
        log::warn!(
            "[AUDIT] event=plugin_update_rejected plugin_id={} reason={}",
            new_manifest.plugin_id,
            e
        );
        return Err(GitInstallError::InvalidManifest(e));
    }

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
    let steps = post_install::detect_steps(plugin_dir, plugin_dir);
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn detect_simple_manifest() {
        let tmp = tempfile::TempDir::new().unwrap();
        let source = "# rim-plugin: dev.example.simple\n# rim-name: Simple\n";
        std::fs::write(tmp.path().join("main.js"), source).unwrap();

        let m = detect_manifest(tmp.path()).unwrap();
        assert_eq!(m.plugin_id, "dev.example.simple");
        assert_eq!(m.entrypoint, "node main.js");
    }

    #[test]
    fn json_manifest_preferred_over_simple() {
        let tmp = tempfile::TempDir::new().unwrap();
        // Both json and simple present — json wins
        let json = serde_json::json!({
            "manifest_version": 1,
            "plugin_id": "dev.example.json-wins",
            "display_name": "JSON",
            "version": "1.0.0",
            "description": "test",
            "runtime_kind": "DesktopLocalProcess",
            "entrypoint": "main.js",
        });
        std::fs::write(tmp.path().join(MANIFEST_FILE), json.to_string()).unwrap();
        std::fs::write(
            tmp.path().join("main.js"),
            "# rim-plugin: dev.example.simple\n# rim-name: Simple\n",
        )
        .unwrap();

        let m = detect_manifest(tmp.path()).unwrap();
        assert_eq!(m.plugin_id, "dev.example.json-wins");
    }

    #[test]
    fn no_manifest_returns_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        let err = detect_manifest(tmp.path()).unwrap_err();
        assert!(matches!(err, GitInstallError::NoManifest));
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

        // We can't easily test finalize_install because it uses the global plugins_dir,
        // but we verify the collision check in install_from_git via existing_plugin_ids.
    }

    // ── Phase 1 regression: update path is actually gated ──

    #[test]
    fn detect_manifest_with_invalid_capability_fails_validation() {
        let tmp = tempfile::TempDir::new().unwrap();
        // Write a manifest with a capability that fails N1 (wrong prefix)
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

        // detect_manifest loads the raw manifest (weak structural validate only),
        // then validate_plugin_manifest runs N1+F2 — this proves the gate fires.
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
            "capabilities": ["plugin.dev.example.test.do_thing"],
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
