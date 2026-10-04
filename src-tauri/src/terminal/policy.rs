//! Spawn policy for terminal sessions (S-H1).
//!
//! `terminal_create` is reachable from any renderer JS, so its inputs are
//! untrusted:
//!
//! - **shell** — never an arbitrary path. Unix: the caller's value is accepted
//!   only if it is exactly an entry of `/etc/shells`; with no value, `$SHELL`
//!   is used if it is listed there, else `/bin/sh`. Windows: only a fixed
//!   allowlist of shells.
//! - **cwd** — must be an existing directory inside the user's home directory
//!   (after canonicalisation, so `..` and symlinks cannot escape).
//! - **first use** — a native confirmation dialog must be accepted once per app
//!   run before any session is spawned; see [`TerminalApproval`].
//!
//! The functions here are pure (or touch only the filesystem for
//! canonicalisation) so they can be tested without spawning a PTY.

use std::future::Future;
use std::path::{Path, PathBuf};

/// Fallback when `$SHELL` is unset or not listed in `/etc/shells`.
pub const UNIX_FALLBACK_SHELL: &str = "/bin/sh";

/// Shells a Windows caller may name. Bare names are resolved on `PATH` (or
/// `%COMSPEC%` for `cmd.exe`) by the caller of [`select_windows_shell`].
pub const WINDOWS_SHELL_ALLOWLIST: [&str; 3] = ["pwsh.exe", "powershell.exe", "cmd.exe"];

/// Parse `/etc/shells`: one absolute path per line, `#` comments, blank lines.
pub fn parse_etc_shells(contents: &str) -> Vec<String> {
    contents
        .lines()
        .map(|l| l.split('#').next().unwrap_or("").trim())
        .filter(|l| l.starts_with('/'))
        .map(str::to_string)
        .collect()
}

/// Choose the Unix shell. `requested` (blank counts as absent) must exactly
/// match an `/etc/shells` entry; otherwise `$SHELL` if listed, else `/bin/sh`.
pub fn select_unix_shell(
    requested: Option<&str>,
    allowed: &[String],
    env_shell: Option<&str>,
) -> Result<String, String> {
    if let Some(req) = requested.map(str::trim).filter(|r| !r.is_empty()) {
        return if allowed.iter().any(|a| a == req) {
            Ok(req.to_string())
        } else {
            Err(format!(
                "shell '{req}' is not listed in /etc/shells; choose one of: {}",
                allowed.join(", ")
            ))
        };
    }
    match env_shell {
        Some(s) if allowed.iter().any(|a| a == s) => Ok(s.to_string()),
        _ => Ok(UNIX_FALLBACK_SHELL.to_string()),
    }
}

/// Choose the Windows shell. `requested` must case-insensitively equal one of
/// [`WINDOWS_SHELL_ALLOWLIST`]; `resolve` maps an allowlisted name to a full
/// path (or `None` if not installed). With no request, the first installed
/// entry of the allowlist wins (PowerShell 7, Windows PowerShell, cmd.exe).
pub fn select_windows_shell(
    requested: Option<&str>,
    resolve: impl Fn(&str) -> Option<String>,
) -> Result<String, String> {
    if let Some(req) = requested.map(str::trim).filter(|r| !r.is_empty()) {
        let name = WINDOWS_SHELL_ALLOWLIST
            .iter()
            .find(|n| n.eq_ignore_ascii_case(req))
            .ok_or_else(|| {
                format!(
                    "shell '{req}' is not allowed; choose one of: {}",
                    WINDOWS_SHELL_ALLOWLIST.join(", ")
                )
            })?;
        return resolve(name).ok_or_else(|| format!("shell '{name}' is not installed"));
    }
    Ok(WINDOWS_SHELL_ALLOWLIST
        .iter()
        .find_map(|n| resolve(n))
        .unwrap_or_else(|| "cmd.exe".to_string()))
}

/// Validate the working directory: absent → `home`; present → must exist, be a
/// directory, and canonicalise to `home` or below.
pub fn select_cwd(requested: Option<&str>, home: &Path) -> Result<PathBuf, String> {
    let home =
        std::fs::canonicalize(home).map_err(|e| format!("cannot resolve home directory: {e}"))?;
    let Some(req) = requested.map(str::trim).filter(|r| !r.is_empty()) else {
        return Ok(home);
    };
    let path = std::fs::canonicalize(req)
        .map_err(|_| format!("working directory does not exist: {req}"))?;
    if !path.is_dir() {
        return Err(format!("working directory is not a directory: {req}"));
    }
    if !path.starts_with(&home) {
        return Err(format!(
            "working directory must be inside your home directory: {req}"
        ));
    }
    Ok(path)
}

/// Process-lifetime record of the user's "allow terminal" decision.
///
/// The lock serialises concurrent first calls so only one dialog is shown.
/// Approval is remembered until the app exits; a decline is not remembered
/// (the next attempt asks again).
#[derive(Default)]
pub struct TerminalApproval {
    approved: tokio::sync::Mutex<bool>,
}

