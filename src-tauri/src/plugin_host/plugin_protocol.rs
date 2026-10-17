//! The `rim-plugin://` Tauri scheme and the panel files the host reads for
//! plugin frames.
//!
//! The scheme serves only the frame shell, at `rim-plugin://shell/v1/`. Panels
//! never load files over it: the host reads a panel's folder with
//! [`read_panel_files`] and hands the files to the shell, which runs them as
//! `blob:` URLs inside the frame. A local-process plugin's panel loads the shell
//! as `local-panel.html`, whose policy header closes the network.
//!
//! ## Security model
//!
//! [`resolve_plugin_uri`] maps `<plugin_id>/<panel_id>/<rest>` to
//! `<plugins_root>/<plugin_id>/panels/<panel_id>/<rest>`, and every panel file
//! is read through it:
//!
//! - Every path segment is validated individually before joining.
//! - Any segment containing `..`, `/`, `\`, NUL, or percent-encoded
//!   equivalents is rejected before any filesystem access.
//! - After joining the segments the resulting path is canonicalized and
//!   asserted to still be under the plugin's bundle root.  This closes
//!   symlink-escape vectors.
//! - Only the named plugin's directory is accessible: the canonical path must
//!   stay under `<plugins_root>/<plugin_id>/`. [`read_panel_files`] narrows that
//!   to `panels/<panel_id>/` itself.

use std::path::{Path, PathBuf};

use crate::plugin_host::bundle::{MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES};

/// The content security policy the frame shell's own `<meta>` states, also sent
/// as a header so the two can only agree. `rim-plugin://shell` names the desktop
/// shell's own origin, which WebKit does not match to `'self'` in a sandboxed
/// frame.
pub const SHELL_POLICY: &str = "default-src 'none'; \
script-src 'self' rim-plugin://shell blob: 'wasm-unsafe-eval'; \
style-src 'self' blob: 'unsafe-inline'; img-src 'self' blob: data: https:; font-src blob: data:; \
media-src blob: data:; connect-src https: wss:; worker-src blob:; frame-src 'none'; \
form-action 'none'; base-uri 'none'";

/// The policy of the shell page a local-process plugin's panel loads: no
/// network at all (such a panel reaches it only through its plugin's process),
/// no workers, no WebAssembly; scripts, styles, images, fonts and media only
/// from the shell itself, `blob:` or `data:`.
pub const LOCAL_PANEL_POLICY: &str = "default-src 'none'; \
script-src 'self' rim-plugin://shell blob:; style-src 'self' blob: 'unsafe-inline'; \
img-src 'self' blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; \
worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

const SHELL_INDEX: &[u8] = include_bytes!("../../../public/plugin-frame/v1/index.html");
const SHELL_SCRIPT: &[u8] = include_bytes!("../../../public/plugin-frame/v1/shell.js");

/// One file the scheme serves.
#[derive(Debug, PartialEq)]
pub struct ShellAsset {
    pub bytes: &'static [u8],
    pub media_type: &'static str,
    /// The `Content-Security-Policy` header it is sent with.
    pub policy: &'static str,
    /// Sent with `Access-Control-Allow-Origin: *`: only `shell.js`, which the
    /// null-origin frames load as a CORS request.
    pub any_origin: bool,
}

/// The frame shell file at `uri_path`: `shell/v1/index.html` (also
/// `shell/v1/`), the same page as `shell/v1/local-panel.html` with
/// [`LOCAL_PANEL_POLICY`], or `shell/v1/shell.js`; `None` for any other path.
/// The authority `shell` cannot be a plugin id, which has at least three
/// segments.
pub fn shell_asset(uri_path: &str) -> Option<ShellAsset> {
    let path = uri_path.trim_start_matches('/');
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let page = |policy| ShellAsset {
        bytes: SHELL_INDEX,
        media_type: "text/html; charset=utf-8",
        policy,
        any_origin: false,
    };
    match path {
        "shell/v1/" | "shell/v1/index.html" => Some(page(SHELL_POLICY)),
        "shell/v1/local-panel.html" => Some(page(LOCAL_PANEL_POLICY)),
        "shell/v1/shell.js" => Some(ShellAsset {
            bytes: SHELL_SCRIPT,
            media_type: "text/javascript; charset=utf-8",
            policy: SHELL_POLICY,
            any_origin: true,
        }),
        _ => None,
    }
}

