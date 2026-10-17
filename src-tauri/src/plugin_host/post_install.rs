//! Post-install (dependency install) steps for git-installed plugins, and the
//! consent gate in front of them.
//!
//! `npm install` and `pip install` execute code chosen by the plugin author
//! (`preinstall`/`postinstall` scripts, `setup.py`, build backends) with the
//! user's full privileges. They therefore never run implicitly: install and
//! update first *detect* which steps would run, and only run them when the
//! caller passes an explicit consent flag. Without consent the operation stops
//! with [`GitInstallError::PostInstallConsentRequired`] carrying the exact
//! steps, so the UI can show them verbatim and retry with consent.
//!
//! Detection and the consent gate are pure so they are testable without
//! spawning a package manager.

use std::future::Future;
use std::path::Path;

use serde::Serialize;

use crate::plugin_host::git_install::GitInstallError;

/// One dependency-install command, described exactly as it will be executed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PostInstallStep {
    /// Executable name, looked up on `PATH`.
    pub program: String,
    pub args: Vec<String>,
    /// Directory the command runs in.
    pub working_dir: String,
    /// The file that triggered this step (`package.json`, `requirements.txt`).
    pub trigger_file: String,
    /// Human-readable command line, e.g. `npm install --production`.
    pub command_line: String,
}

impl PostInstallStep {
    fn new(program: &str, args: &[&str], working_dir: &Path, trigger_file: &str) -> Self {
        let args: Vec<String> = args.iter().map(|a| (*a).to_string()).collect();
        let command_line = std::iter::once(program.to_string())
            .chain(args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" ");
        Self {
            program: program.to_string(),
            args,
            working_dir: working_dir.display().to_string(),
            trigger_file: trigger_file.to_string(),
            command_line,
        }
    }
}

/// Returns the steps implied by a set of top-level file names, to be run in
/// `run_dir`.
///
/// `package.json` triggers `npm install --production`, `requirements.txt`
/// triggers `pip install -r requirements.txt --user`. Order is stable (npm,
/// then pip).
pub fn steps_for_top_level_files<S: AsRef<str>>(
    names: &[S],
    run_dir: &Path,
) -> Vec<PostInstallStep> {
    let has = |wanted: &str| names.iter().any(|n| n.as_ref() == wanted);
    let mut steps = Vec::new();
    if has("package.json") {
        steps.push(PostInstallStep::new(
            "npm",
            &["install", "--production"],
            run_dir,
            "package.json",
        ));
    }
    if has("requirements.txt") {
        steps.push(PostInstallStep::new(
            "pip",
            &["install", "-r", "requirements.txt", "--user"],
            run_dir,
            "requirements.txt",
        ));
    }
    steps
}

/// Whether the `package.json` text `bytes` gives npm anything to install: a non-empty
/// `dependencies`, `optionalDependencies` or `peerDependencies`. Text that is not a JSON
/// object counts as needing the install.
pub fn package_json_needs_install(bytes: &[u8]) -> bool {
    let Ok(serde_json::Value::Object(package)) = serde_json::from_slice(bytes) else {
        return true;
    };
    ["dependencies", "optionalDependencies", "peerDependencies"]
        .iter()
        .any(|key| match package.get(*key) {
            None | Some(serde_json::Value::Null) => false,
            Some(serde_json::Value::Object(deps)) => !deps.is_empty(),
            Some(_) => true,
        })
}

/// Returns the steps implied by the files present in `scan_dir`, to be run in `run_dir`
/// (they differ during install: scanned in staging, run in the final dir). A
/// `package.json` with nothing for npm to install implies no step.
pub fn detect_steps(scan_dir: &Path, run_dir: &Path) -> Vec<PostInstallStep> {
    let present: Vec<&str> = ["package.json", "requirements.txt"]
        .into_iter()
        .filter(|f| scan_dir.join(f).is_file())
        .filter(|f| {
            *f != "package.json"
                || std::fs::read(scan_dir.join(f)).map_or(true, |b| package_json_needs_install(&b))
        })
        .collect();
    steps_for_top_level_files(&present, run_dir)
}

