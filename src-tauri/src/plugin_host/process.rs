#![allow(dead_code)]

use std::path::Path;
use std::process::Stdio;
use tokio::io::{BufReader, BufWriter};
use tokio::process::{Child, Command};
use tokio::time::{timeout, Duration};

/// How long a plugin has to exit on its own once its stdin is closed.
const EXIT_GRACE: Duration = Duration::from_secs(1);
/// How long a plugin has to exit after SIGTERM before it is killed.
const TERM_GRACE: Duration = Duration::from_secs(2);

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("process exited with code: {0:?}")]
    Exited(Option<i32>),
    #[error("entrypoint not found: {0}")]
    EntrypointNotFound(String),
    #[error("stdin not available")]
    NoStdin,
    #[error("stdout not available")]
    NoStdout,
}

pub struct PluginProcess {
    child: Child,
    plugin_id: String,
}

pub struct PluginPipes {
    pub stdin: BufWriter<tokio::process::ChildStdin>,
    pub stdout: BufReader<tokio::process::ChildStdout>,
}

impl PluginProcess {
    /// Spawn a plugin child process from the given entrypoint within the plugin directory.
    pub fn spawn(
        plugin_id: &str,
        plugin_dir: &Path,
        entrypoint: &str,
    ) -> Result<(Self, PluginPipes), ProcessError> {
        let entrypoint_path = plugin_dir.join(entrypoint);
        if !entrypoint_path.exists() {
            return Err(ProcessError::EntrypointNotFound(
                entrypoint_path.display().to_string(),
            ));
        }

        let mut child = Command::new(&entrypoint_path)
            .current_dir(plugin_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()?;

        let stdin = child.stdin.take().ok_or(ProcessError::NoStdin)?;
        let stdout = child.stdout.take().ok_or(ProcessError::NoStdout)?;

        let pipes = PluginPipes {
            stdin: BufWriter::new(stdin),
            stdout: BufReader::new(stdout),
        };

        Ok((
            Self {
                child,
                plugin_id: plugin_id.to_string(),
            },
            pipes,
        ))
    }

    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }

    /// OS process id, while the process has not been reaped.
    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }

    /// Stop the process once the broker loop is done with it.
    ///
    /// By then the host has sent `rim.shutdown` and closed the plugin's stdin,
    /// which a v1 plugin answers by exiting. One that has not exited after
    /// [`EXIT_GRACE`] gets SIGTERM, and after [`TERM_GRACE`] more it is killed.
    pub async fn shutdown(&mut self) -> Result<(), ProcessError> {
        if timeout(EXIT_GRACE, self.child.wait()).await.is_ok() {
            log::info!("plugin {} exited", self.plugin_id);
            return Ok(());
        }
        self.terminate().await
    }

    /// SIGTERM, wait up to [`TERM_GRACE`], then SIGKILL.
    async fn terminate(&mut self) -> Result<(), ProcessError> {
        // Try to get the process id for signal sending
        let pid = self.child.id();

        if let Some(pid) = pid {
            // Send SIGTERM
            #[cfg(unix)]
            {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
            #[cfg(not(unix))]
            {
                // On non-unix, just kill directly
                let _ = self.child.kill().await;
                return Ok(());
            }

            // Wait for graceful exit with timeout
            match timeout(TERM_GRACE, self.child.wait()).await {
                Ok(Ok(_status)) => {
                    log::info!("plugin {} exited gracefully", self.plugin_id);
                }
                Ok(Err(e)) => {
                    log::warn!("plugin {} wait error: {}", self.plugin_id, e);
                }
                Err(_) => {
                    // Timeout — force kill
                    log::warn!(
                        "plugin {} did not exit within {:?}, sending SIGKILL",
                        self.plugin_id,
                        TERM_GRACE
                    );
                    let _ = self.child.kill().await;
                }
            }
        } else {
            // Process already exited
            log::info!("plugin {} already exited", self.plugin_id);
        }

        Ok(())
    }

    /// Check if the process is still running.
    pub fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>, ProcessError> {
        Ok(self.child.try_wait()?)
    }
}

/// Kill a process by pid, for app exit, where no destructor runs.
pub fn force_kill(pid: u32) {
    #[cfg(unix)]
    {
        // SAFETY: kill(2) takes no pointers; a stale pid fails with ESRCH.
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    fn create_test_script(dir: &Path, name: &str, content: &str) {
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[tokio::test]
    async fn spawn_and_shutdown() {
        let tmp = TempDir::new().unwrap();
        create_test_script(
            tmp.path(),
            "plugin.sh",
            "#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 1; done\n",
        );

        let (mut proc, _pipes) =
            PluginProcess::spawn("dev.example.test", tmp.path(), "plugin.sh").unwrap();
        assert!(proc.try_wait().unwrap().is_none()); // still running

        proc.shutdown().await.unwrap();
        // After shutdown, process should be gone
        let status = proc.try_wait().unwrap();
        assert!(status.is_some());
    }

    #[tokio::test]
    async fn plugin_that_exits_on_stdin_eof_is_not_signalled() {
        let tmp = TempDir::new().unwrap();
        // Exits with 3 on EOF; SIGTERM would end it with a signal instead.
        create_test_script(
            tmp.path(),
            "plugin.sh",
            "#!/bin/sh\ncat >/dev/null\nexit 3\n",
        );

        let (mut proc, pipes) =
            PluginProcess::spawn("dev.example.test", tmp.path(), "plugin.sh").unwrap();
        drop(pipes); // the host closes stdin
        proc.shutdown().await.unwrap();
        let status = proc.try_wait().unwrap().expect("process exited");
        assert_eq!(status.code(), Some(3));
    }

    #[tokio::test]
    async fn force_kill_ends_a_process_that_ignores_sigterm() {
        let tmp = TempDir::new().unwrap();
        create_test_script(
            tmp.path(),
            "plugin.sh",
            "#!/bin/sh\ntrap '' TERM\nwhile true; do sleep 1; done\n",
        );
        let (mut proc, _pipes) =
            PluginProcess::spawn("dev.example.test", tmp.path(), "plugin.sh").unwrap();
        force_kill(proc.pid().unwrap());
        let status = timeout(Duration::from_secs(5), proc.child.wait())
            .await
            .expect("killed process is reaped")
            .unwrap();
        assert!(!status.success());
    }

    #[tokio::test]
    async fn entrypoint_not_found() {
        let tmp = TempDir::new().unwrap();
        let result = PluginProcess::spawn("dev.example.test", tmp.path(), "nonexistent");
        assert!(matches!(result, Err(ProcessError::EntrypointNotFound(_))));
    }
}
