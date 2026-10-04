//! Validation and argv construction for every `git` invocation made by the
//! plugin host (S-H2).
//!
//! The install URL and branch come straight from the renderer, so they are
//! untrusted. Before anything is spawned:
//!
//! - the URL must be `https://…`, `ssh://…` or scp-like `user@host:owner/repo`;
//!   `ext::`, `fd::`, `file://`, anything containing `::`, anything starting
//!   with `-`, and any whitespace / control / non-ASCII character is rejected;
//! - the branch must match a conservative ref-name allowlist and must not start
//!   with `-`;
//! - every argv puts a literal `--` before positional arguments;
//! - every child gets `GIT_ALLOW_PROTOCOL=https:ssh` (so git itself refuses any
//!   other transport, including through redirects or submodules) and
//!   `GIT_TERMINAL_PROMPT=0` (so a credential prompt can never hang the host).
//!
//! Everything here except [`git_command`] is a pure function so it can be
//! unit-tested without running git.

use std::ffi::OsString;
use std::path::Path;

/// Transports git may use for plugin installs/updates. `git://` is deliberately
/// excluded: it is unauthenticated and unencrypted.
pub const GIT_ALLOWED_PROTOCOLS: &str = "https:ssh";

/// Environment applied to every git child process.
pub const HARDENED_GIT_ENV: [(&str, &str); 2] = [
    ("GIT_ALLOW_PROTOCOL", GIT_ALLOWED_PROTOCOLS),
    ("GIT_TERMINAL_PROMPT", "0"),
];

const MAX_URL_LEN: usize = 2048;
const MAX_BRANCH_LEN: usize = 255;

const ACCEPTED_FORMS: &str = "only https://, ssh:// or git@host:owner/repo URLs are accepted";

/// Validate a plugin repository URL. Returns a human-readable reason on
/// rejection (it never echoes the URL back, so control characters cannot leak
/// into the UI or logs).
pub fn validate_git_url(url: &str) -> Result<(), String> {
    if url.is_empty() {
        return Err("URL is empty".into());
    }
    if url.len() > MAX_URL_LEN {
        return Err(format!("URL is longer than {MAX_URL_LEN} characters"));
    }
    if !url.chars().all(|c| c.is_ascii_graphic()) {
        return Err("URL contains whitespace, control or non-ASCII characters".into());
    }
    if url.starts_with('-') {
        return Err("URL must not start with '-'".into());
    }
    if url.contains("::") {
        // ext::, fd:: and any other `<transport>::<address>` remote-helper form.
        return Err(format!(
            "remote-helper syntax ('::') is not allowed; {ACCEPTED_FORMS}"
        ));
    }

    let lower = url.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("https://") {
        return validate_hierarchical(&url[url.len() - rest.len()..]);
    }
    if let Some(rest) = lower.strip_prefix("ssh://") {
        return validate_hierarchical(&url[url.len() - rest.len()..]);
    }
    if lower.contains("://") {
        // file://, git://, http://, ftp://, … — none are allowed.
        return Err(format!("unsupported URL scheme; {ACCEPTED_FORMS}"));
    }
    validate_scp_like(url)
}

/// `[user[:password]@]host[:port]/path` after the scheme.
fn validate_hierarchical(rest: &str) -> Result<(), String> {
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let host_port = match authority.rfind('@') {
        Some(i) => {
            let user = &authority[..i];
            if user.is_empty() || user.starts_with('-') {
                return Err("invalid user name in URL".into());
            }
            &authority[i + 1..]
        }
        None => authority,
    };
    let host = match host_port.split_once(':') {
        Some((h, port)) => {
            if port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
                return Err("invalid port in URL".into());
            }
            h
        }
        None => host_port,
    };
    validate_host(host)?;
    if path.len() <= 1 {
        return Err("URL has no repository path".into());
    }
    Ok(())
}

/// scp-like `user@host:owner/repo(.git)`.
fn validate_scp_like(url: &str) -> Result<(), String> {
    let (user, rest) = url
        .split_once('@')
        .ok_or_else(|| ACCEPTED_FORMS.to_string())?;
    let (host, path) = rest
        .split_once(':')
        .ok_or_else(|| ACCEPTED_FORMS.to_string())?;

    let user_ok = !user.is_empty()
        && !user.starts_with('-')
        && user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !user_ok {
        return Err("invalid user name in URL".into());
    }
    validate_host(host)?;

    let path_ok = !path.is_empty()
        && !path.starts_with('-')
        && !path.starts_with('/')
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | '~'));
    if !path_ok {
        return Err("invalid repository path in URL".into());
    }
    Ok(())
}

