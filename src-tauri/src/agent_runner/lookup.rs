//! Finding programs: on the host's `PATH` by name, or checking a full path.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// How long the login shell has to print its `PATH`.
#[cfg(target_os = "macos")]
const LOGIN_SHELL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// The suffixes Windows tries when `PATHEXT` is not set.
#[cfg(windows)]
const DEFAULT_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD";

/// The directories a bare program name is looked up in, in order: the `PATH` the app's children
/// get, then, on macOS, the entries only the login shell's `PATH` has. Relative entries are left
/// out, because what they name depends on the working folder.
pub(crate) async fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = crate::host_env::host_path()
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    #[cfg(target_os = "macos")]
    for dir in login_shell_path().await {
        if !dirs.contains(dir) {
            dirs.push(dir.clone());
        }
    }
    dirs.retain(|dir| dir.is_absolute());
    dirs
}

/// The login shell's `PATH` entries, read once: `$SHELL -lc 'printf %s "$PATH"'`, given
/// [`LOGIN_SHELL_TIMEOUT`]. Empty when there is no `SHELL` or it fails or takes too long.
#[cfg(target_os = "macos")]
async fn login_shell_path() -> &'static [PathBuf] {
    static PATH: tokio::sync::OnceCell<Vec<PathBuf>> = tokio::sync::OnceCell::const_new();
    PATH.get_or_init(|| async {
        let Some(shell) = std::env::var_os("SHELL").filter(|shell| !shell.is_empty()) else {
            return Vec::new();
        };
        let output = tokio::process::Command::new(shell)
            .args(["-lc", "printf %s \"$PATH\""])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .output();
        match tokio::time::timeout(LOGIN_SHELL_TIMEOUT, output).await {
            Ok(Ok(output)) if output.status.success() => {
                let text = String::from_utf8_lossy(&output.stdout).into_owned();
                std::env::split_paths(text.trim()).collect()
            }
            _ => Vec::new(),
        }
    })
    .await
}

/// The suffixes a bare name may need to run, from `PATHEXT`: `None` where names run as they are.
pub(crate) fn path_extensions() -> Option<Vec<String>> {
    #[cfg(windows)]
    {
        let value = std::env::var("PATHEXT")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_PATHEXT.to_owned());
        Some(
            value
                .split(';')
                .map(str::trim)
                .filter(|ext| ext.starts_with('.') && ext.len() > 1)
                .map(str::to_owned)
                .collect(),
        )
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Whether `name` is a bare program name: not empty, not `.` or `..`, and without a path
/// separator or a NUL.
pub(crate) fn is_bare_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', '\0'])
        && !Path::new(name).is_absolute()
}

/// Looks `name` up in `dirs`, in order.
///
/// With `extensions` (Windows), each directory is tried with the name as given when it already
/// ends in one of them, then with each of them appended, and any regular file counts. Without, a
/// file counts when it is regular and executable.
///
/// # Returns
///
/// The first match, or `None` when there is none or `name` is not a bare name.
pub(crate) fn find_in(
    name: &str,
    dirs: &[PathBuf],
    extensions: Option<&[String]>,
) -> Option<PathBuf> {
    if !is_bare_name(name) {
        return None;
    }
    for dir in dirs {
        match extensions {
            None => {
                let candidate = dir.join(name);
                if is_executable_file(&candidate) {
                    return Some(candidate);
                }
            }
            Some(extensions) => {
                let lower = name.to_ascii_lowercase();
                let has_extension = extensions
                    .iter()
                    .any(|ext| lower.ends_with(&ext.to_ascii_lowercase()));
                let mut candidates = Vec::new();
                if has_extension {
                    candidates.push(dir.join(name));
                }
                for ext in extensions {
                    let mut file = OsString::from(name);
                    file.push(ext);
                    candidates.push(dir.join(file));
                }
                if let Some(found) = candidates.into_iter().find(|path| path.is_file()) {
                    return Some(found);
                }
            }
        }
    }
    None
}

/// Whether `path`, after symlinks, is a regular file this user may run: on Unix, any of its
/// execute bits is set; elsewhere, any regular file.
pub(crate) fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn file(dir: &Path, name: &str, executable: bool) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = if executable { 0o755 } else { 0o644 };
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
        }
        #[cfg(not(unix))]
        let _ = executable;
        path
    }

    #[test]
    fn bare_names_have_no_separators() {
        assert!(is_bare_name("claude"));
        assert!(is_bare_name("gemini-cli.exe"));
        assert!(!is_bare_name(""));
        assert!(!is_bare_name("."));
        assert!(!is_bare_name(".."));
        assert!(!is_bare_name("bin/claude"));
        assert!(!is_bare_name("bin\\claude"));
        assert!(!is_bare_name("/usr/bin/claude"));
        assert!(!is_bare_name("a\0b"));
    }

    #[cfg(unix)]
    #[test]
    fn finds_the_first_executable_in_path_order() {
        let first = TempDir::new().unwrap();
        let second = TempDir::new().unwrap();
        file(first.path(), "agent", false);
        let wanted = file(second.path(), "agent", true);
        file(first.path(), "other", true);
        let dirs = vec![first.path().to_path_buf(), second.path().to_path_buf()];

        assert_eq!(find_in("agent", &dirs, None), Some(wanted));
        assert_eq!(
            find_in("other", &dirs, None),
            Some(first.path().join("other"))
        );
        assert_eq!(find_in("missing", &dirs, None), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_directory_or_a_path_is_not_a_match() {
        let dir = TempDir::new().unwrap();
        std::fs::create_dir(dir.path().join("agent")).unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        file(&sub, "tool", true);
        let dirs = vec![dir.path().to_path_buf()];

        assert_eq!(find_in("agent", &dirs, None), None);
        assert_eq!(find_in("sub/tool", &dirs, None), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_to_an_executable_is_a_match() {
        let dir = TempDir::new().unwrap();
        let target = file(dir.path(), "real", true);
        let bin = dir.path().join("bin");
        std::fs::create_dir(&bin).unwrap();
        std::os::unix::fs::symlink(&target, bin.join("agent")).unwrap();

        assert_eq!(
            find_in("agent", std::slice::from_ref(&bin), None),
            Some(bin.join("agent"))
        );
    }

    #[test]
    fn extensions_are_tried_in_order() {
        let dir = TempDir::new().unwrap();
        file(dir.path(), "npx.cmd", false);
        file(dir.path(), "npx.exe", false);
        file(dir.path(), "tool.exe", false);
        let exts = vec![".com".to_owned(), ".exe".to_owned(), ".cmd".to_owned()];
        let dirs = vec![dir.path().to_path_buf()];

        assert_eq!(
            find_in("npx", &dirs, Some(&exts)),
            Some(dir.path().join("npx.exe"))
        );
        assert_eq!(
            find_in("tool.exe", &dirs, Some(&exts)),
            Some(dir.path().join("tool.exe"))
        );
        assert_eq!(find_in("tool.bat", &dirs, Some(&exts)), None);
        assert_eq!(find_in("missing", &dirs, Some(&exts)), None);
    }
}
