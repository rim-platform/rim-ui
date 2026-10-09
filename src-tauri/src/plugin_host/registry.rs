//! The desktop's half of workspace plugin registries: the source a publisher signs (a git
//! checkout's commit and tree hash, or a bundle), writing a signature file for a moderator, and
//! installing a registry entry's git source at its pinned commit.
//!
//! **`treeSha256`** is SHA-256 over every file of a commit's tree, sorted by path in byte
//! order: the path's bytes, a zero byte, the file's bytes, a zero byte. That is the layout of
//! [`compute_bundle_fingerprint`](crate::plugin_host::local_install::compute_bundle_fingerprint)
//! over committed files only. A tree with a symbolic link or a submodule has no tree hash.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncWriteExt;

use crate::key_identity::plugin_manifest::PluginSource;
use crate::plugin_host::bundle::{self, BundleError, MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES};
use crate::plugin_host::discovery::{plugins_dir, MANIFEST_FILE};
use crate::plugin_host::git_install::{GitInstallError, PluginInstallResult};
use crate::plugin_host::git_source;
use crate::plugin_host::lifecycle;
use crate::plugin_host::manifest::{PluginManifest, RuntimeKind};
use crate::plugin_host::post_install;
use crate::plugin_host::runtime;
use crate::plugin_host::state::{InstallSource, PluginRecord, PluginStatus};
use crate::plugin_host::validation::validate_plugin_manifest_for_host;
use crate::plugin_host::PluginHostState;

/// Why a registry action on this computer failed.
#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("{0}")]
    Invalid(String),
    #[error("git: {0}")]
    Git(String),
    #[error("{0}")]
    Bundle(#[from] BundleError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for RegistryError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(Some(2))?;
        map.serialize_entry("kind", "REGISTRY_ERROR")?;
        map.serialize_entry("message", &self.to_string())?;
        map.end()
    }
}

fn invalid(message: impl Into<String>) -> RegistryError {
    RegistryError::Invalid(message.into())
}

fn locked(e: impl std::fmt::Display) -> RegistryError {
    RegistryError::Io(std::io::Error::other(e.to_string()))
}