fn validate_host(host: &str) -> Result<(), String> {
    let ok = !host.is_empty()
        && !host.starts_with('-')
        && !host.starts_with('.')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'));
    if ok {
        Ok(())
    } else {
        Err("invalid host name in URL".into())
    }
}

/// Validate a branch (or tag) name passed to `git clone --branch`.
pub fn validate_git_branch(branch: &str) -> Result<(), String> {
    if branch.is_empty() {
        return Err("branch is empty".into());
    }
    if branch.len() > MAX_BRANCH_LEN {
        return Err(format!("branch is longer than {MAX_BRANCH_LEN} characters"));
    }
    if branch.starts_with('-') {
        return Err("branch must not start with '-'".into());
    }
    if !branch
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/'))
    {
        return Err("branch may only contain letters, digits, '.', '_', '-' and '/'".into());
    }
    if branch.starts_with('/')
        || branch.starts_with('.')
        || branch.ends_with('/')
        || branch.ends_with('.')
        || branch.contains("..")
        || branch.contains("//")
        || branch.contains("/.")
    {
        return Err("branch is not a valid ref name".into());
    }
    Ok(())
}

/// argv (excluding the `git` program) for a shallow clone. Callers must have
/// validated `url` and `branch` first; the `--` is a second line of defence so
/// that even an unvalidated value can never be parsed as an option.
pub fn clone_args(url: &str, branch: Option<&str>, dest: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["clone".into(), "--depth".into(), "1".into()];
    if let Some(b) = branch {
        args.push(format!("--branch={b}").into());
    }
    args.push("--".into());
    args.push(url.into());
    args.push(dest.as_os_str().to_os_string());
    args
}

/// Upstream of the current branch — the only revision `update` ever looks at.
pub const UPSTREAM_REV: &str = "@{upstream}";

/// argv for fetching the configured upstream (no caller-controlled values).
pub fn fetch_args() -> Vec<OsString> {
    vec!["fetch".into(), "--quiet".into()]
}

/// argv listing the top-level entries of the fetched upstream tree, used to
/// decide whether an update would need post-install steps before merging it.
pub fn ls_upstream_tree_args() -> Vec<OsString> {
    vec![
        "ls-tree".into(),
        "--name-only".into(),
        "--".into(),
        UPSTREAM_REV.into(),
    ]
}

/// argv fast-forwarding the working tree to the fetched upstream.
pub fn merge_upstream_args() -> Vec<OsString> {
    vec![
        "merge".into(),
        "--ff-only".into(),
        "--quiet".into(),
        "--".into(),
        UPSTREAM_REV.into(),
    ]
}