/// Applies the consent gate and returns the steps that may run, possibly none.
///
/// # Errors
///
/// Returns [`GitInstallError::PostInstallConsentRequired`] carrying `steps`
/// when there are steps and `allow_post_install` is false.
pub fn gate(
    plugin_id: &str,
    steps: Vec<PostInstallStep>,
    allow_post_install: bool,
) -> Result<Vec<PostInstallStep>, GitInstallError> {
    if steps.is_empty() || allow_post_install {
        Ok(steps)
    } else {
        Err(GitInstallError::PostInstallConsentRequired {
            plugin_id: plugin_id.to_string(),
            steps,
        })
    }
}

/// Applies the consent gate, then hands the permitted steps to `runner`. The
/// runner is never invoked without consent, and not at all when there is
/// nothing to run.
///
/// # Errors
///
/// Returns [`GitInstallError::PostInstallConsentRequired`] from the gate, or
/// the error `runner` returns.
pub async fn gate_and_run<F, Fut>(
    plugin_id: &str,
    steps: Vec<PostInstallStep>,
    allow_post_install: bool,
    runner: F,
) -> Result<(), GitInstallError>
where
    F: FnOnce(Vec<PostInstallStep>) -> Fut,
    Fut: Future<Output = Result<(), GitInstallError>>,
{
    let steps = gate(plugin_id, steps, allow_post_install)?;
    if steps.is_empty() {
        return Ok(());
    }
    log::warn!(
        "[AUDIT] event=plugin_post_install_consented plugin_id={} steps={:?}",
        plugin_id,
        steps.iter().map(|s| &s.command_line).collect::<Vec<_>>()
    );
    runner(steps).await
}