fn is_lower_hex(s: &str, lengths: &[usize]) -> bool {
    lengths.contains(&s.len()) && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

// ─── git ─────────────────────────────────────────────────────────────────────

async fn git_in(dir: &Path, args: &[&str]) -> Result<Vec<u8>, RegistryError> {
    let output = git_source::git_command()
        .args(args)
        .current_dir(dir)
        .output()
        .await
        .map_err(|e| RegistryError::Git(e.to_string()))?;
    if !output.status.success() {
        return Err(RegistryError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(output.stdout)
}

async fn git_text(dir: &Path, args: &[&str]) -> Result<String, RegistryError> {
    let out = git_in(dir, args).await?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}

/// The bytes of every object named in `ids`, read with one `git cat-file --batch`.
async fn read_blobs(dir: &Path, ids: &[String]) -> Result<Vec<Vec<u8>>, RegistryError> {
    let mut child = git_source::git_command()
        .args(["cat-file", "--batch"])
        .current_dir(dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| RegistryError::Git(e.to_string()))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| RegistryError::Git("cat-file has no input".into()))?;
    let request: String = ids.iter().map(|id| format!("{id}\n")).collect();
    let writer = tokio::spawn(async move {
        let written = stdin.write_all(request.as_bytes()).await;
        drop(stdin);
        written
    });
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| RegistryError::Git(e.to_string()))?;
    writer
        .await
        .map_err(|e| RegistryError::Git(e.to_string()))?
        .map_err(|e| RegistryError::Git(e.to_string()))?;
    if !output.status.success() {
        return Err(RegistryError::Git(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    let mut out = output.stdout.as_slice();
    let mut blobs = Vec::with_capacity(ids.len());
    for id in ids {
        let header_end = out
            .iter()
            .position(|&b| b == b'\n')
            .ok_or_else(|| RegistryError::Git(format!("cat-file ended before {id}")))?;
        let header = String::from_utf8_lossy(&out[..header_end]).to_string();
        let mut fields = header.split(' ');
        let (Some(_), Some("blob"), Some(size)) = (fields.next(), fields.next(), fields.next())
        else {
            return Err(RegistryError::Git(format!("{id} is not a file: {header}")));
        };
        let size: usize = size
            .parse()
            .map_err(|_| RegistryError::Git(format!("bad size for {id}")))?;
        let start = header_end + 1;
        if out.len() < start + size + 1 {
            return Err(RegistryError::Git(format!("cat-file cut {id} short")));
        }
        blobs.push(out[start..start + size].to_vec());
        out = &out[start + size + 1..];
    }
    Ok(blobs)
}

/// `treeSha256` of `commit` in the repository at `dir`.
pub async fn tree_sha256(dir: &Path, commit: &str) -> Result<String, RegistryError> {
    if !is_lower_hex(commit, &[40, 64]) {
        return Err(invalid("a commit is 40 or 64 lowercase hex characters"));
    }
    let listing = git_in(dir, &["ls-tree", "-r", "-z", "--full-tree", commit]).await?;
    let mut entries: Vec<(Vec<u8>, String)> = Vec::new();
    for record in listing.split(|&b| b == 0).filter(|r| !r.is_empty()) {
        let tab = record
            .iter()
            .position(|&b| b == b'\t')
            .ok_or_else(|| RegistryError::Git("unreadable tree listing".into()))?;
        let meta = String::from_utf8_lossy(&record[..tab]).to_string();
        let path = record[tab + 1..].to_vec();
        let mut fields = meta.split(' ');
        let (Some(mode), Some(kind), Some(id)) = (fields.next(), fields.next(), fields.next())
        else {
            return Err(RegistryError::Git("unreadable tree listing".into()));
        };
        let shown = String::from_utf8_lossy(&path).to_string();
        if kind == "commit" {
            return Err(invalid(format!(
                "`{shown}` is a submodule: a tree with submodules cannot be signed"
            )));
        }
        if mode == "120000" {
            return Err(invalid(format!(
                "`{shown}` is a symbolic link: a tree with symbolic links cannot be signed"
            )));
        }
        entries.push((path, id.to_string()));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let ids: Vec<String> = entries.iter().map(|(_, id)| id.clone()).collect();
    let blobs = read_blobs(dir, &ids).await?;
    let mut hasher = Sha256::new();
    for ((path, _), bytes) in entries.iter().zip(blobs) {
        hasher.update(path);
        hasher.update(b"\0");
        hasher.update(&bytes);
        hasher.update(b"\0");
    }
    Ok(hex::encode(hasher.finalize()))
}

/// The exact text of `rim-plugin.json` at `commit`.
async fn committed_manifest(dir: &Path, commit: &str) -> Result<String, RegistryError> {
    let spec = format!("{commit}:{MANIFEST_FILE}");
    let bytes = git_in(dir, &["cat-file", "blob", &spec])
        .await
        .map_err(|_| invalid(format!("the commit has no {MANIFEST_FILE}")))?;
    String::from_utf8(bytes).map_err(|_| invalid(format!("{MANIFEST_FILE} is not UTF-8")))
}

/// A signed git source names an `https://` or `ssh://` URL the git install accepts.
fn signable_git_url(url: &str) -> Result<(), RegistryError> {
    git_source::validate_git_url(url).map_err(invalid)?;
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("https://") && !lower.starts_with("ssh://") {
        return Err(invalid(
            "the checkout's remote must be an https:// or ssh:// URL to be signed",
        ));
    }
    Ok(())
}

// ─── What a publisher signs ──────────────────────────────────────────────────

/// A plugin's code as a statement names it, with what the signing dialog shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigningSource {
    pub plugin_id: String,
    pub version: String,
    pub display_name: String,
    pub runtime_kind: RuntimeKind,
    /// The exact text of `rim-plugin.json`.
    pub manifest: String,
    pub source: PluginSource,
    /// The bundle file in standard base64, for a `bundle` source.
    pub bundle: Option<String>,
    /// Where a picked bundle file is, so a signature file goes beside it.
    pub bundle_path: Option<String>,
}

fn bundle_source(
    bytes: Vec<u8>,
    read: bundle::Bundle,
    path: Option<String>,
) -> Result<SigningSource, RegistryError> {
    if bytes.len() > MAX_BUNDLE_BYTES {
        return Err(BundleError::TooLarge(bytes.len()).into());
    }
    Ok(SigningSource {
        plugin_id: read.manifest.plugin_id.clone(),
        version: read.manifest.version.clone(),
        display_name: read.manifest.display_name.clone(),
        runtime_kind: read.manifest.runtime_kind,
        manifest: read.manifest_text,
        source: PluginSource::Bundle {
            sha256: bundle::bundle_sha256(&bytes),
            size: bytes.len() as u64,
        },
        bundle: Some(STANDARD.encode(&bytes)),
        bundle_path: path,
    })
}

/// A bundle of the plugin folder `dir`, as the SDK bundler writes it.
pub fn bundle_of_dir(dir: &Path) -> Result<SigningSource, RegistryError> {
    let hint = |e: BundleError| {
        invalid(format!(
            "{e}. Build it with rim-plugin-bundle (at most {MAX_BUNDLE_FILES} files and 8 MiB) and pick the .rimbundle instead"
        ))
    };
    let read = bundle::check_files(bundle::collect_dir(dir)?).map_err(hint)?;
    let bytes = bundle::write_bundle(&read.files);
    if bytes.len() > MAX_BUNDLE_BYTES {
        return Err(hint(BundleError::TooLarge(bytes.len())));
    }
    bundle_source(bytes, read, None)
}

/// The git source of the checkout at `dir`: its `origin` URL, `HEAD` and tree hash.
pub async fn git_source_of(dir: &Path) -> Result<SigningSource, RegistryError> {
    let url = git_text(dir, &["remote", "get-url", "origin"]).await?;
    signable_git_url(&url)?;
    let commit = git_text(dir, &["rev-parse", "HEAD"]).await?;
    let tree = tree_sha256(dir, &commit).await?;
    let manifest_text = committed_manifest(dir, &commit).await?;
    let manifest: PluginManifest = serde_json::from_str(&manifest_text)
        .map_err(|e| invalid(format!("{MANIFEST_FILE}: {e}")))?;
    Ok(SigningSource {
        plugin_id: manifest.plugin_id,
        version: manifest.version,
        display_name: manifest.display_name,
        runtime_kind: manifest.runtime_kind,
        manifest: manifest_text,
        source: PluginSource::Git {
            url,
            commit,
            tree_sha256: tree,
        },
        bundle: None,
        bundle_path: None,
    })
}

/// The source to sign for an installed plugin: its git checkout for a local-process plugin
/// installed from git, otherwise a bundle built from its folder.
#[tauri::command]
pub async fn plugin_signing_source(
    plugin_id: String,
    state: State<'_, PluginHostState>,
) -> Result<SigningSource, RegistryError> {
    let dir = state
        .plugin_dirs
        .lock()
        .map_err(locked)?
        .get(&plugin_id)
        .cloned()
        .ok_or_else(|| invalid(format!("plugin not found: {plugin_id}")))?;
    let from_git = matches!(
        state
            .store
            .lock()
            .map_err(locked)?
            .get(&plugin_id)
            .and_then(|r| r.source.clone()),
        Some(InstallSource::Git { .. })
    );
    let kind = state
        .manifests
        .lock()
        .map_err(locked)?
        .get(&plugin_id)
        .map(|m| m.runtime_kind);
    if from_git && kind == Some(RuntimeKind::DesktopLocalProcess) && dir.join(".git").exists() {
        return git_source_of(&dir).await;
    }
    tauri::async_runtime::spawn_blocking(move || bundle_of_dir(&dir))
        .await
        .map_err(locked)?
}

/// Ask for a `.rimbundle` to sign; `None` when the person cancels.
#[tauri::command]
pub async fn plugin_pick_signing_bundle(
    app: AppHandle,
) -> Result<Option<SigningSource>, RegistryError> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Choose a plugin bundle")
            .add_filter("Plugin bundle", &["rimbundle"])
            .blocking_pick_file();
        let Some(picked) = picked else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|e| invalid(format!("not a local file: {e}")))?;
        let bytes = std::fs::read(&path)?;
        let read = bundle::read_bundle(&bytes)?;
        bundle_source(bytes, read, Some(path.display().to_string())).map(Some)
    })
    .await
    .map_err(locked)?
}