/// The response to a `rim-plugin://` request at `uri_path` (the URI without its
/// scheme): a [`ShellAsset`] with its headers, or 404 for every other path.
pub fn respond(uri_path: &str) -> tauri::http::Response<Vec<u8>> {
    let builder = tauri::http::Response::builder();
    let response = match shell_asset(uri_path) {
        Some(asset) => {
            let builder = builder
                .status(200)
                .header("Content-Type", asset.media_type)
                .header("Content-Security-Policy", asset.policy)
                .header("X-Content-Type-Options", "nosniff")
                .header("Referrer-Policy", "no-referrer");
            let builder = if asset.any_origin {
                builder.header("Access-Control-Allow-Origin", "*")
            } else {
                builder
            };
            builder.body(asset.bytes.to_vec())
        }
        None => {
            log::warn!("[AUDIT] event=plugin_protocol_forbidden uri={uri_path}");
            builder.status(404).body(b"Not Found".to_vec())
        }
    };
    response.expect("static response headers are valid")
}

/// Outcome of resolving a `rim-plugin://` URI.
#[derive(Debug, PartialEq)]
pub enum ResolveResult {
    /// Resolved to a canonical filesystem path that is safe to serve.
    Ok(PathBuf),
    /// The URI segments were malformed or contained a traversal attempt.
    Forbidden,
    /// The resolved file does not exist.
    NotFound,
}

/// Validate a single URI path segment.
///
/// Rejects the segment when it:
/// - is empty,
/// - contains `..` (literal),
/// - contains `/` or `\`,
/// - contains a NUL byte,
/// - contains percent-encoded traversal (`%2e`, `%2f`, `%5c` — case-insensitive),
/// - contains `%00` (NUL).
///
/// # Examples
///
/// ```rust,ignore
/// use rim_ui_lib::plugin_host::plugin_protocol::is_safe_segment;
/// assert!(is_safe_segment("index.html"));
/// assert!(!is_safe_segment(".."));
/// assert!(!is_safe_segment("%2e%2e"));
/// ```
pub fn is_safe_segment(segment: &str) -> bool {
    if segment.is_empty() {
        return false;
    }
    // Literal traversal
    if segment.contains("..")
        || segment.contains('/')
        || segment.contains('\\')
        || segment.contains('\0')
    {
        return false;
    }
    // Percent-encoded traversal — case-insensitive scan
    let lower = segment.to_lowercase();
    if lower.contains("%2e")
        || lower.contains("%2f")
        || lower.contains("%5c")
        || lower.contains("%00")
    {
        return false;
    }
    true
}

