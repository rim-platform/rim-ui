use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

use super::policy;

const READ_BUF_SIZE: usize = 4096;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("pty error: {0}")]
    Pty(String),
    #[error("invalid cwd: {0}")]
    InvalidCwd(String),
    #[error("invalid shell: {0}")]
    InvalidShell(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct PtySession {
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
    pub session_id: String,
    pub shell: String,
    reader_handle: Option<std::thread::JoinHandle<()>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(serde::Serialize, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub shell: String,
    pub running: bool,
}

impl PtySession {
    /// Spawn a PTY session. `shell_path` and `cwd_path` must already have been
    /// validated through [`resolve_shell`] and [`resolve_cwd`].
    pub fn spawn(
        app_handle: AppHandle,
        session_id: String,
        shell_path: String,
        cwd_path: PathBuf,
    ) -> Result<Self, SessionError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::Pty(e.to_string()))?;

        let mut cmd = CommandBuilder::new(&shell_path);
        cmd.cwd(&cwd_path);

        // CommandBuilder::new() inherits the full parent environment via std::env::vars_os().
        // We only override specific vars that need terminal-specific defaults.

        // Ensure TERM is set — needed for proper escape sequence support
        if std::env::var("TERM").is_err() {
            cmd.env("TERM", "xterm-256color");
        }

        // Ensure UTF-8 locale — critical for correct character display.
        // C.UTF-8 is POSIX-mandated and available on virtually all systems without
        // needing locale generation (unlike en_US.UTF-8 which may not be installed).
        if std::env::var("LANG").is_err() {
            cmd.env("LANG", "C.UTF-8");
        }
        if std::env::var("LC_CTYPE").is_err() {
            cmd.env("LC_CTYPE", "C.UTF-8");
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| SessionError::Pty(e.to_string()))?;

        // Drop slave — we only need the master side
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| SessionError::Pty(e.to_string()))?;
        let writer = Some(Arc::new(Mutex::new(writer)));

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| SessionError::Pty(e.to_string()))?;

        // Spawn a dedicated OS thread for blocking PTY reads (Fury's requirement)
        let sid = session_id.clone();
        let reader_handle = std::thread::Builder::new()
            .name(format!("pty-reader-{sid}"))
            .spawn(move || {
                let mut buf = [0u8; READ_BUF_SIZE];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            // PTY closed — emit exit event
                            let _ = app_handle.emit(&format!("terminal://exit/{sid}"), 0);
                            break;
                        }
                        Ok(n) => {
                            let encoded = BASE64.encode(&buf[..n]);
                            let _ = app_handle.emit(&format!("terminal://output/{sid}"), encoded);
                        }
                        Err(e) => {
                            log::error!("pty read error for {sid}: {e}");
                            let _ = app_handle.emit(&format!("terminal://exit/{sid}"), -1);
                            break;
                        }
                    }
                }
            })
            .map_err(SessionError::Io)?;

        Ok(Self {
            master: Some(pair.master),
            writer,
            session_id,
            shell: shell_path,
            reader_handle: Some(reader_handle),
            child,
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), SessionError> {
        let writer_arc = self
            .writer
            .as_ref()
            .ok_or_else(|| SessionError::Pty("session already shut down".to_string()))?;
        let mut writer = writer_arc
            .lock()
            .map_err(|e| SessionError::Pty(format!("writer lock poisoned: {e}")))?;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), SessionError> {
        self.master
            .as_ref()
            .ok_or_else(|| SessionError::Pty("session already shut down".to_string()))?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::Pty(e.to_string()))
    }

    /// Consume the session, triggering cleanup via Drop.
    pub fn shutdown(self) {
        // Drop triggers the cleanup sequence.
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        // 1. Kill the child process so the PTY stream ends cleanly
        let _ = self.child.kill();

        // 2. Drop the writer — closes the write end of the PTY
        drop(self.writer.take());

        // 3. Drop the master PTY — closes the file descriptor and signals EOF to the reader.
        //    This MUST happen BEFORE join() to avoid deadlock: the reader thread blocks on
        //    read() until the master FD is closed.
        drop(self.master.take());

        // 4. Now the reader thread will see EOF and exit — safe to join
        if let Some(handle) = self.reader_handle.take() {
            let join_result = handle.join();
            if let Err(e) = join_result {
                log::warn!("reader thread panicked during shutdown: {:?}", e);
            }
        }

        // 5. Reap the child process
        let _ = self.child.wait();
    }
}

/// Resolve the shell for a new session under the S-H1 policy: never an
/// arbitrary caller-supplied path (see [`policy`]).
pub fn resolve_shell(requested: Option<&str>) -> Result<String, SessionError> {
    if cfg!(windows) {
        policy::select_windows_shell(requested, resolve_windows_shell)
            .map_err(SessionError::InvalidShell)
    } else {
        // An unreadable /etc/shells means no caller-supplied shell is accepted.
        let allowed = std::fs::read_to_string("/etc/shells")
            .map(|c| policy::parse_etc_shells(&c))
            .unwrap_or_default();
        let env_shell = std::env::var("SHELL").ok();
        policy::select_unix_shell(requested, &allowed, env_shell.as_deref())
            .map_err(SessionError::InvalidShell)
    }
}

/// Map an allowlisted Windows shell name to a full path.
fn resolve_windows_shell(name: &str) -> Option<String> {
    if name.eq_ignore_ascii_case("cmd.exe") {
        if let Ok(comspec) = std::env::var("COMSPEC") {
            return Some(comspec);
        }
    }
    which_shell(name)
}

/// Try to find a shell executable on PATH.
fn which_shell(name: &str) -> Option<String> {
    let path_var = std::env::var("PATH").ok()?;
    let sep = if cfg!(windows) { ';' } else { ':' };
    path_var
        .split(sep)
        .map(|dir| Path::new(dir).join(name))
        .find(|candidate| candidate.is_file())
        .and_then(|candidate| candidate.to_str().map(str::to_string))
}

/// Resolve the working directory: the user's home directory, or an existing
/// directory inside it.
pub fn resolve_cwd(requested: Option<&str>) -> Result<PathBuf, SessionError> {
    let home = dirs::home_dir()
        .ok_or_else(|| SessionError::InvalidCwd("cannot resolve home directory".into()))?;
    policy::select_cwd(requested, &home).map_err(SessionError::InvalidCwd)
}