/// Executes steps exactly as described. Only reachable through [`gate_and_run`].
///
/// # Errors
///
/// Returns [`GitInstallError::PostInstallFailed`] when a step cannot be
/// spawned or exits with failure.
pub async fn run_steps(steps: Vec<PostInstallStep>) -> Result<(), GitInstallError> {
    for step in steps {
        let output = tokio::process::Command::new(&step.program)
            .args(&step.args)
            .current_dir(&step.working_dir)
            .stdin(std::process::Stdio::null())
            .output()
            .await
            .map_err(|e| {
                GitInstallError::PostInstallFailed(format!("{}: {e}", step.command_line))
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GitInstallError::PostInstallFailed(format!(
                "{} failed: {stderr}",
                step.command_line
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn no_trigger_files_means_no_steps() {
        assert!(steps_for_top_level_files(&["main.js", "README.md"], Path::new("/p")).is_empty());
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("main.js"), "").unwrap();
        assert!(detect_steps(tmp.path(), tmp.path()).is_empty());
    }

    #[test]
    fn package_json_and_requirements_map_to_exact_commands() {
        let steps = steps_for_top_level_files(
            &["requirements.txt", "package.json", "main.py"],
            Path::new("/home/u/.rim/plugins/dev.x"),
        );
        let lines: Vec<&str> = steps.iter().map(|s| s.command_line.as_str()).collect();
        assert_eq!(
            lines,
            [
                "npm install --production",
                "pip install -r requirements.txt --user"
            ]
        );
        assert!(steps
            .iter()
            .all(|s| s.working_dir == "/home/u/.rim/plugins/dev.x"));
        assert_eq!(steps[0].program, "npm");
        assert_eq!(steps[0].args, ["install", "--production"]);
    }

    /// A plugin's `package.json` with only build tools in `devDependencies`.
    const DEV_ONLY_PACKAGE: &str = r#"{"name":"plugin-x","devDependencies":{"esbuild":"^0.24.0","vitest":"^2.0.0"},"dependencies":{}}"#;

    #[test]
    fn detect_scans_one_dir_and_reports_the_run_dir() {
        let scan = tempfile::TempDir::new().unwrap();
        std::fs::write(
            scan.path().join("package.json"),
            r#"{"dependencies":{"ws":"8"}}"#,
        )
        .unwrap();
        // A directory named like a trigger file does not count.
        std::fs::create_dir(scan.path().join("requirements.txt")).unwrap();
        let steps = detect_steps(scan.path(), Path::new("/final"));
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].trigger_file, "package.json");
        assert_eq!(steps[0].working_dir, "/final");
    }

    #[test]
    fn npm_runs_only_for_a_package_json_with_something_to_install() {
        let scan = tempfile::TempDir::new().unwrap();
        let npm_steps = |text: &str| {
            std::fs::write(scan.path().join("package.json"), text).unwrap();
            detect_steps(scan.path(), scan.path()).len()
        };
        assert_eq!(npm_steps(DEV_ONLY_PACKAGE), 0);
        assert_eq!(npm_steps("{}"), 0);
        assert_eq!(npm_steps(r#"{"dependencies":{"ws":"8"}}"#), 1);
        assert_eq!(npm_steps(r#"{"optionalDependencies":{"fsevents":"2"}}"#), 1);
        assert_eq!(npm_steps(r#"{"peerDependencies":{"react":"19"}}"#), 1);
        assert_eq!(npm_steps("{ not json"), 1);
        assert_eq!(npm_steps("[]"), 1);
        std::fs::write(scan.path().join("requirements.txt"), "requests\n").unwrap();
        assert_eq!(
            npm_steps(DEV_ONLY_PACKAGE),
            1,
            "requirements.txt still runs pip"
        );
    }

    #[test]
    fn gate_requires_consent_only_when_steps_exist() {
        let steps = steps_for_top_level_files(&["package.json"], Path::new("/p"));
        match gate("dev.x", steps.clone(), false) {
            Err(GitInstallError::PostInstallConsentRequired {
                plugin_id,
                steps: s,
            }) => {
                assert_eq!(plugin_id, "dev.x");
                assert_eq!(s, steps);
            }
            other => panic!("expected consent error, got {other:?}"),
        }
        assert_eq!(gate("dev.x", steps.clone(), true).unwrap(), steps);
        assert!(gate("dev.x", Vec::new(), false).unwrap().is_empty());
    }

    type Calls = Arc<Mutex<Vec<Vec<PostInstallStep>>>>;

    fn recorder(
        calls: Calls,
    ) -> impl FnOnce(Vec<PostInstallStep>) -> std::future::Ready<Result<(), GitInstallError>> {
        move |steps| {
            calls.lock().unwrap().push(steps);
            std::future::ready(Ok(()))
        }
    }

    #[tokio::test]
    async fn runner_not_invoked_without_consent() {
        let calls: Calls = Arc::default();
        let steps = steps_for_top_level_files(&["package.json"], Path::new("/p"));
        let err = gate_and_run("dev.x", steps, false, recorder(calls.clone()))
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            GitInstallError::PostInstallConsentRequired { .. }
        ));
        assert!(calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn runner_invoked_with_consent() {
        let calls: Calls = Arc::default();
        let steps =
            steps_for_top_level_files(&["package.json", "requirements.txt"], Path::new("/p"));
        gate_and_run("dev.x", steps.clone(), true, recorder(calls.clone()))
            .await
            .unwrap();
        assert_eq!(*calls.lock().unwrap(), vec![steps]);
    }

    #[tokio::test]
    async fn runner_not_invoked_when_nothing_to_run() {
        let calls: Calls = Arc::default();
        gate_and_run("dev.x", Vec::new(), true, recorder(calls.clone()))
            .await
            .unwrap();
        assert!(calls.lock().unwrap().is_empty());
    }

    #[test]
    fn consent_error_serializes_steps_for_the_ui() {
        let err = GitInstallError::PostInstallConsentRequired {
            plugin_id: "dev.x".into(),
            steps: steps_for_top_level_files(&["package.json"], Path::new("/p")),
        };
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "POST_INSTALL_CONSENT_REQUIRED");
        assert_eq!(v["data"]["plugin_id"], "dev.x");
        assert_eq!(
            v["data"]["steps"][0]["command_line"],
            "npm install --production"
        );
        assert_eq!(v["data"]["steps"][0]["working_dir"], "/p");
        assert!(v["message"].as_str().unwrap().contains("consent"));
    }
}
