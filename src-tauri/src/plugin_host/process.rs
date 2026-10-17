use std::path::Path;
use std::process::Stdio;
use tokio::io::{BufReader, BufWriter};
use tokio::process::{Child, Command};
use tokio::time::{timeout, Duration};

/// How long a plugin has to exit on its own once its stdin is closed.
const EXIT_GRACE: Duration = Duration::from_secs(1);
/// How long a plugin has to exit after SIGTERM before it is killed.
const TERM_GRACE: Duration = Duration::from_secs(2);
/// How many times a spawn is retried while the entrypoint is busy.
const BUSY_RETRIES: u32 = 8;
/// Delay before the first busy retry; it doubles with each one.
const BUSY_BACKOFF: Duration = Duration::from_millis(5);

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
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
    /// Spawns a plugin child process from `entrypoint` within `plugin_dir`, and
    /// returns it with its stdin and stdout pipes.
    ///
    /// # Errors
    ///
    /// Returns [`ProcessError::EntrypointNotFound`] when the entrypoint does not
    /// exist, [`ProcessError::Io`] when it cannot be spawned, and
    /// [`ProcessError::NoStdin`] or [`ProcessError::NoStdout`] when a pipe is
    /// missing.
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

        let mut command = Command::new(&entrypoint_path);
        command
            .current_dir(plugin_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        let mut child = spawn_while_busy(&mut command)?;

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

    // Only the tests wait on a plugin process by polling.
    #[cfg(test)]
    pub fn plugin_id(&self) -> &str {
        &self.plugin_id
    }

    /// OS process id, while the process has not been reaped.
    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }

    /// Stops the process once the broker loop is done with it.
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

    /// Sends SIGTERM, waits up to [`TERM_GRACE`], then sends SIGKILL.
    async fn terminate(&mut self) -> Result<(), ProcessError> {
        // The process id, for sending signals.
        let pid = self.child.id();

        if let Some(pid) = pid {
            // Send SIGTERM.
            #[cfg(unix)]
            {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
            #[cfg(not(unix))]
            {
                // On non-unix, kill directly.
                let _ = self.child.kill().await;
                return Ok(());
            }

            // Wait for a graceful exit, with a timeout.
            match timeout(TERM_GRACE, self.child.wait()).await {
                Ok(Ok(_status)) => {
                    log::info!("plugin {} exited gracefully", self.plugin_id);
                }
                Ok(Err(e)) => {
                    log::warn!("plugin {} wait error: {}", self.plugin_id, e);
                }
                Err(_) => {
                    // Timed out: force kill.
                    log::warn!(
                        "plugin {} did not exit within {:?}, sending SIGKILL",
                        self.plugin_id,
                        TERM_GRACE
                    );
                    let _ = self.child.kill().await;
                }
            }
        } else {
            // The process already exited.
            log::info!("plugin {} already exited", self.plugin_id);
        }

        Ok(())
    }

    /// Returns the exit status if the process has exited, `None` while it runs.
    #[cfg(test)]
    pub fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>, ProcessError> {
        Ok(self.child.try_wait()?)
    }
}

/// Spawns `command`, retrying with backoff while its executable is busy.
///
/// An entrypoint this process just wrote, as a bundle install does right before a restart,
/// stays open for writing in any child another thread forked meanwhile, until that child
/// execs. Executing the file in that window fails with ETXTBSY.
fn spawn_while_busy(command: &mut Command) -> std::io::Result<Child> {
    let mut delay = BUSY_BACKOFF;
    for _ in 0..BUSY_RETRIES {
        match command.spawn() {
            Err(e) if e.kind() == std::io::ErrorKind::ExecutableFileBusy => {
                std::thread::sleep(delay);
                delay *= 2;
            }
            result => return result,
        }
    }
    command.spawn()
}

/// Kills a process by pid, for app exit, where no destructor runs.
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

/// Checked-in plugin scripts for tests that spawn processes.
///
/// A script written at test time can be busy for exec while another test thread forks.
#[cfg(test)]
pub(crate) fn test_plugins_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/plugin_host/test_plugins")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::TempDir;

    #[tokio::test]
    async fn spawn_and_shutdown() {
        let (mut proc, _pipes) = PluginProcess::spawn(
            "dev.example.test",
            &test_plugins_dir(),
            "exits_on_sigterm.sh",
        )
        .unwrap();
        assert!(proc.try_wait().unwrap().is_none()); // still running

        proc.shutdown().await.unwrap();
        // After shutdown, process should be gone
        let status = proc.try_wait().unwrap();
        assert!(status.is_some());
    }

    #[tokio::test]
    async fn plugin_that_exits_on_stdin_eof_is_not_signalled() {
        let (mut proc, pipes) =
            PluginProcess::spawn("dev.example.test", &test_plugins_dir(), "exits_3_on_eof.sh")
                .unwrap();
        drop(pipes); // the host closes stdin
        proc.shutdown().await.unwrap();
        let status = proc.try_wait().unwrap().expect("process exited");
        assert_eq!(status.code(), Some(3));
    }

    #[tokio::test]
    async fn force_kill_ends_a_process_that_ignores_sigterm() {
        let (mut proc, _pipes) = PluginProcess::spawn(
            "dev.example.test",
            &test_plugins_dir(),
            "ignores_sigterm.sh",
        )
        .unwrap();
        force_kill(proc.pid().unwrap());
        let status = timeout(Duration::from_secs(5), proc.child.wait())
            .await
            .expect("killed process is reaped")
            .unwrap();
        assert!(!status.success());
    }

    #[tokio::test]
    async fn spawn_waits_out_an_entrypoint_still_open_for_writing() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("plugin.sh");
        let mut writer = std::fs::File::create(&path).unwrap();
        writer.write_all(b"#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let closer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            drop(writer);
        });

        let (mut proc, _pipes) =
            PluginProcess::spawn("dev.example.test", tmp.path(), "plugin.sh").unwrap();
        closer.join().unwrap();
        let status = timeout(Duration::from_secs(5), proc.child.wait())
            .await
            .expect("plugin exits")
            .unwrap();
        assert_eq!(status.code(), Some(0));
    }

    #[tokio::test]
    async fn entrypoint_not_found() {
        let tmp = TempDir::new().unwrap();
        let result = PluginProcess::spawn("dev.example.test", tmp.path(), "nonexistent");
        assert!(matches!(result, Err(ProcessError::EntrypointNotFound(_))));
    }
}