/// Resolve a `rim-plugin://` URI to a filesystem path.
///
/// `uri_path` is the path component of the URI after stripping the scheme and
/// authority, e.g. `"myplugin/main/index.html"` for
/// `rim-plugin://myplugin/main/index.html`.
///
/// `plugins_root` is the directory that contains all plugin bundle
/// subdirectories — typically `~/.rim/plugins/`.
///
/// # Errors
///
/// Returns [`ResolveResult::Forbidden`] when path-traversal is detected or
/// the canonical path escapes the plugin bundle root.
///
/// Returns [`ResolveResult::NotFound`] when the file does not exist on disk.
///
/// # Examples
///
/// ```rust,ignore
/// use std::path::Path;
/// use rim_ui_lib::plugin_host::plugin_protocol::{resolve_plugin_uri, ResolveResult};
///
/// let root = Path::new("/home/user/.rim/plugins");
/// match resolve_plugin_uri("dev.example.hello/main/index.html", root) {
///     ResolveResult::Ok(path) => println!("serve {:?}", path),
///     ResolveResult::Forbidden => println!("403"),
///     ResolveResult::NotFound => println!("404"),
/// }
/// ```
pub fn resolve_plugin_uri(uri_path: &str, plugins_root: &Path) -> ResolveResult {
    // Strip a leading slash if present (Tauri may or may not include it).
    let uri_path = uri_path.trim_start_matches('/');

    // Split into at least three components: plugin_id / panel_id / rest...
    let parts: Vec<&str> = uri_path.splitn(3, '/').collect();
    if parts.len() < 3 {
        return ResolveResult::Forbidden;
    }
    let (plugin_id_seg, panel_id_seg, rest) = (parts[0], parts[1], parts[2]);

    // Validate plugin_id and panel_id segments.
    if !is_safe_segment(plugin_id_seg) || !is_safe_segment(panel_id_seg) {
        return ResolveResult::Forbidden;
    }

    // Validate every component of the remainder path individually.
    for component in rest.split('/') {
        if !is_safe_segment(component) {
            return ResolveResult::Forbidden;
        }
    }

    // Build the expected plugin bundle root.
    let plugin_root = plugins_root.join(plugin_id_seg);

    // Assemble: ~/.rim/plugins/<plugin_id>/panels/<panel_id>/<rest>
    let candidate = plugin_root.join("panels").join(panel_id_seg).join(rest);

    // Canonicalize to resolve symlinks and any remaining `.` components.
    // If the file does not exist, canonicalize will fail → NotFound.
    let canonical = match candidate.canonicalize() {
        Ok(p) => p,
        Err(_) => return ResolveResult::NotFound,
    };

    // Assert the canonical path is still under the plugin's bundle root.
    // We canonicalize the plugin root as well so comparison is apples-to-apples.
    let canonical_root = match plugin_root.canonicalize() {
        Ok(p) => p,
        Err(_) => return ResolveResult::NotFound,
    };

    if !canonical.starts_with(&canonical_root) {
        log::warn!(
            "[AUDIT] event=plugin_uri_traversal_attempt uri={} resolved={:?} root={:?}",
            uri_path,
            canonical,
            canonical_root
        );
        return ResolveResult::Forbidden;
    }

    ResolveResult::Ok(canonical)
}

/// One file of a panel folder: its path relative to the folder and its bytes.
#[derive(Debug, PartialEq)]
pub struct PanelFile {
    pub path: String,
    pub bytes: Vec<u8>,
}

