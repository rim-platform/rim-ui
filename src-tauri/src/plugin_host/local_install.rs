//! Local-folder plugin install path.
//!
//! Mirrors the shape of [`crate::plugin_host::git_install`] but copies a plugin
//! from a local directory on disk instead of cloning a git repository.
//!
//! ## Security model
//!
//! - Every segment of the source path is validated against the same rules as
//!   [`crate::plugin_host::plugin_protocol::is_safe_segment`] — no `..`,
//!   percent-encoded traversal, or NUL bytes.
//! - After joining segments the candidate path is canonicalized and asserted to
//!   still be a subdirectory of the user-supplied source root.  This closes
//!   symlink-escape vectors and prevents a crafted manifest from reaching outside
//!   its declared source folder.
//! - Symlinks inside the source folder that resolve outside it are skipped (not
//!   followed) during the recursive copy.
//!
//! ## Bundle fingerprint (trust on first use)
//!
//! At install time `compute_bundle_fingerprint` walks every regular file under
//! `plugin_dir`, sorts their relative paths deterministically, and feeds
//! (`rel_path_as_bytes || content_bytes`) into a single SHA-256 hasher.  The
//! resulting hex digest is the *bundle fingerprint*.  It is stored in
//! [`crate::plugin_host::state::PluginRecord::bundle_fingerprint`] and recomputed
//! at enable time and at app start to detect tampering or silent updates.

use crate::plugin_host::bundle::{self, BundleError};
use crate::plugin_host::git_install::{detect_manifest, GitInstallError, PluginInstallResult};
use crate::plugin_host::manifest::{ManifestError, PluginManifest, RuntimeKind};
use crate::plugin_host::plugin_protocol::is_safe_segment;
use crate::plugin_host::validation::{validate_plugin_manifest_for_host, ValidationError};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

