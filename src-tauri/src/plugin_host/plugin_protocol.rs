//! URI resolution for the `rim-plugin://` Tauri asset-protocol scheme.
//!
//! The scheme maps `rim-plugin://<plugin_id>/<panel_id>/<rest>` to the
//! filesystem path `~/.rim/plugins/<plugin_id>/panels/<panel_id>/<rest>`.
//!
//! ## Security model
//!
//! - Every path segment is validated individually before joining.
//! - Any segment containing `..`, `/`, `\`, NUL, or percent-encoded
//!   equivalents is rejected with a 403 before any filesystem access.
//! - After joining the segments the resulting path is canonicalized and
//!   asserted to still be under the plugin's bundle root.  This closes
//!   symlink-escape vectors.
//! - Only the active plugin's directory is accessible — cross-plugin reads
//!   are rejected by the segment-matching logic (the plugin_id in the URI
//!   must match the plugin_id component of the resolved path root).

use std::path::{Path, PathBuf};

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