/// Why a panel's files could not be read.
#[derive(Debug, thiserror::Error)]
pub enum PanelFilesError {
    #[error("the panel file {0} is not allowed")]
    Forbidden(String),
    #[error("the panel has no folder")]
    NotFound,
    #[error("the panel holds more than {MAX_BUNDLE_FILES} files or {MAX_BUNDLE_BYTES} bytes")]
    TooLarge,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Every file under `<plugins_root>/<plugin_id>/panels/<panel_id>/`, sorted by
/// path. Each one is resolved by [`resolve_plugin_uri`]; a name it rejects, a
/// symlink out of the panel's folder, or a panel folder that is itself a link
/// fails the whole read. Symlinks to directories and dangling symlinks are
/// skipped.
pub fn read_panel_files(
    plugins_root: &Path,
    plugin_id: &str,
    panel_id: &str,
) -> Result<Vec<PanelFile>, PanelFilesError> {
    if !is_safe_segment(plugin_id) || !is_safe_segment(panel_id) {
        return Err(PanelFilesError::Forbidden(format!(
            "{plugin_id}/{panel_id}"
        )));
    }
    let root = plugins_root.join(plugin_id).join("panels").join(panel_id);
    if !root.is_dir() {
        return Err(PanelFilesError::NotFound);
    }
    // The panel folder is a real folder of the plugin, not a link elsewhere.
    let panel_root = root.canonicalize()?;
    let expected = plugins_root
        .join(plugin_id)
        .canonicalize()?
        .join("panels")
        .join(panel_id);
    if panel_root != expected {
        log::warn!(
            "[AUDIT] event=plugin_panel_outside_folder plugin_id={plugin_id} panel_id={panel_id}"
        );
        return Err(PanelFilesError::Forbidden(format!("panels/{panel_id}")));
    }
    let mut files = Vec::new();
    let mut total = 0u64;
    let mut dirs = vec![String::new()];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(root.join(&dir))? {
            let entry = entry?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|name| PanelFilesError::Forbidden(name.to_string_lossy().into_owned()))?;
            let path = if dir.is_empty() {
                name
            } else {
                format!("{dir}/{name}")
            };
            if entry.file_type()?.is_dir() {
                dirs.push(path);
                continue;
            }
            let resolved =
                match resolve_plugin_uri(&format!("{plugin_id}/{panel_id}/{path}"), plugins_root) {
                    ResolveResult::Ok(resolved) => resolved,
                    ResolveResult::NotFound => continue,
                    ResolveResult::Forbidden => return Err(PanelFilesError::Forbidden(path)),
                };
            if !resolved.starts_with(&panel_root) {
                log::warn!(
                    "[AUDIT] event=plugin_panel_outside_folder plugin_id={plugin_id} \
                     panel_id={panel_id} path={path}"
                );
                return Err(PanelFilesError::Forbidden(path));
            }
            let metadata = std::fs::metadata(&resolved)?;
            if !metadata.is_file() {
                continue;
            }
            total += metadata.len();
            if files.len() == MAX_BUNDLE_FILES || total > MAX_BUNDLE_BYTES as u64 {
                return Err(PanelFilesError::TooLarge);
            }
            files.push(PanelFile {
                path,
                bytes: std::fs::read(&resolved)?,
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup(tmp: &TempDir, plugin_id: &str, panel_id: &str, filename: &str) -> PathBuf {
        let panel_dir = tmp.path().join(plugin_id).join("panels").join(panel_id);
        fs::create_dir_all(&panel_dir).unwrap();
        let file = panel_dir.join(filename);
        fs::write(&file, b"hello").unwrap();
        file
    }

    #[test]
    fn happy_path_resolves_to_file() {
        let tmp = TempDir::new().unwrap();
        setup(&tmp, "dev.example.hello", "main", "index.html");

        let result = resolve_plugin_uri("dev.example.hello/main/index.html", tmp.path());
        assert!(
            matches!(result, ResolveResult::Ok(_)),
            "expected Ok, got {:?}",
            result
        );
    }

    #[test]
    fn dotdot_in_plugin_id_is_forbidden() {
        let tmp = TempDir::new().unwrap();
        let result = resolve_plugin_uri("../evil/main/index.html", tmp.path());
        assert_eq!(result, ResolveResult::Forbidden);
    }

    #[test]
    fn dotdot_in_panel_id_is_forbidden() {
        let tmp = TempDir::new().unwrap();
        let result = resolve_plugin_uri("dev.example.hello/../../../etc/passwd", tmp.path());
        assert_eq!(result, ResolveResult::Forbidden);
    }

    #[test]
    fn dotdot_in_rest_is_forbidden() {
        let tmp = TempDir::new().unwrap();
        let result = resolve_plugin_uri("dev.example.hello/main/../../etc/shadow", tmp.path());
        assert_eq!(result, ResolveResult::Forbidden);
    }

    #[test]
    fn percent_encoded_dotdot_is_forbidden() {
        let tmp = TempDir::new().unwrap();
        let result = resolve_plugin_uri("%2e%2e/main/index.html", tmp.path());
        assert_eq!(result, ResolveResult::Forbidden);
    }

    #[test]
    fn percent_encoded_slash_in_rest_is_forbidden() {
        let tmp = TempDir::new().unwrap();
        let result = resolve_plugin_uri("dev.example.hello/main/%2fetc%2fpasswd", tmp.path());
        assert_eq!(result, ResolveResult::Forbidden);
    }

    #[test]
    fn missing_file_returns_not_found() {
        let tmp = TempDir::new().unwrap();
        // Create plugin dir but no file inside it
        let panel_dir = tmp
            .path()
            .join("dev.example.hello")
            .join("panels")
            .join("main");
        fs::create_dir_all(&panel_dir).unwrap();

        let result = resolve_plugin_uri("dev.example.hello/main/nonexistent.html", tmp.path());
        assert_eq!(result, ResolveResult::NotFound);
    }

    #[test]
    fn plugin_not_installed_returns_not_found() {
        let tmp = TempDir::new().unwrap();
        // No directory at all
        let result = resolve_plugin_uri("dev.example.missing/main/index.html", tmp.path());
        assert_eq!(result, ResolveResult::NotFound);
    }

    #[test]
    fn too_few_segments_forbidden() {
        let tmp = TempDir::new().unwrap();
        // Only plugin_id and panel_id, no rest
        let result = resolve_plugin_uri("dev.example.hello/main", tmp.path());
        assert_eq!(result, ResolveResult::Forbidden);
    }

    #[test]
    fn empty_plugin_id_is_forbidden() {
        let tmp = TempDir::new().unwrap();
        let result = resolve_plugin_uri("/main/index.html", tmp.path());
        assert_eq!(result, ResolveResult::Forbidden);
    }

    #[test]
    fn serves_the_frame_shell_with_its_policy() {
        let asset = shell_asset("shell/v1/index.html").expect("index");
        assert!(asset.media_type.starts_with("text/html"));
        let index = std::str::from_utf8(asset.bytes).unwrap();
        assert!(index.contains(SHELL_POLICY));
        // A CORS load from a source the policy names, so WebKit runs it in the
        // null-origin frame.
        assert!(index.contains(r#"<script src="shell.js" crossorigin"#));
        assert!(SHELL_POLICY.contains("script-src 'self' rim-plugin://shell blob:"));
        assert!(shell_asset("/shell/v1/shell.js").is_some());
        assert!(shell_asset("shell/v1/../../etc/passwd").is_none());
        assert!(shell_asset("shell/v2/index.html").is_none());
    }

    /// The headers of `respond(path)`, by lowercase name.
    fn headers_of(path: &str) -> (u16, std::collections::HashMap<String, String>) {
        let response = respond(path);
        let headers = response
            .headers()
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_str().unwrap().to_owned()))
            .collect();
        (response.status().as_u16(), headers)
    }

    #[test]
    fn shell_responses_carry_their_policy_and_only_the_script_allows_any_origin() {
        for (path, policy, any_origin) in [
            ("shell/v1/index.html", SHELL_POLICY, false),
            ("shell/v1/", SHELL_POLICY, false),
            ("shell/v1/local-panel.html", LOCAL_PANEL_POLICY, false),
            ("/shell/v1/shell.js", SHELL_POLICY, true),
        ] {
            let (status, headers) = headers_of(path);
            assert_eq!(status, 200, "{path}");
            assert_eq!(headers["content-security-policy"], policy, "{path}");
            assert_eq!(
                headers
                    .get("access-control-allow-origin")
                    .map(String::as_str),
                any_origin.then_some("*"),
                "{path}"
            );
            assert_eq!(headers["x-content-type-options"], "nosniff");
            assert_eq!(headers["referrer-policy"], "no-referrer");
            assert_eq!(
                headers["content-type"],
                shell_asset(path).unwrap().media_type
            );
        }
        assert_eq!(
            shell_asset("shell/v1/local-panel.html").unwrap().bytes,
            shell_asset("shell/v1/index.html").unwrap().bytes
        );
    }

    #[test]
    fn a_local_panel_gets_no_network_and_nothing_looser_than_the_shell() {
        let directives: Vec<&str> = LOCAL_PANEL_POLICY.split("; ").collect();
        for closed in [
            "default-src 'none'",
            "connect-src 'none'",
            "worker-src 'none'",
            "frame-src 'none'",
            "form-action 'none'",
            "base-uri 'none'",
        ] {
            assert!(directives.contains(&closed), "{closed}");
        }
        for open in [
            "https:",
            "wss:",
            "http:",
            "ws:",
            "*",
            "unsafe-eval",
            "wasm-unsafe-eval",
        ] {
            assert!(
                !LOCAL_PANEL_POLICY
                    .split([' ', ';'])
                    .any(|t| t.trim_matches('\'') == open),
                "{open}"
            );
        }
        // Every source it allows, the shell's policy allows for that directive too.
        let sources = |policy: &'static str, directive: &str| -> Vec<&'static str> {
            policy
                .split("; ")
                .find_map(|d| d.strip_prefix(directive))
                .map(|rest| rest.split(' ').filter(|s| !s.is_empty()).collect())
                .unwrap_or_default()
        };
        for directive in [
            "script-src ",
            "style-src ",
            "img-src ",
            "font-src ",
            "media-src ",
        ] {
            for source in sources(LOCAL_PANEL_POLICY, directive) {
                assert!(
                    sources(SHELL_POLICY, directive).contains(&source),
                    "{directive}{source}"
                );
            }
        }
    }

    #[test]
    fn panel_files_are_not_served_over_the_scheme() {
        let response = respond("dev.example.hello/main/index.html");
        assert_eq!(response.status(), 404);
        assert!(response
            .headers()
            .get("Access-Control-Allow-Origin")
            .is_none());
    }

    /// A panel folder `dev.example.hello/panels/main/` holding `files`.
    fn panel(files: &[(&str, &str)]) -> TempDir {
        let tmp = TempDir::new().unwrap();
        for (path, text) in files {
            let file = tmp.path().join("dev.example.hello/panels/main").join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, text).unwrap();
        }
        tmp
    }

    #[test]
    fn reads_every_panel_file_sorted_by_path() {
        let tmp = panel(&[
            ("index.html", "<script src=app.js></script>"),
            ("app.js", "run()"),
            ("img/logo.svg", "<svg/>"),
        ]);
        let files = read_panel_files(tmp.path(), "dev.example.hello", "main").unwrap();
        let read: Vec<(&str, &[u8])> = files
            .iter()
            .map(|f| (f.path.as_str(), f.bytes.as_slice()))
            .collect();
        assert_eq!(
            read,
            [
                ("app.js", &b"run()"[..]),
                ("img/logo.svg", b"<svg/>"),
                ("index.html", b"<script src=app.js></script>"),
            ]
        );
    }

    #[test]
    fn panel_ids_are_checked_like_uri_segments() {
        let tmp = panel(&[("index.html", "")]);
        for (plugin_id, panel_id) in [
            ("..", "main"),
            ("dev.example.hello", ".."),
            ("dev.example.hello", "%2e%2e"),
            ("dev.example.hello", "main/../main"),
            ("", "main"),
        ] {
            assert!(
                matches!(
                    read_panel_files(tmp.path(), plugin_id, panel_id),
                    Err(PanelFilesError::Forbidden(_))
                ),
                "{plugin_id}/{panel_id}"
            );
        }
    }

    #[test]
    fn a_missing_panel_folder_is_not_found() {
        let tmp = panel(&[("index.html", "")]);
        assert!(matches!(
            read_panel_files(tmp.path(), "dev.example.hello", "other"),
            Err(PanelFilesError::NotFound)
        ));
    }

    #[test]
    fn a_panel_over_the_file_limit_is_refused() {
        let names: Vec<String> = (0..=MAX_BUNDLE_FILES).map(|i| format!("{i}.js")).collect();
        let files: Vec<(&str, &str)> = names.iter().map(|n| (n.as_str(), "")).collect();
        let tmp = panel(&files);
        assert!(matches!(
            read_panel_files(tmp.path(), "dev.example.hello", "main"),
            Err(PanelFilesError::TooLarge)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_plugin_fails_the_read() {
        let tmp = panel(&[("index.html", "")]);
        fs::write(tmp.path().join("secret.txt"), b"secret").unwrap();
        std::os::unix::fs::symlink(
            tmp.path().join("secret.txt"),
            tmp.path().join("dev.example.hello/panels/main/app.js"),
        )
        .unwrap();
        assert!(matches!(
            read_panel_files(tmp.path(), "dev.example.hello", "main"),
            Err(PanelFilesError::Forbidden(path)) if path == "app.js"
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_to_another_file_of_the_plugin_fails_the_read() {
        let tmp = panel(&[("index.html", "")]);
        let plugin = tmp.path().join("dev.example.hello");
        fs::write(plugin.join("rim-plugin.json"), b"{}").unwrap();
        std::os::unix::fs::symlink(
            plugin.join("rim-plugin.json"),
            plugin.join("panels/main/manifest.json"),
        )
        .unwrap();
        assert!(matches!(
            read_panel_files(tmp.path(), "dev.example.hello", "main"),
            Err(PanelFilesError::Forbidden(path)) if path == "manifest.json"
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_panel_folder_that_is_a_link_fails_the_read() {
        let tmp = panel(&[("index.html", "")]);
        let plugin = tmp.path().join("dev.example.hello");
        std::os::unix::fs::symlink(&plugin, plugin.join("panels/whole")).unwrap();
        assert!(matches!(
            read_panel_files(tmp.path(), "dev.example.hello", "whole"),
            Err(PanelFilesError::Forbidden(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn dangling_symlinks_and_symlinked_folders_are_skipped() {
        let tmp = panel(&[("index.html", ""), ("lib/app.js", "")]);
        let main = tmp.path().join("dev.example.hello/panels/main");
        std::os::unix::fs::symlink(main.join("gone.js"), main.join("dangling.js")).unwrap();
        std::os::unix::fs::symlink(main.join("lib"), main.join("again")).unwrap();
        let files = read_panel_files(tmp.path(), "dev.example.hello", "main").unwrap();
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["index.html", "lib/app.js"]);
    }

    #[test]
    fn is_safe_segment_rejects_empty() {
        assert!(!is_safe_segment(""));
    }

    #[test]
    fn is_safe_segment_rejects_dotdot() {
        assert!(!is_safe_segment(".."));
    }

    #[test]
    fn is_safe_segment_rejects_encoded_dotdot_lower() {
        assert!(!is_safe_segment("%2e%2e"));
    }

    #[test]
    fn is_safe_segment_rejects_encoded_dotdot_upper() {
        assert!(!is_safe_segment("%2E%2E"));
    }

    #[test]
    fn is_safe_segment_allows_normal_filename() {
        assert!(is_safe_segment("index.html"));
        assert!(is_safe_segment("app.js"));
        assert!(is_safe_segment("dev.example.hello"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_outside_root_is_forbidden() {
        use std::os::unix::fs::symlink;

        let tmp = TempDir::new().unwrap();
        let plugin_id = "dev.example.hello";
        let panel_id = "main";

        // Create the panel directory
        let panel_dir = tmp.path().join(plugin_id).join("panels").join(panel_id);
        fs::create_dir_all(&panel_dir).unwrap();

        // Create a file outside the plugin bundle that the symlink will point to
        let outside_file = tmp.path().join("secret.txt");
        fs::write(&outside_file, b"secret").unwrap();

        // Create a symlink inside the panel directory pointing outside
        let symlink_path = panel_dir.join("escape.html");
        symlink(&outside_file, &symlink_path).unwrap();

        let result = resolve_plugin_uri(
            &format!("{}/{}/escape.html", plugin_id, panel_id),
            tmp.path(),
        );
        // The symlink target is outside the plugin root — canonicalize will
        // resolve it and the starts_with check will reject it.
        // (In this test the "outside" file is still under tmp.path() which is
        // the plugins_root, so it is within the overall tmp dir — but it is
        // outside the plugin-specific root `tmp/<plugin_id>/`.)
        assert_eq!(result, ResolveResult::Forbidden);
    }
}