/// A `git` command with the hardened environment applied.
pub fn git_command() -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("git");
    for (key, value) in HARDENED_GIT_ENV {
        cmd.env(key, value);
    }
    cmd.stdin(std::process::Stdio::null());
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_supported_url_forms() {
        for url in [
            "https://github.com/user/my-rim-plugin",
            "https://github.com/user/my-rim-plugin.git",
            "HTTPS://github.com/user/repo",
            "https://gitlab.example.com:8443/group/sub/repo.git",
            "https://user@git.example.com/repo",
            "ssh://git@github.com/user/repo.git",
            "ssh://git@host.example.com:2222/owner/repo",
            "git@github.com:user/repo.git",
            "git@github.com:user/repo",
            "org-1234@github.com:org/repo.git",
        ] {
            assert!(validate_git_url(url).is_ok(), "should accept {url}");
        }
    }

    #[test]
    fn rejects_dangerous_or_unsupported_urls() {
        for url in [
            "",
            "ext::sh -c id",
            "ext::sh -c id>/tmp/pwned",
            "ext::sh",
            "fd::17",
            "https::github.com/user/repo",
            "--upload-pack=touch /tmp/pwned",
            "-uhttps://github.com/x/y",
            "file:///etc",
            "FILE:///etc",
            "git://github.com/user/repo",
            "http://github.com/user/repo",
            "/tmp/some/local/repo",
            "./relative",
            "github.com:user/repo",
            "https://github.com/user/repo\n--upload-pack=x",
            "https://github.com/user/repo\r",
            "https://github.com/user/my repo",
            "https://github.com/user/r\u{0}epo",
            "https://gïthub.com/user/repo",
            "https://-oProxyCommand=id/repo",
            "ssh://-oProxyCommand=id/repo",
            "ssh://git@-oProxyCommand=id/repo",
            "git@-oProxyCommand=id:repo",
            "-oProxyCommand=id@host:repo",
            "git@host:-u/repo",
            "git@host:/abs/path",
            "https://github.com",
            "https://github.com/",
            "https://github.com:abc/user/repo",
        ] {
            assert!(validate_git_url(url).is_err(), "should reject {url:?}");
        }
    }

    #[test]
    fn rejection_reason_never_echoes_the_url() {
        let err = validate_git_url("https://x.com/a\nINJECTED").unwrap_err();
        assert!(!err.contains("INJECTED"));
        assert!(!err.contains('\n'));
    }

    #[test]
    fn rejects_overlong_url() {
        let url = format!("https://github.com/{}", "a".repeat(MAX_URL_LEN));
        assert!(validate_git_url(&url).is_err());
    }

    #[test]
    fn accepts_conventional_branch_names() {
        for b in [
            "main",
            "v1.2.3",
            "feature/new-ui",
            "release_2026",
            "a-b.c/d_e",
        ] {
            assert!(validate_git_branch(b).is_ok(), "should accept {b}");
        }
    }

    #[test]
    fn rejects_unsafe_branch_names() {
        for b in [
            "",
            "-x",
            "--upload-pack=id",
            "main branch",
            "main\n",
            "a..b",
            "/main",
            "main/",
            ".hidden",
            "main.",
            "a//b",
            "a/.b",
            "refs@{0}",
            "a:b",
            "a~1",
            "a^",
            "a\\b",
            "ext::sh",
        ] {
            assert!(validate_git_branch(b).is_err(), "should reject {b:?}");
        }
    }

    #[test]
    fn clone_args_put_double_dash_before_url_and_dir() {
        let args = clone_args(
            "https://github.com/u/r",
            Some("main"),
            Path::new("/tmp/stage"),
        );
        let args: Vec<String> = args
            .into_iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "clone",
                "--depth",
                "1",
                "--branch=main",
                "--",
                "https://github.com/u/r",
                "/tmp/stage"
            ]
        );
        let dd = args.iter().position(|a| a == "--").unwrap();
        let url = args
            .iter()
            .position(|a| a == "https://github.com/u/r")
            .unwrap();
        assert!(dd < url);
    }

    #[test]
    fn clone_args_without_branch_still_separate_positionals() {
        let args = clone_args("--upload-pack=id", None, Path::new("/d"));
        let args: Vec<String> = args
            .into_iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        // Even an (unvalidated) option-shaped value lands after `--`.
        assert_eq!(
            args,
            ["clone", "--depth", "1", "--", "--upload-pack=id", "/d"]
        );
    }

    #[test]
    fn update_args_take_no_caller_input_and_separate_positionals() {
        assert_eq!(fetch_args(), [OsString::from("fetch"), "--quiet".into()]);
        let ls = ls_upstream_tree_args();
        assert_eq!(ls[ls.len() - 2], OsString::from("--"));
        assert_eq!(ls[ls.len() - 1], OsString::from(UPSTREAM_REV));
        let merge = merge_upstream_args();
        assert!(merge.contains(&OsString::from("--ff-only")));
        assert_eq!(merge[merge.len() - 2], OsString::from("--"));
    }

    #[test]
    fn git_command_sets_hardened_env() {
        let cmd = git_command();
        let envs: Vec<(String, String)> = cmd
            .as_std()
            .get_envs()
            .filter_map(|(k, v)| {
                Some((
                    k.to_string_lossy().into_owned(),
                    v?.to_string_lossy().into_owned(),
                ))
            })
            .collect();
        assert!(envs.contains(&("GIT_ALLOW_PROTOCOL".into(), "https:ssh".into())));
        assert!(envs.contains(&("GIT_TERMINAL_PROMPT".into(), "0".into())));
        assert_eq!(cmd.as_std().get_program(), "git");
    }
}