// ─── Error type ──────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum LocalInstallError {
    /// The source folder contains no `rim-plugin.json` and no simple-mode entry.
    #[error("no manifest found (rim-plugin.json or simple mode entrypoint)")]
    NoManifest,
    /// A path segment contained `..`, `/`, `\`, NUL, or a percent-encoded form.
    #[error("path traversal rejected: {0}")]
    PathTraversal(String),
    /// The manifest was structurally invalid.
    #[error("manifest error: {0}")]
    Manifest(#[from] ManifestError),
    /// The manifest failed install validation.
    #[error("invalid manifest: {0}")]
    InvalidManifest(#[from] ValidationError),
    /// Plugin with this ID is already in the installed-plugins directory.
    #[error("plugin already installed: {0}")]
    AlreadyExists(String),
    /// Lifecycle rejection forwarded from `lifecycle::install`.
    #[error("lifecycle error: {0}")]
    LifecycleFailure(String),
    /// A bundle, or a `WebSandboxed` folder, that breaks the bundle rules.
    #[error("{0}")]
    Bundle(#[from] BundleError),
    /// IO failure.
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for LocalInstallError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(None)?;
        match self {
            Self::InvalidManifest(inner) => {
                map.serialize_entry("kind", "INVALID_MANIFEST")?;
                map.serialize_entry("data", inner)?;
            }
            other => {
                map.serialize_entry("kind", "LOCAL_INSTALL_ERROR")?;
                map.serialize_entry("message", &other.to_string())?;
            }
        }
        map.end()
    }
}

// ─── Path-traversal hardening ─────────────────────────────────────────────────

/// Validates every component of `path` using the same rules as
/// [`crate::plugin_host::plugin_protocol::is_safe_segment`].
///
/// Returns the path unchanged on success, or [`LocalInstallError::PathTraversal`]
/// if any component is unsafe.
///
/// # Errors
///
/// Returns `PathTraversal` when:
/// - Any component contains `..`, `/`, `\`, or NUL.
/// - Any component contains percent-encoded traversal sequences.
///
/// # Examples
///
/// ```rust,ignore
/// assert!(check_path_safe(Path::new("/home/user/myplugin")).is_ok());
/// assert!(check_path_safe(Path::new("/home/user/../etc/passwd")).is_err());
/// ```
pub fn check_path_safe(path: &Path) -> Result<(), LocalInstallError> {
    for component in path.components() {
        use std::path::Component;
        match component {
            Component::ParentDir => {
                return Err(LocalInstallError::PathTraversal(format!(
                    "path contains `..`: {}",
                    path.display()
                )));
            }
            Component::Normal(os_name) => {
                let seg = os_name.to_string_lossy();
                if !is_safe_segment(&seg) {
                    return Err(LocalInstallError::PathTraversal(format!(
                        "unsafe path segment `{seg}` in: {}",
                        path.display()
                    )));
                }
            }
            // Prefix / RootDir / CurDir are harmless — allow them.
            _ => {}
        }
    }
    Ok(())
}

// ─── Bundle fingerprint ───────────────────────────────────────────────────────

/// Computes a deterministic SHA-256 fingerprint over all regular files under
/// `plugin_dir` and returns it as lowercase hex.
///
/// Files are sorted by their relative path before hashing, so the result is
/// independent of filesystem enumeration order.  Each file contributes:
///
/// ```text
/// SHA256.update(relative_path_as_utf8_bytes)
/// SHA256.update(b"\0")          // path/content separator
/// SHA256.update(file_contents)
/// SHA256.update(b"\0")          // file separator
/// ```
///
/// Symlinks are followed only if they resolve to a path still under `plugin_dir`
/// (post-canonicalize prefix check); otherwise they are silently skipped.
///
/// # Errors
///
/// Returns an IO error if the directory cannot be walked or a file cannot be read.
///
/// # Examples
///
/// ```rust,ignore
/// let fingerprint = compute_bundle_fingerprint(Path::new("/home/user/.rim/plugins/dev.example.hello-world"))?;
/// println!("bundle fingerprint: {fingerprint}");
/// ```
pub fn compute_bundle_fingerprint(plugin_dir: &Path) -> Result<String, std::io::Error> {
    let canonical_dir = plugin_dir.canonicalize()?;
    let mut file_entries: Vec<(String, Vec<u8>)> = Vec::new();

    collect_files(&canonical_dir, &canonical_dir, &mut file_entries)?;

    // Sort by relative path for determinism across filesystems.
    file_entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = Sha256::new();
    for (rel_path, contents) in &file_entries {
        hasher.update(rel_path.as_bytes());
        hasher.update(b"\0");
        hasher.update(contents);
        hasher.update(b"\0");
    }

    Ok(hex::encode(hasher.finalize()))
}

fn collect_files(
    base: &Path,
    dir: &Path,
    entries: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), std::io::Error> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();

        // Resolve symlinks — skip those that escape the plugin root.
        let canonical = match path.canonicalize() {
            Ok(p) => p,
            Err(_) => continue, // dangling symlink → skip
        };
        if !canonical.starts_with(base) {
            // Symlink escapes plugin root — skip silently.
            continue;
        }

        let file_type = entry.file_type()?;
        if file_type.is_dir() || (file_type.is_symlink() && canonical.is_dir()) {
            collect_files(base, &canonical, entries)?;
        } else if file_type.is_file() || (file_type.is_symlink() && canonical.is_file()) {
            let rel = canonical
                .strip_prefix(base)
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let contents = std::fs::read(&canonical)?;
            entries.push((rel, contents));
        }
    }
    Ok(())
}

// ─── Copy helper (mirrors git_install::copy_dir_recursive) ───────────────────

fn copy_dir_recursive(
    src: &Path,
    dst: &Path,
    src_canonical_root: &Path,
) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dest_path = dst.join(entry.file_name());

        // Resolve the source entry to its canonical path before deciding what to do.
        let canonical_src = match entry.path().canonicalize() {
            Ok(p) => p,
            Err(_) => continue, // dangling symlink → skip
        };

        // Reject symlinks that escape the plugin source root.
        if !canonical_src.starts_with(src_canonical_root) {
            log::warn!(
                "[AUDIT] event=local_install_symlink_escape src={:?} canonical={:?} root={:?}",
                entry.path(),
                canonical_src,
                src_canonical_root
            );
            continue;
        }

        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_recursive(&canonical_src, &dest_path, src_canonical_root)?;
        } else {
            std::fs::copy(&canonical_src, &dest_path)?;
        }
    }
    Ok(())
}

// ─── Install flow ─────────────────────────────────────────────────────────────