impl TerminalApproval {
    /// Ensure the user approved terminal use, calling `prompt` (which must show
    /// a native, renderer-independent confirmation) only if not yet approved.
    pub async fn ensure<F, Fut>(&self, prompt: F) -> Result<(), String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = bool>,
    {
        let mut approved = self.approved.lock().await;
        if *approved {
            return Ok(());
        }
        if prompt().await {
            *approved = true;
            log::warn!("[AUDIT] event=terminal_approved_for_session");
            Ok(())
        } else {
            log::warn!("[AUDIT] event=terminal_request_declined");
            Err("terminal request was declined".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn shells() -> Vec<String> {
        parse_etc_shells(
            "# /etc/shells: valid login shells\n/bin/sh\n/bin/bash\n\n  /usr/bin/zsh  # zsh\nnot-a-path\n",
        )
    }

    #[test]
    fn parses_etc_shells() {
        assert_eq!(shells(), ["/bin/sh", "/bin/bash", "/usr/bin/zsh"]);
    }

    #[test]
    fn accepts_listed_shell_exactly() {
        assert_eq!(
            select_unix_shell(Some("/usr/bin/zsh"), &shells(), None).unwrap(),
            "/usr/bin/zsh"
        );
        assert_eq!(
            select_unix_shell(Some("  /bin/bash "), &shells(), None).unwrap(),
            "/bin/bash"
        );
    }

    #[test]
    fn rejects_unlisted_or_arbitrary_shells() {
        for req in [
            "/usr/bin/python3",
            "/bin/sh -c id",
            "/tmp/evil",
            "bash",
            "/bin/../bin/bash",
            "/usr/bin/curl",
        ] {
            assert!(
                select_unix_shell(Some(req), &shells(), Some("/bin/bash")).is_err(),
                "should reject {req:?}"
            );
        }
    }

    #[test]
    fn default_uses_listed_env_shell_else_bin_sh() {
        assert_eq!(
            select_unix_shell(None, &shells(), Some("/bin/bash")).unwrap(),
            "/bin/bash"
        );
        assert_eq!(
            select_unix_shell(Some("   "), &shells(), Some("/usr/bin/zsh")).unwrap(),
            "/usr/bin/zsh"
        );
        assert_eq!(
            select_unix_shell(None, &shells(), Some("/tmp/evil")).unwrap(),
            UNIX_FALLBACK_SHELL
        );
        assert_eq!(
            select_unix_shell(None, &shells(), None).unwrap(),
            UNIX_FALLBACK_SHELL
        );
        // Unreadable /etc/shells → nothing requested is accepted, default is /bin/sh.
        assert_eq!(
            select_unix_shell(None, &[], Some("/bin/bash")).unwrap(),
            UNIX_FALLBACK_SHELL
        );
        assert!(select_unix_shell(Some("/bin/bash"), &[], None).is_err());
    }

    fn fake_resolve(name: &str) -> Option<String> {
        match name {
            "powershell.exe" => {
                Some(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".into())
            }
            "cmd.exe" => Some(r"C:\Windows\System32\cmd.exe".into()),
            _ => None,
        }
    }

    #[test]
    fn windows_allowlist() {
        assert_eq!(
            select_windows_shell(Some("CMD.EXE"), fake_resolve).unwrap(),
            r"C:\Windows\System32\cmd.exe"
        );
        assert!(select_windows_shell(Some(r"C:\tmp\evil.exe"), fake_resolve).is_err());
        assert!(select_windows_shell(Some(r"C:\Windows\System32\cmd.exe"), fake_resolve).is_err());
        assert!(select_windows_shell(Some("python.exe"), fake_resolve).is_err());
        // Allowlisted but not installed.
        assert!(select_windows_shell(Some("pwsh.exe"), fake_resolve).is_err());
        // Default: first installed entry.
        assert_eq!(
            select_windows_shell(None, fake_resolve).unwrap(),
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        );
        assert_eq!(select_windows_shell(None, |_| None).unwrap(), "cmd.exe");
    }

    #[test]
    fn cwd_defaults_to_home_and_must_stay_inside_it() {
        let root = tempfile::TempDir::new().unwrap();
        let home = root.path().join("home");
        let sub = home.join("projects");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(home.join("file.txt"), "x").unwrap();
        let outside = root.path().join("elsewhere");
        std::fs::create_dir_all(&outside).unwrap();
        let home_c = std::fs::canonicalize(&home).unwrap();

        assert_eq!(select_cwd(None, &home).unwrap(), home_c);
        assert_eq!(select_cwd(Some(""), &home).unwrap(), home_c);
        assert_eq!(
            select_cwd(Some(sub.to_str().unwrap()), &home).unwrap(),
            home_c.join("projects")
        );

        // Missing, not a directory, outside home, and `..` escapes are rejected.
        assert!(select_cwd(Some(home.join("nope").to_str().unwrap()), &home).is_err());
        assert!(select_cwd(Some(home.join("file.txt").to_str().unwrap()), &home).is_err());
        assert!(select_cwd(Some(outside.to_str().unwrap()), &home).is_err());
        assert!(select_cwd(Some(sub.join("../../elsewhere").to_str().unwrap()), &home).is_err());
        assert!(select_cwd(Some("/"), &home).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn cwd_symlink_escape_is_rejected() {
        let root = tempfile::TempDir::new().unwrap();
        let home = root.path().join("home");
        let outside = root.path().join("outside");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, home.join("link")).unwrap();
        assert!(select_cwd(Some(home.join("link").to_str().unwrap()), &home).is_err());
    }

    #[tokio::test]
    async fn approval_prompts_once_and_is_remembered() {
        let approval = TerminalApproval::default();
        let prompts = AtomicUsize::new(0);
        for _ in 0..3 {
            approval
                .ensure(|| async {
                    prompts.fetch_add(1, Ordering::SeqCst);
                    true
                })
                .await
                .unwrap();
        }
        assert_eq!(prompts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn decline_is_an_error_and_asks_again_next_time() {
        let approval = TerminalApproval::default();
        assert!(approval.ensure(|| async { false }).await.is_err());
        let prompts = AtomicUsize::new(0);
        approval
            .ensure(|| async {
                prompts.fetch_add(1, Ordering::SeqCst);
                true
            })
            .await
            .unwrap();
        assert_eq!(prompts.load(Ordering::SeqCst), 1);
    }
}
