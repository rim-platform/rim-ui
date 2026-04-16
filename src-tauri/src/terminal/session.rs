use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use tauri::{AppHandle, Emitter};

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
    pub fn spawn(
        app_handle: AppHandle,
        session_id: String,
        shell: Option<String>,
        cwd: Option<String>,
    ) -> Result<Self, SessionError> {
        // Resolve and validate shell
        let shell_path = resolve_shell(shell)?;

        // Resolve and validate cwd
        let cwd_path = resolve_cwd(cwd)?;

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
                            let _ =
                                app_handle.emit(&format!("terminal://output/{sid}"), encoded);
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

fn resolve_shell(shell: Option<String>) -> Result<String, SessionError> {
    if let Some(s) = shell {
        let path = Path::new(&s);
        if !path.is_file() {
            return Err(SessionError::InvalidShell(format!(
                "shell not found or not a file: {s}"
            )));
        }
        return Ok(s);
    }

    // Platform-aware shell resolution
    if cfg!(windows) {
        // Prefer PowerShell, fall back to cmd.exe
        if let Ok(pwsh) = std::env::var("COMSPEC") {
            // COMSPEC is typically C:\WINDOWS\system32\cmd.exe
            // Check for PowerShell first
            if let Ok(ps_path) = which_shell("pwsh.exe") {
                return Ok(ps_path);
            }
            if let Ok(ps_path) = which_shell("powershell.exe") {
                return Ok(ps_path);
            }
            return Ok(pwsh);
        }
        Ok("cmd.exe".to_string())
    } else {
        // Unix: use $SHELL, fall back to /bin/sh
        Ok(std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()))
    }
}

/// Try to find a shell executable on PATH.
fn which_shell(name: &str) -> Result<String, ()> {
    let path_var = std::env::var("PATH").map_err(|_| ())?;
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path_var.split(sep) {
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            return candidate.to_str().map(|s| s.to_string()).ok_or(());
        }
    }
    Err(())
}

fn resolve_cwd(cwd: Option<String>) -> Result<PathBuf, SessionError> {
    if let Some(c) = cwd {
        let path = std::fs::canonicalize(&c).map_err(|e| {
            SessionError::InvalidCwd(format!("cannot canonicalize '{c}': {e}"))
        })?;
        if !path.is_dir() {
            return Err(SessionError::InvalidCwd(format!(
                "not a directory: {}",
                path.display()
            )));
        }
        Ok(path)
    } else {
        // Default to home directory
        Ok(dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")))
    }
}