/// Installs a plugin from a local folder.
///
/// Steps:
/// 1. Validate every component of `source_path` for path-traversal.
/// 2. Canonicalize and assert `source_path` still exists on disk.
/// 3. Load and structurally validate the manifest (`rim-plugin.json` or simple-mode).
/// 4. Run install validation via [`validate_plugin_manifest_for_host`],
///    refusing `network_origins` on one of `forbidden_origins`.
/// 5. Check for reserved-prefix rejection.
/// 6. Check for existing-plugin collision.
/// 7. Compute the bundle fingerprint.
/// 8. Copy (not move) the plugin into `~/.rim/plugins/<plugin_id>/`; for a
///    `WebSandboxed` plugin, unpack just its bundle files there instead.
/// 9. Return `(manifest, final_dir, result, bundle_fingerprint)`.
///
/// The caller (`plugin_install_from_local` in `commands.rs`) is responsible for
/// persisting the lifecycle record with `lifecycle::install` and storing the
/// fingerprint in the `PluginRecord`.
///
/// # Errors
///
/// - [`LocalInstallError::PathTraversal`] — `source_path` fails segment validation.
/// - [`LocalInstallError::NoManifest`] — no manifest found in the folder.
/// - [`LocalInstallError::Manifest`] — manifest parse failure.
/// - [`LocalInstallError::InvalidManifest`] — install validation failed.
/// - [`LocalInstallError::AlreadyExists`] — the plugin ID is already installed.
/// - [`LocalInstallError::Bundle`] — a `WebSandboxed` folder breaks the bundle
///   rules.
/// - [`LocalInstallError::Io`] — the source is not a directory, the plugin ID has
///   a reserved prefix, or the copy fails.
///
/// # Examples
///
/// ```rust,ignore
/// let (manifest, dir, result, fingerprint) =
///     install_from_local(Path::new("/home/user/my-plugin"), &[], &[]).await?;
/// println!("installed {} at {}", manifest.plugin_id, dir.display());
/// ```
pub async fn install_from_local(
    source_path: &Path,
    existing_plugin_ids: &[String],
    forbidden_origins: &[String],
) -> Result<(PluginManifest, PathBuf, PluginInstallResult, String), LocalInstallError> {
    // Step 1: validate path components.
    check_path_safe(source_path)?;

    // Step 2: canonicalize — ensures the path actually exists and resolves symlinks.
    let canonical_source = source_path.canonicalize().map_err(|e| {
        LocalInstallError::Io(std::io::Error::new(
            e.kind(),
            format!(
                "failed to canonicalize source path {}: {e}",
                source_path.display()
            ),
        ))
    })?;

    if !canonical_source.is_dir() {
        return Err(LocalInstallError::Io(std::io::Error::new(
            std::io::ErrorKind::NotADirectory,
            format!(
                "source path is not a directory: {}",
                canonical_source.display()
            ),
        )));
    }

    // Step 3: detect manifest.
    let manifest = detect_manifest(&canonical_source).map_err(|e| match e {
        GitInstallError::NoManifest => LocalInstallError::NoManifest,
        GitInstallError::Manifest(m) => LocalInstallError::Manifest(m),
        GitInstallError::InvalidManifest(v) => LocalInstallError::InvalidManifest(v),
        other => LocalInstallError::Io(std::io::Error::other(other.to_string())),
    })?;

    // Step 4: capability key shape, the install-ID leak check, and the kind's rules.
    if let Err(e) = validate_plugin_manifest_for_host(&manifest, forbidden_origins) {
        log::warn!(
            "[AUDIT] event=local_install_rejected plugin_id={} reason={}",
            manifest.plugin_id,
            e
        );
        return Err(LocalInstallError::InvalidManifest(e));
    }

    // A web plugin's folder must hold a bundle by the bundle rules; that bundle is
    // what gets installed.
    let web_bundle = if manifest.runtime_kind == RuntimeKind::WebSandboxed {
        Some(bundle::check_dir(&canonical_source)?)
    } else {
        None
    };

    // Step 5: reserved-prefix check.
    if manifest.has_reserved_prefix() {
        return Err(LocalInstallError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("reserved plugin_id prefix: {}", manifest.plugin_id),
        )));
    }

    // Step 6: collision check.
    if existing_plugin_ids.contains(&manifest.plugin_id) {
        return Err(LocalInstallError::AlreadyExists(manifest.plugin_id.clone()));
    }

    let plugins_root = crate::plugin_host::discovery::plugins_dir();
    let final_dir = plugins_root.join(&manifest.plugin_id);
    if final_dir.exists() {
        return Err(LocalInstallError::AlreadyExists(manifest.plugin_id.clone()));
    }

    // Steps 7 and 8: a web plugin's bundle is unpacked and fingerprinted as
    // installed; any other plugin is fingerprinted before the copy, so the
    // fingerprint reflects the user-supplied source, then copied whole.
    let bundle_fingerprint = if let Some(web_bundle) = web_bundle {
        bundle::unpack(&web_bundle, &plugins_root, false)?;
        compute_bundle_fingerprint(&final_dir)?
    } else {
        let fingerprint = compute_bundle_fingerprint(&canonical_source)?;
        std::fs::create_dir_all(&plugins_root)?;
        copy_dir_recursive(&canonical_source, &final_dir, &canonical_source)?;
        fingerprint
    };

    let result = PluginInstallResult {
        plugin_id: manifest.plugin_id.clone(),
        display_name: manifest.display_name.clone(),
        version: manifest.version.clone(),
        capabilities: manifest.capabilities.clone(),
        install_path: final_dir.display().to_string(),
    };

    Ok((manifest, final_dir, result, bundle_fingerprint))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::discovery::MANIFEST_FILE;
    use tempfile::TempDir;

    fn write_manifest(dir: &Path, plugin_id: &str) {
        let manifest = serde_json::json!({
            "manifest_version": 1,
            "plugin_id": plugin_id,
            "display_name": "Test",
            "version": "1.0.0",
            "description": "test",
            "runtime_kind": "DesktopLocalProcess",
            "entrypoint": "main.js",
        });
        std::fs::write(dir.join(MANIFEST_FILE), manifest.to_string()).unwrap();
    }

    // ── check_path_safe ──

    #[test]
    fn safe_absolute_path_passes() {
        assert!(check_path_safe(Path::new("/home/user/plugins/myplugin")).is_ok());
    }

    #[test]
    fn dotdot_component_is_rejected() {
        let err = check_path_safe(Path::new("/home/user/../etc/passwd")).unwrap_err();
        assert!(
            matches!(err, LocalInstallError::PathTraversal(_)),
            "expected PathTraversal, got {err:?}"
        );
    }

    #[test]
    fn dotdot_only_path_is_rejected() {
        let err = check_path_safe(Path::new("../escape")).unwrap_err();
        assert!(matches!(err, LocalInstallError::PathTraversal(_)));
    }

    #[test]
    fn percent_encoded_dotdot_is_rejected() {
        // is_safe_segment rejects %2e%2e
        let err = check_path_safe(Path::new("%2e%2e/escape")).unwrap_err();
        assert!(matches!(err, LocalInstallError::PathTraversal(_)));
    }

    // ── compute_bundle_fingerprint ──

    #[test]
    fn fingerprint_is_deterministic() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("a.txt"), b"hello").unwrap();
        std::fs::write(tmp.path().join("b.txt"), b"world").unwrap();

        let fp1 = compute_bundle_fingerprint(tmp.path()).unwrap();
        let fp2 = compute_bundle_fingerprint(tmp.path()).unwrap();
        assert_eq!(fp1, fp2);
    }

    #[test]
    fn fingerprint_changes_when_file_content_mutated() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("main.py"), b"print('hello')").unwrap();

        let fp_before = compute_bundle_fingerprint(tmp.path()).unwrap();

        std::fs::write(tmp.path().join("main.py"), b"print('evil')").unwrap();
        let fp_after = compute_bundle_fingerprint(tmp.path()).unwrap();

        assert_ne!(fp_before, fp_after);
    }

    #[test]
    fn fingerprint_changes_when_new_file_added() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("main.py"), b"print('hello')").unwrap();

        let fp_before = compute_bundle_fingerprint(tmp.path()).unwrap();

        std::fs::write(tmp.path().join("extra.py"), b"# extra").unwrap();
        let fp_after = compute_bundle_fingerprint(tmp.path()).unwrap();

        assert_ne!(fp_before, fp_after);
    }

    #[test]
    fn fingerprint_is_hex_sha256() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("x"), b"data").unwrap();
        let fp = compute_bundle_fingerprint(tmp.path()).unwrap();
        // SHA-256 hex is 64 lowercase hex chars
        assert_eq!(fp.len(), 64);
        assert!(fp.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // ── install_from_local ──

    #[tokio::test]
    async fn happy_path_installs_plugin_and_returns_fingerprint() {
        // Use a process-and-thread-unique plugin ID to avoid collision when
        // Rust's test harness runs tokio tests in parallel.
        let unique_suffix = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos()
        );
        let plugin_id = format!("dev.example.local-test-{unique_suffix}");

        let tmp_src = TempDir::new().unwrap();
        // Write manifest with the unique plugin_id (at least 3 reverse-domain segments).
        let manifest_json = serde_json::json!({
            "manifest_version": 1,
            "plugin_id": plugin_id,
            "display_name": "Test",
            "version": "1.0.0",
            "description": "test",
            "runtime_kind": "DesktopLocalProcess",
            "entrypoint": "main.js",
        });
        std::fs::write(
            tmp_src
                .path()
                .join(crate::plugin_host::discovery::MANIFEST_FILE),
            manifest_json.to_string(),
        )
        .unwrap();
        std::fs::write(tmp_src.path().join("main.js"), b"console.log('hi')").unwrap();

        let existing_ids: Vec<String> = vec![];
        let result = install_from_local(tmp_src.path(), &existing_ids, &[]).await;

        // This test touches the real ~/.rim/plugins/ directory, and the installed
        // copy is removed after the assertions whatever the outcome.
        let plugins_root = crate::plugin_host::discovery::plugins_dir();
        let install_dest = plugins_root.join(&plugin_id);

        match result {
            Ok((manifest, _final_dir, install_result, fingerprint)) => {
                assert_eq!(manifest.plugin_id, plugin_id);
                assert_eq!(install_result.plugin_id, plugin_id);
                assert_eq!(fingerprint.len(), 64);
            }
            Err(LocalInstallError::AlreadyExists(_)) => {
                // Collision from an identical plugin_id — acceptable but should not
                // happen given the unique suffix above.
            }
            Err(e) => panic!("unexpected error: {e}"),
        }

        // Always clean up the installed directory.
        let _ = std::fs::remove_dir_all(&install_dest);
    }

    #[tokio::test]
    async fn folder_without_manifest_returns_no_manifest_error() {
        let tmp = TempDir::new().unwrap();
        // No rim-plugin.json and no simple-mode file.
        std::fs::write(tmp.path().join("random.txt"), b"not a plugin").unwrap();

        let err = install_from_local(tmp.path(), &[], &[]).await.unwrap_err();
        assert!(
            matches!(err, LocalInstallError::NoManifest),
            "expected NoManifest, got {err:?}"
        );
    }

    #[tokio::test]
    async fn path_traversal_in_source_path_is_rejected() {
        // The traversal is caught at check_path_safe before any disk access.
        let traversal_path = Path::new("/home/user/../etc/passwd");
        let err = install_from_local(traversal_path, &[], &[])
            .await
            .unwrap_err();
        assert!(
            matches!(err, LocalInstallError::PathTraversal(_)),
            "expected PathTraversal, got {err:?}"
        );
    }

    #[tokio::test]
    async fn already_installed_collision_is_rejected() {
        let tmp_src = TempDir::new().unwrap();
        write_manifest(tmp_src.path(), "dev.example.collision");
        let existing = vec!["dev.example.collision".to_string()];

        let err = install_from_local(tmp_src.path(), &existing, &[])
            .await
            .unwrap_err();
        assert!(
            matches!(err, LocalInstallError::AlreadyExists(_)),
            "expected AlreadyExists, got {err:?}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_escaping_source_folder_is_skipped_not_followed() {
        use std::os::unix::fs::symlink;

        let tmp_src = TempDir::new().unwrap();
        write_manifest(tmp_src.path(), "dev.example.symtest");

        // Place a secret file outside the plugin directory.
        let tmp_other = TempDir::new().unwrap();
        let secret = tmp_other.path().join("secret.txt");
        std::fs::write(&secret, b"secret").unwrap();

        // Create a symlink inside the plugin dir pointing outside.
        symlink(&secret, tmp_src.path().join("escaped.txt")).unwrap();

        // Fingerprint computation must not error — escaped symlink is skipped.
        let fp = compute_bundle_fingerprint(tmp_src.path()).unwrap();
        assert_eq!(fp.len(), 64);

        // The escaped file must NOT appear in the fingerprint path list.
        // (If it did, the fingerprint would differ from a bundle without that file.)
        let fp_clean = {
            let tmp_clean = TempDir::new().unwrap();
            write_manifest(tmp_clean.path(), "dev.example.symtest");
            compute_bundle_fingerprint(tmp_clean.path()).unwrap()
        };
        // The symlink resolves into tmp_other, outside the tmp_src root, so it is
        // skipped and the fingerprint covers only the manifest file.
        assert_eq!(
            fp, fp_clean,
            "escaped symlink must be silently skipped — fingerprints should match"
        );
    }
}