/// Write `<stem>.rimsig.json`, and `<stem>.rimbundle` when `bundle` is given, into a folder
/// the person picks (by default the one holding `beside`). Returns the signature file's path,
/// or `None` when the person cancels.
#[tauri::command]
pub async fn plugin_export_signature(
    stem: String,
    signature: String,
    bundle: Option<String>,
    beside: Option<String>,
    app: AppHandle,
) -> Result<Option<String>, RegistryError> {
    if stem.is_empty()
        || stem.starts_with('.')
        || !stem
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return Err(invalid("not a file name for a signature"));
    }
    serde_json::from_str::<serde_json::Value>(&signature)
        .map_err(|e| invalid(format!("not a signature file: {e}")))?;
    let bundle_bytes = bundle
        .map(|b| STANDARD.decode(b.as_bytes()))
        .transpose()
        .map_err(|e| invalid(format!("bundle is not base64: {e}")))?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_title("Choose where to save the signature");
        if let Some(parent) = beside.as_deref().map(Path::new).and_then(Path::parent) {
            dialog = dialog.set_directory(parent);
        }
        let Some(folder) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let folder: PathBuf = folder
            .into_path()
            .map_err(|e| invalid(format!("not a local folder: {e}")))?;
        if let Some(bytes) = bundle_bytes {
            std::fs::write(folder.join(format!("{stem}.rimbundle")), bytes)?;
        }
        let path = folder.join(format!("{stem}.rimsig.json"));
        std::fs::write(&path, signature)?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(locked)?
}

