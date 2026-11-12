//! An agent program's process: starting it, its pipes, and stopping it with its children.

use std::ffi::OsString;
use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::timeout;

/// Keeps a console program from opening a console window of its own on Windows.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Size of the buffer stdout is read through.
const STDOUT_BUFFER: usize = 64 * 1024;

/// A started program and its three pipes.
pub(crate) struct Spawned {
    pub(crate) child: Child,
    pub(crate) stdin: ChildStdin,
    pub(crate) stdout: ChildStdout,
    pub(crate) stderr: ChildStderr,
}

/// Starts `program` with `args` in `cwd`, without a shell, with the host's environment and every
/// pipe connected. With `path`, the child's `PATH` is set to it. On Unix the child leads a new
/// process group, so its own children can be signalled with it.
///
/// # Errors
///
/// The error of the spawn, or an error saying a pipe is missing.
pub(crate) fn spawn(
    program: &Path,
    args: &[String],
    cwd: &Path,
    path: Option<OsString>,
) -> std::io::Result<Spawned> {
    let mut command = Command::new(program);
    crate::host_env::restore_host_env(&mut command);
    if let Some(path) = path {
        command.env("PATH", path);
    }
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn()?;
    let missing = || std::io::Error::other("a pipe of the program is missing");
    let stdin = child.stdin.take().ok_or_else(missing)?;
    let stdout = child.stdout.take().ok_or_else(missing)?;
    let stderr = child.stderr.take().ok_or_else(missing)?;
    Ok(Spawned {
        child,
        stdin,
        stdout,
        stderr,
    })
}

/// Sends `signal` to the process group led by `pid`. Does nothing for a pid of 0 or 1, which
/// would name this app's own group or every process.
#[cfg(unix)]
pub(crate) fn signal_group(pid: u32, signal: libc::c_int) {
    let Ok(pgid) = i32::try_from(pid) else {
        return;
    };
    if pgid <= 1 {
        return;
    }
    // SAFETY: kill(2) takes no pointers; a group with no members left fails with ESRCH.
    unsafe {
        libc::kill(-pgid, signal);
    }
}

/// Kills the process `pid` and everything it started: its process group on Unix, its process
/// tree with `taskkill /T /F` on Windows.
pub(crate) fn kill_tree(pid: u32) {
    #[cfg(unix)]
    signal_group(pid, libc::SIGKILL);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(not(any(unix, windows)))]
    let _ = pid;
}

/// How long each step of a stop waits for the program to exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct StopGraces {
    /// After stdin is closed.
    pub(crate) stdin: Duration,
    /// After SIGTERM; Windows has no such step.
    pub(crate) term: Duration,
}

/// Stops `child`: closes its stdin through `close_stdin`, waits `graces.stdin`, then on Unix sends
/// SIGTERM to its group and waits `graces.term`, then kills its tree.
///
/// # Errors
///
/// The error of waiting for the process.
pub(crate) async fn stop(
    child: &mut Child,
    pid: Option<u32>,
    graces: StopGraces,
    close_stdin: &watch::Sender<bool>,
) -> std::io::Result<ExitStatus> {
    let _ = close_stdin.send(true);
    if let Ok(status) = timeout(graces.stdin, child.wait()).await {
        return status;
    }
    #[cfg(unix)]
    if let Some(pid) = pid {
        signal_group(pid, libc::SIGTERM);
        if let Ok(status) = timeout(graces.term, child.wait()).await {
            return status;
        }
    }
    kill_and_wait(child, pid).await
}

/// Kills `child`'s tree and waits for it.
///
/// # Errors
///
/// The error of waiting for the process.
pub(crate) async fn kill_and_wait(
    child: &mut Child,
    pid: Option<u32>,
) -> std::io::Result<ExitStatus> {
    if let Some(pid) = pid {
        kill_tree(pid);
    }
    let _ = child.start_kill();
    child.wait().await
}

/// One line for the program's stdin, and where to say whether it was written.
pub(crate) struct WriteRequest {
    pub(crate) bytes: Vec<u8>,
    pub(crate) done: oneshot::Sender<Result<(), String>>,
}

/// Writes each request to `stdin` in order until `close` turns true, the requests end or a write
/// fails; then drops `stdin`, which closes it. A write still in progress when `close` turns true
/// is abandoned.
pub(crate) async fn write_requests(
    mut stdin: ChildStdin,
    mut requests: mpsc::Receiver<WriteRequest>,
    mut close: watch::Receiver<bool>,
) {
    loop {
        let request = tokio::select! {
            _ = close.wait_for(|closed| *closed) => break,
            request = requests.recv() => match request {
                Some(request) => request,
                None => break,
            },
        };
        let write = async {
            stdin.write_all(&request.bytes).await?;
            stdin.flush().await
        };
        let result = tokio::select! {
            result = write => result,
            _ = close.wait_for(|closed| *closed) => {
                let _ = request.done.send(Err(super::NOT_RUNNING.to_owned()));
                break;
            }
        };
        let failed = result.is_err();
        let _ = request.done.send(
            result.map_err(|_| "The agent is no longer reading what is sent to it.".to_owned()),
        );
        if failed {
            break;
        }
    }
}

/// How reading a run's stdout ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StdoutEnd {
    /// The pipe closed.
    Closed,
    /// A line was longer than the limit; reading stopped.
    TooLong,
    /// Reading failed.
    Failed,
}

/// Reads `stdout` line by line and passes each line, without its line break and a carriage return
/// before it, to `on_line`; invalid UTF-8 is replaced. A last line without a line break counts.
pub(crate) async fn read_lines(
    stdout: ChildStdout,
    max_line: usize,
    mut on_line: impl FnMut(String),
) -> StdoutEnd {
    let mut reader = BufReader::with_capacity(STDOUT_BUFFER, stdout);
    let mut line = Vec::new();
    loop {
        line.clear();
        match read_line_limited(&mut reader, &mut line, max_line).await {
            Ok(LineRead::Line) => {
                let bytes = line.strip_suffix(b"\r").unwrap_or(&line);
                on_line(String::from_utf8_lossy(bytes).into_owned());
            }
            Ok(LineRead::Eof) => return StdoutEnd::Closed,
            Ok(LineRead::TooLong) => return StdoutEnd::TooLong,
            Err(_) => return StdoutEnd::Failed,
        }
    }
}

/// The result of reading one line.
#[derive(Debug, PartialEq, Eq)]
enum LineRead {
    Line,
    Eof,
    TooLong,
}

/// Reads one line into `line`, without its `\n`, refusing one longer than `max` bytes.
async fn read_line_limited<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
    max: usize,
) -> std::io::Result<LineRead> {
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(if line.is_empty() {
                LineRead::Eof
            } else {
                LineRead::Line
            });
        }
        match available.iter().position(|&b| b == b'\n') {
            Some(end) => {
                if line.len() + end > max {
                    return Ok(LineRead::TooLong);
                }
                line.extend_from_slice(&available[..end]);
                reader.consume(end + 1);
                return Ok(LineRead::Line);
            }
            None => {
                let taken = available.len();
                if line.len() + taken > max {
                    return Ok(LineRead::TooLong);
                }
                line.extend_from_slice(available);
                reader.consume(taken);
            }
        }
    }
}

/// Reads `stderr` in chunks and passes each to `on_chunk` until the pipe closes or fails.
pub(crate) async fn read_chunks(mut stderr: ChildStderr, mut on_chunk: impl FnMut(&[u8])) {
    let mut buffer = vec![0u8; 8192];
    loop {
        match stderr.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(read) => on_chunk(&buffer[..read]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn lines_of(input: &[u8], max: usize) -> (Vec<Vec<u8>>, LineRead) {
        let mut reader = BufReader::with_capacity(4, input);
        let mut lines = Vec::new();
        loop {
            let mut line = Vec::new();
            match read_line_limited(&mut reader, &mut line, max)
                .await
                .unwrap()
            {
                LineRead::Line => lines.push(line),
                end => return (lines, end),
            }
        }
    }

    #[tokio::test]
    async fn splits_lines_across_buffer_refills() {
        let (lines, end) = lines_of(b"hello world\n\nlast", 64).await;
        assert_eq!(
            lines,
            vec![b"hello world".to_vec(), Vec::new(), b"last".to_vec()]
        );
        assert_eq!(end, LineRead::Eof);
    }

    #[tokio::test]
    async fn a_line_at_the_limit_passes_and_one_past_it_does_not() {
        let (lines, end) = lines_of(b"12345\n123456\n", 5).await;
        assert_eq!(lines, vec![b"12345".to_vec()]);
        assert_eq!(end, LineRead::TooLong);
    }

    #[tokio::test]
    async fn an_unterminated_long_line_is_too_long() {
        let (lines, end) = lines_of(b"123456789", 5).await;
        assert!(lines.is_empty());
        assert_eq!(end, LineRead::TooLong);
    }
}