// ─── Installing a git source at its commit ──────────────────────────────────

/// Fetch `commit` of `url` into a new directory, checked out detached, with `origin` set.
async fn checkout_commit(url: &str, commit: &str) -> Result<PathBuf, RegistryError> {
    git_source::validate_git_url(url).map_err(invalid)?;
    let dir = dirs::home_dir()
        .ok_or_else(|| invalid("no home directory"))?
        .join(".rim")
        .join("staging")
        .join(format!("registry-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir)?;
    let fetched = async {
        git_in(&dir, &["init", "--quiet"]).await?;
        git_in(&dir, &["remote", "add", "origin", url]).await?;
        // A single commit when the host serves one by id, else the whole history.
        if git_in(
            &dir,
            &["fetch", "--quiet", "--depth", "1", "origin", commit],
        )
        .await
        .is_err()
        {
            git_in(&dir, &["fetch", "--quiet", "origin"]).await?;
        }
        git_in(&dir, &["checkout", "--quiet", "--detach", commit, "--"]).await?;
        let head = git_text(&dir, &["rev-parse", "HEAD"]).await?;
        if head != commit {
            return Err(invalid(format!("the checkout is at {head}, not {commit}")));
        }
        Ok(())
    }
    .await;
    if let Err(e) = fetched {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }
    Ok(dir)
}

/// What a registry install of a git source checks before anything runs: the tree hash, and
/// the committed manifest byte for byte against the statement's.
async fn check_checkout(
    dir: &Path,
    commit: &str,
    tree: &str,
    manifest: &str,
) -> Result<(), RegistryError> {
    let actual = tree_sha256(dir, commit).await?;
    if actual != tree {
        return Err(invalid(format!(
            "the commit's tree hashes to {actual}, not the signed {tree}"
        )));
    }
    if committed_manifest(dir, commit).await? != manifest {
        return Err(invalid(format!(
            "the commit's {MANIFEST_FILE} is not the signed manifest"
        )));
    }
    Ok(())
}

/// Approvals that carry over to a replacing copy: those it still asks for, and its state.
fn carried(old: &PluginRecord, manifest: &PluginManifest) -> (Vec<String>, Vec<String>, bool) {
    let capabilities = old
        .approved_capabilities
        .iter()
        .filter(|c| manifest.capabilities.contains(c))
        .cloned()
        .collect();
    let ai_ids = manifest.ai_callable_command_ids();
    let ai = old
        .approved_ai_commands
        .iter()
        .filter(|c| ai_ids.contains(c))
        .cloned()
        .collect();
    (capabilities, ai, old.status == PluginStatus::Enabled)
}

/// Record a fresh install of `manifest` from `source`, keeping `previous`'s approvals when
/// given, and start it again if it was running.
pub(crate) fn record_install(
    state: &PluginHostState,
    manifest: &PluginManifest,
    dir: PathBuf,
    source: InstallSource,
    fingerprint: String,
    previous: Option<&PluginRecord>,
) -> Result<(), RegistryError> {
    state
        .manifests
        .lock()
        .map_err(locked)?
        .insert(manifest.plugin_id.clone(), manifest.clone());
    state
        .plugin_dirs
        .lock()
        .map_err(locked)?
        .insert(manifest.plugin_id.clone(), dir);
    let restart = {
        let mut store = state.store.lock().map_err(locked)?;
        store.remove(&manifest.plugin_id);
        lifecycle::install(&mut store, manifest).map_err(|e| invalid(e.to_string()))?;
        let record = store
            .get(&manifest.plugin_id)
            .cloned()
            .ok_or_else(|| invalid("install was not recorded"))?;
        let (capabilities, ai, enabled) = previous
            .map(|old| carried(old, manifest))
            .unwrap_or_default();
        store.upsert(PluginRecord {
            approved_capabilities: capabilities,
            approved_ai_commands: ai,
            status: if enabled {
                PluginStatus::Enabled
            } else {
                record.status
            },
            bundle_fingerprint: fingerprint,
            fingerprint_changed: false,
            source: Some(source),
            ..record
        });
        store.save(&state.state_path)?;
        enabled
    };
    if restart {
        if let Err(e) = runtime::start_plugin(&manifest.plugin_id, manifest, state) {
            log::warn!(
                "[plugin_host] could not start {} after its update: {e}",
                manifest.plugin_id
            );
        }
    }
    Ok(())
}

/// Install a registry entry's git source: fetch `commit`, check its tree hash and manifest
/// against the statement, validate the manifest for this host, then the post-install consent
/// gate as for any git install. With `replace`, the installed copy is swapped out only once
/// the new one is ready, and put back if its post-install steps fail; `keep_approvals` carries
/// its approvals and running state over.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn plugin_install_registry_git(
    url: String,
    commit: String,
    tree_sha256: String,
    manifest: String,
    source: InstallSource,
    allow_post_install: Option<bool>,
    replace: Option<bool>,
    keep_approvals: Option<bool>,
    forbidden_origins: Option<Vec<String>>,
    state: State<'_, PluginHostState>,
) -> Result<PluginInstallResult, GitInstallError> {
    let fail = |e: RegistryError| {
        GitInstallError::Manifest(crate::plugin_host::manifest::ManifestError::Validation(
            e.to_string(),
        ))
    };
    if !matches!(source, InstallSource::Registry { .. }) {
        return Err(fail(invalid(
            "a registry git install needs a registry source",
        )));
    }
    if !is_lower_hex(&commit, &[40, 64]) || !is_lower_hex(&tree_sha256, &[64]) {
        return Err(fail(invalid(
            "a signed commit and tree hash are lowercase hex",
        )));
    }
    let staged = checkout_commit(&url, &commit).await.map_err(fail)?;
    let cleanup = |e: GitInstallError| {
        let _ = std::fs::remove_dir_all(&staged);
        e
    };
    check_checkout(&staged, &commit, &tree_sha256, &manifest)
        .await
        .map_err(|e| cleanup(fail(e)))?;
    let parsed: PluginManifest = serde_json::from_str(&manifest)
        .map_err(|e| cleanup(fail(invalid(format!("{MANIFEST_FILE}: {e}")))))?;
    if parsed.runtime_kind != RuntimeKind::DesktopLocalProcess {
        return Err(cleanup(fail(invalid(
            "only a plugin that runs on this computer comes from git",
        ))));
    }
    if parsed.has_reserved_prefix() {
        return Err(cleanup(fail(invalid(format!(
            "reserved plugin_id prefix: {}",
            parsed.plugin_id
        )))));
    }
    validate_plugin_manifest_for_host(&parsed, &forbidden_origins.unwrap_or_default())
        .map_err(|e| cleanup(GitInstallError::InvalidManifest(e)))?;

    let plugin_id = parsed.plugin_id.clone();
    let previous = state
        .store
        .lock()
        .map_err(|e| cleanup(GitInstallError::Io(std::io::Error::other(e.to_string()))))?
        .get(&plugin_id)
        .cloned();
    if previous.is_some() && replace != Some(true) {
        return Err(cleanup(GitInstallError::AlreadyExists(plugin_id)));
    }

    let final_dir = plugins_dir().join(&plugin_id);
    let allow = allow_post_install.unwrap_or(false);
    let steps = post_install::gate(
        &plugin_id,
        post_install::detect_steps(&staged, &final_dir),
        allow,
    )
    .map_err(cleanup)?;

    // Swap the copies only now; the old one waits aside until the new one is ready.
    if previous.is_some() {
        runtime::stop_plugin(&plugin_id, &state)
            .await
            .map_err(|e| cleanup(GitInstallError::Io(std::io::Error::other(e.to_string()))))?;
    }
    let aside = plugins_dir().join(format!(".replaced-{}", uuid::Uuid::new_v4()));
    let had_dir = final_dir.exists();
    if had_dir {
        std::fs::rename(&final_dir, &aside).map_err(|e| cleanup(e.into()))?;
    }
    let restore = |e: GitInstallError| {
        let _ = std::fs::remove_dir_all(&final_dir);
        if had_dir {
            let _ = std::fs::rename(&aside, &final_dir);
        }
        e
    };
    std::fs::create_dir_all(plugins_dir()).map_err(|e| restore(cleanup(e.into())))?;
    std::fs::rename(&staged, &final_dir).map_err(|e| restore(cleanup(e.into())))?;
    post_install::gate_and_run(&plugin_id, steps, allow, post_install::run_steps)
        .await
        .map_err(restore)?;
    if had_dir {
        let _ = std::fs::remove_dir_all(&aside);
    }

    let previous = previous.filter(|_| keep_approvals == Some(true));
    record_install(
        &state,
        &parsed,
        final_dir.clone(),
        source,
        String::new(),
        previous.as_ref(),
    )
    .map_err(fail)?;
    log::warn!("[AUDIT] event=plugin_registry_git_installed plugin_id={plugin_id} commit={commit}");
    Ok(PluginInstallResult {
        plugin_id,
        display_name: parsed.display_name.clone(),
        version: parsed.version.clone(),
        capabilities: parsed.capabilities.clone(),
        install_path: final_dir.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@example.com"])
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git runs");
        assert!(out.status.success(), "git {args:?}: {out:?}");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    const MANIFEST: &str = r#"{"manifest_version":1,"plugin_id":"dev.example.pods","display_name":"Pods","version":"0.3.0","description":"Lists pods.","runtime_kind":"DesktopLocalProcess","entrypoint":"main.mjs"}"#;

    /// A repository with two committed files, one in a folder, an ignored file and an
    /// untracked one.
    fn fixture() -> (tempfile::TempDir, String) {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "--quiet"]);
        std::fs::write(dir.join(MANIFEST_FILE), MANIFEST).unwrap();
        std::fs::create_dir_all(dir.join("lib")).unwrap();
        std::fs::write(dir.join("lib/a.mjs"), "export {}\n").unwrap();
        std::fs::write(dir.join(".gitignore"), "node_modules/\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "--quiet", "-m", "init"]);
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join("node_modules/x/index.js"), "x").unwrap();
        std::fs::write(dir.join("untracked.txt"), "y").unwrap();
        let commit = git(dir, &["rev-parse", "HEAD"]);
        (tmp, commit)
    }

    fn expected(files: &[(&str, &[u8])]) -> String {
        let mut sorted = files.to_vec();
        sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
        let mut hasher = Sha256::new();
        for (path, bytes) in sorted {
            hasher.update(path.as_bytes());
            hasher.update(b"\0");
            hasher.update(bytes);
            hasher.update(b"\0");
        }
        hex::encode(hasher.finalize())
    }

    #[tokio::test]
    async fn tree_hash_covers_committed_files_only() {
        let (tmp, commit) = fixture();
        let hash = tree_sha256(tmp.path(), &commit).await.unwrap();
        assert_eq!(
            hash,
            expected(&[
                (".gitignore", b"node_modules/\n"),
                ("lib/a.mjs", b"export {}\n"),
                (MANIFEST_FILE, MANIFEST.as_bytes()),
            ])
        );
        // The same layout as the folder fingerprint of a copy holding just those files.
        let copy = tempfile::TempDir::new().unwrap();
        std::fs::write(copy.path().join(".gitignore"), "node_modules/\n").unwrap();
        std::fs::create_dir_all(copy.path().join("lib")).unwrap();
        std::fs::write(copy.path().join("lib/a.mjs"), "export {}\n").unwrap();
        std::fs::write(copy.path().join(MANIFEST_FILE), MANIFEST).unwrap();
        assert_eq!(
            crate::plugin_host::local_install::compute_bundle_fingerprint(copy.path()).unwrap(),
            hash
        );
        // A changed working tree does not change the commit's hash.
        std::fs::write(tmp.path().join("lib/a.mjs"), "changed").unwrap();
        assert_eq!(tree_sha256(tmp.path(), &commit).await.unwrap(), hash);
        assert_eq!(
            committed_manifest(tmp.path(), &commit).await.unwrap(),
            MANIFEST
        );
        assert!(check_checkout(tmp.path(), &commit, &hash, MANIFEST)
            .await
            .is_ok());
        assert!(
            check_checkout(tmp.path(), &commit, &"0".repeat(64), MANIFEST)
                .await
                .is_err()
        );
        assert!(
            check_checkout(tmp.path(), &commit, &hash, &format!("{MANIFEST} "))
                .await
                .is_err()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_tree_with_a_symbolic_link_cannot_be_signed() {
        let (tmp, _) = fixture();
        std::os::unix::fs::symlink("lib/a.mjs", tmp.path().join("link.mjs")).unwrap();
        git(tmp.path(), &["add", "link.mjs"]);
        git(tmp.path(), &["commit", "--quiet", "-m", "link"]);
        let commit = git(tmp.path(), &["rev-parse", "HEAD"]);
        let err = tree_sha256(tmp.path(), &commit).await.unwrap_err();
        assert!(err.to_string().contains("symbolic link"), "{err}");
    }

    #[tokio::test]
    async fn signing_source_of_a_checkout_names_origin_head_and_tree() {
        let (tmp, commit) = fixture();
        git(
            tmp.path(),
            &["remote", "add", "origin", "https://github.com/acme/pods"],
        );
        let source = git_source_of(tmp.path()).await.unwrap();
        assert_eq!(source.plugin_id, "dev.example.pods");
        assert_eq!(source.manifest, MANIFEST);
        match source.source {
            PluginSource::Git {
                url,
                commit: c,
                tree_sha256,
            } => {
                assert_eq!(url, "https://github.com/acme/pods");
                assert_eq!(c, commit);
                assert_eq!(tree_sha256, tree_sha256_of(&tmp, &commit).await);
            }
            other => panic!("expected git, got {other:?}"),
        }
        git(
            tmp.path(),
            &[
                "remote",
                "set-url",
                "origin",
                "git@github.com:acme/pods.git",
            ],
        );
        assert!(git_source_of(tmp.path()).await.is_err());
    }

    async fn tree_sha256_of(tmp: &tempfile::TempDir, commit: &str) -> String {
        tree_sha256(tmp.path(), commit).await.unwrap()
    }

    #[test]
    fn a_folder_bundles_like_the_sdk_bundler() {
        use crate::plugin_host::bundle::tests::{
            APPENDIX_A_SHA256, HELLO_WEB_MAIN, HELLO_WEB_MANIFEST,
        };
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join(MANIFEST_FILE), HELLO_WEB_MANIFEST).unwrap();
        std::fs::write(dir.path().join("main.mjs"), HELLO_WEB_MAIN).unwrap();
        let source = bundle_of_dir(dir.path()).unwrap();
        assert_eq!(
            source.source,
            PluginSource::Bundle {
                sha256: APPENDIX_A_SHA256.into(),
                size: 1605
            }
        );
        let bytes = STANDARD.decode(source.bundle.unwrap()).unwrap();
        assert_eq!(bundle::bundle_sha256(&bytes), APPENDIX_A_SHA256);
        assert_eq!(source.manifest, HELLO_WEB_MANIFEST);
        std::fs::write(dir.path().join("notes.txt"), "x").unwrap();
        let err = bundle_of_dir(dir.path()).unwrap_err().to_string();
        assert!(err.contains("rim-plugin-bundle"), "{err}");
    }

    #[test]
    fn an_update_keeps_only_approvals_the_new_copy_still_asks_for() {
        let manifest: PluginManifest = serde_json::from_str(
            r#"{"manifest_version":1,"plugin_id":"dev.example.pods","display_name":"Pods","version":"0.4.0","description":"d","runtime_kind":"DesktopLocalProcess","entrypoint":"main.mjs","capabilities":["chat.read"],"commands":[{"id":"list","title":"List","description":"d","ai_callable":true,"output_schema":{"type":"object"}}]}"#,
        )
        .unwrap();
        let old = PluginRecord {
            plugin_id: "dev.example.pods".into(),
            status: PluginStatus::Enabled,
            approved_capabilities: vec!["chat.read".into(), "chat.write".into()],
            approved_ai_commands: vec!["list".into(), "gone".into()],
            manifest_hash: String::new(),
            bundle_fingerprint: String::new(),
            fingerprint_changed: false,
            last_error: None,
            source: None,
            starting: false,
        };
        let (capabilities, ai, enabled) = carried(&old, &manifest);
        assert_eq!(capabilities, vec!["chat.read"]);
        assert_eq!(ai, vec!["list"]);
        assert!(enabled);
    }
}
