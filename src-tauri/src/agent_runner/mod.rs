//! The agent runner: starts agent programs the page asks for as child processes, passes lines to
//! their stdin and hands each line of their stdout to the page. It decides nothing about agents.

mod lookup;
mod process;
mod stderr_log;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Webview};
use tokio::process::{Child, ChildStderr, ChildStdout};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::timeout;

use crate::desktop_shell::MAIN_WINDOW;
use process::{StdoutEnd, StopGraces, WriteRequest};
use stderr_log::StderrLog;

/// The event that hands the page one line of a run's stdout, with a [`LineEvent`].
pub(crate) const LINE_EVENT: &str = "agent-runner://line";
/// The event that tells the page a run has ended, with an [`ExitEvent`].
pub(crate) const EXIT_EVENT: &str = "agent-runner://exit";

const MIB: usize = 1024 * 1024;
/// Most runs at once.
const MAX_RUNS: usize = 8;
/// Longest line the page may send, without its line break.
const MAX_SEND: usize = 4 * MIB;
/// Longest stdout line; a longer one ends the run.
const MAX_LINE: usize = 16 * MIB;
/// How long a run being stopped has after its stdin is closed, then after SIGTERM.
const STOP_GRACES: StopGraces = StopGraces {
    stdin: Duration::from_secs(2),
    term: Duration::from_secs(2),
};
/// The same when the app exits.
const EXIT_GRACES: StopGraces = StopGraces {
    stdin: Duration::from_millis(500),
    term: Duration::from_millis(500),
};
/// How long app exit waits for every run to stop before killing what is left.
const QUIT_TIMEOUT: Duration = Duration::from_secs(2);
/// How long the rest of a run's output is read after its process has ended.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(1);
/// Most lines queued for one run's stdin.
const WRITE_QUEUE: usize = 8;
/// Most names one lookup may ask for.
const MAX_FIND_NAMES: usize = 64;
/// The folder in the app's log directory that holds each run's stderr.
const LOG_FOLDER: &str = "agent-runs";

/// The answer when a run is not, or no longer, running.
pub(crate) const NOT_RUNNING: &str = "That agent is not running.";
/// Exit reason: the run was stopped by the page or by app exit.
pub(crate) const REASON_STOPPED: &str = "stopped";
/// Exit reason: a stdout line was longer than allowed.
pub(crate) const REASON_LINE_TOO_LONG: &str = "line_too_long";
/// Exit reason: reading stdout failed.
pub(crate) const REASON_STDOUT_FAILED: &str = "stdout_failed";

/// One line of a run's stdout, without its line break.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LineEvent {
    run_id: String,
    line: String,
}

/// How a run ended: its exit code or the signal that ended it, why the runner ended it (`None`
/// when it exited by itself) and the last lines of its stderr.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExitEvent {
    run_id: String,
    code: Option<i32>,
    signal: Option<i32>,
    reason: Option<String>,
    stderr_tail: Vec<String>,
}

/// The id of a run that started.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartedRun {
    run_id: String,
}

/// A running run: the program's full path, its working folder and when it started, in
/// milliseconds since the Unix epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    run_id: String,
    program: String,
    cwd: String,
    started_at: i64,
}

/// Where a run's lines and its end go.
pub(crate) trait RunEvents: Send + Sync + 'static {
    /// One stdout line.
    fn line(&self, event: LineEvent);
    /// The end of the run, after its last line.
    fn exit(&self, event: ExitEvent);
}

/// The events of the real app: emitted to the main window only.
struct PageEvents<R: Runtime>(AppHandle<R>);

impl<R: Runtime> RunEvents for PageEvents<R> {
    fn line(&self, event: LineEvent) {
        let _ = self.0.emit_to(MAIN_WINDOW, LINE_EVENT, event);
    }

    fn exit(&self, event: ExitEvent) {
        let _ = self.0.emit_to(MAIN_WINDOW, EXIT_EVENT, event);
    }
}

/// The runner's limits and waits.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Limits {
    max_runs: usize,
    max_send: usize,
    max_line: usize,
    graces: StopGraces,
    exit_graces: StopGraces,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_runs: MAX_RUNS,
            max_send: MAX_SEND,
            max_line: MAX_LINE,
            graces: STOP_GRACES,
            exit_graces: EXIT_GRACES,
        }
    }
}

/// The running runs, kept in the app's state.
pub struct AgentRunner {
    inner: Arc<Inner>,
}

struct Inner {
    runs: Mutex<Runs>,
    events: Arc<dyn RunEvents>,
    log_dir: Option<PathBuf>,
    limits: Limits,
}

/// The runs that are running, and how many are being started.
#[derive(Default)]
struct Runs {
    active: HashMap<String, Run>,
    starting: usize,
}

/// One running run.
struct Run {
    info: RunInfo,
    pid: Option<u32>,
    /// Set to the waits of a stop to stop the run.
    stop: watch::Sender<Option<StopGraces>>,
    /// Turns true once the run has ended and its exit event was sent.
    done: watch::Receiver<bool>,
    writer: mpsc::Sender<WriteRequest>,
}

/// Locks `mutex`, going on with its contents if another thread panicked while holding it.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A place among the runs, held while a run starts.
struct Slot<'a>(&'a Inner);

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        lock(&self.0.runs).starting -= 1;
    }
}

impl AgentRunner {
    /// A runner that sends its events to `events` and writes stderr logs to `log_dir`.
    pub(crate) fn new(
        events: Arc<dyn RunEvents>,
        log_dir: Option<PathBuf>,
        limits: Limits,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                runs: Mutex::new(Runs::default()),
                events,
                log_dir,
                limits,
            }),
        }
    }

    /// Starts `program` with `args` in `cwd`.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the program or the folder is not valid, too many runs are
    /// running, or the program could not be started.
    pub(crate) async fn start(
        &self,
        program: &str,
        args: Vec<String>,
        cwd: &str,
    ) -> Result<String, String> {
        let cwd = check_cwd(cwd)?;
        let dirs = lookup::search_dirs().await;
        let program = resolve_program(program, &dirs)?;
        let _slot = self.reserve()?;
        let run_id = new_run_id()?;
        let spawned = process::spawn(&program, &args, &cwd, child_path(&dirs))
            .map_err(|error| format!("{} could not be started: {error}.", program.display()))?;
        let pid = spawned.child.id();

        let (stop_tx, stop_rx) = watch::channel(None);
        let (done_tx, done_rx) = watch::channel(false);
        let (close_tx, close_rx) = watch::channel(false);
        let (writer_tx, writer_rx) = mpsc::channel(WRITE_QUEUE);
        tokio::spawn(process::write_requests(spawned.stdin, writer_rx, close_rx));

        let info = RunInfo {
            run_id: run_id.clone(),
            program: program.to_string_lossy().into_owned(),
            cwd: cwd.to_string_lossy().into_owned(),
            started_at: chrono::Utc::now().timestamp_millis(),
        };
        lock(&self.inner.runs).active.insert(
            run_id.clone(),
            Run {
                info,
                pid,
                stop: stop_tx,
                done: done_rx,
                writer: writer_tx,
            },
        );
        let log = StderrLog::create(self.inner.log_dir.as_deref(), &run_id);
        tokio::spawn(supervise(
            self.inner.clone(),
            run_id.clone(),
            Pipes {
                child: spawned.child,
                stdout: spawned.stdout,
                stderr: spawned.stderr,
                close_stdin: close_tx,
            },
            stop_rx,
            done_tx,
            log,
        ));
        log::info!("[agent_runner] started run {run_id}");
        Ok(run_id)
    }

    /// Holds a place for a run being started.
    fn reserve(&self) -> Result<Slot<'_>, String> {
        let mut runs = lock(&self.inner.runs);
        let max = self.inner.limits.max_runs;
        if runs.active.len() + runs.starting >= max {
            return Err(format!(
                "At most {max} agents can run at once. Stop one to start another."
            ));
        }
        runs.starting += 1;
        Ok(Slot(&self.inner))
    }

    /// Writes `line` and a line break to the stdin of run `run_id`, after the lines sent before.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the line holds a line break or is too long, or the run is not
    /// running or no longer reads its stdin.
    pub(crate) async fn send(&self, run_id: &str, line: String) -> Result<(), String> {
        if line.contains(['\n', '\r']) {
            return Err("A line sent to an agent cannot contain a line break.".to_owned());
        }
        let max = self.inner.limits.max_send;
        if line.len() > max {
            return Err(format!(
                "A line sent to an agent can be at most {}.",
                describe_size(max)
            ));
        }
        let writer = lock(&self.inner.runs)
            .active
            .get(run_id)
            .map(|run| run.writer.clone())
            .ok_or(NOT_RUNNING)?;
        let mut bytes = line.into_bytes();
        bytes.push(b'\n');
        let (done, written) = oneshot::channel();
        writer
            .send(WriteRequest { bytes, done })
            .await
            .map_err(|_| NOT_RUNNING)?;
        written
            .await
            .unwrap_or_else(|_| Err(NOT_RUNNING.to_owned()))
    }

    /// Stops run `run_id` and returns once it has ended and its exit event was sent: closes its
    /// stdin, waits, sends SIGTERM to its process group, waits, then kills the group (on Windows,
    /// `taskkill /T /F` after the first wait). A run that is not running is left alone.
    pub(crate) async fn stop(&self, run_id: &str) {
        let done = {
            let runs = lock(&self.inner.runs);
            let Some(run) = runs.active.get(run_id) else {
                return;
            };
            run.stop.send_replace(Some(self.inner.limits.graces));
            run.done.clone()
        };
        wait_done(done).await;
    }

    /// Stops every run for app exit, with the shorter exit waits, and kills by pid whatever is
    /// still running after [`QUIT_TIMEOUT`].
    pub(crate) async fn stop_all(&self) {
        self.stop_all_within(QUIT_TIMEOUT).await;
    }

    async fn stop_all_within(&self, wait: Duration) {
        let runs: Vec<(Option<u32>, watch::Receiver<bool>)> = lock(&self.inner.runs)
            .active
            .values()
            .map(|run| {
                run.stop.send_replace(Some(self.inner.limits.exit_graces));
                (run.pid, run.done.clone())
            })
            .collect();
        if runs.is_empty() {
            return;
        }
        log::info!("[agent_runner] stopping {} runs for app exit", runs.len());
        let all_done =
            futures_util::future::join_all(runs.iter().map(|(_, done)| wait_done(done.clone())));
        if timeout(wait, all_done).await.is_ok() {
            return;
        }
        for (pid, done) in runs {
            if let (Some(pid), false) = (pid, *done.borrow()) {
                log::warn!("[agent_runner] a run outlived app exit, killing it");
                process::kill_tree(pid);
            }
        }
    }

    /// Looks each of `names` up on the host's `PATH`.
    ///
    /// # Errors
    ///
    /// A sentence for the page when more than [`MAX_FIND_NAMES`] names are asked for.
    pub(crate) async fn find(&self, names: &[String]) -> Result<Vec<Option<String>>, String> {
        if names.len() > MAX_FIND_NAMES {
            return Err(format!(
                "At most {MAX_FIND_NAMES} programs can be looked up at once."
            ));
        }
        let dirs = lookup::search_dirs().await;
        let extensions = lookup::path_extensions();
        Ok(names
            .iter()
            .map(|name| {
                lookup::find_in(name, &dirs, extensions.as_deref())
                    .map(|path| path.to_string_lossy().into_owned())
            })
            .collect())
    }

    /// The runs that are running, oldest first.
    pub(crate) fn list(&self) -> Vec<RunInfo> {
        let mut runs: Vec<RunInfo> = lock(&self.inner.runs)
            .active
            .values()
            .map(|run| run.info.clone())
            .collect();
        runs.sort_by(|a, b| (a.started_at, &a.run_id).cmp(&(b.started_at, &b.run_id)));
        runs
    }
}

/// Waits until `done` turns true or its sender is gone.
async fn wait_done(mut done: watch::Receiver<bool>) {
    let _ = done.wait_for(|done| *done).await;
}

/// A run's process and the pipes its supervisor reads, with the switch that closes its stdin.
struct Pipes {
    child: Child,
    stdout: ChildStdout,
    stderr: ChildStderr,
    close_stdin: watch::Sender<bool>,
}

/// Watches one run until it ends: hands its stdout lines to the events, writes its stderr to
/// `log`, stops it when asked or when a line is too long, kills what is left of its process group,
/// then removes the run and sends its exit event.
async fn supervise(
    inner: Arc<Inner>,
    run_id: String,
    pipes: Pipes,
    mut stop: watch::Receiver<Option<StopGraces>>,
    done: watch::Sender<bool>,
    log: StderrLog,
) {
    let Pipes {
        mut child,
        stdout,
        stderr,
        close_stdin,
    } = pipes;
    let pid = child.id();

    let events = inner.events.clone();
    let line_run = run_id.clone();
    let mut stdout_task = tokio::spawn(process::read_lines(
        stdout,
        inner.limits.max_line,
        move |line| {
            events.line(LineEvent {
                run_id: line_run.clone(),
                line,
            })
        },
    ));
    let log = Arc::new(Mutex::new(log));
    let log_writer = log.clone();
    let mut stderr_task = tokio::spawn(process::read_chunks(stderr, move |chunk| {
        lock(&log_writer).write(chunk)
    }));

    let mut reason: Option<&'static str> = None;
    let mut stdout_ended = false;
    let status = loop {
        tokio::select! {
            status = child.wait() => break status,
            end = &mut stdout_task, if !stdout_ended => {
                stdout_ended = true;
                reason = match end.unwrap_or(StdoutEnd::Failed) {
                    StdoutEnd::Closed => continue,
                    StdoutEnd::TooLong => Some(REASON_LINE_TOO_LONG),
                    StdoutEnd::Failed => Some(REASON_STDOUT_FAILED),
                };
                break process::kill_and_wait(&mut child, pid).await;
            }
            changed = stop.changed() => {
                let graces = match changed {
                    Ok(()) => *stop.borrow_and_update(),
                    Err(_) => Some(inner.limits.exit_graces),
                };
                if let Some(graces) = graces {
                    reason = Some(REASON_STOPPED);
                    break process::stop(&mut child, pid, graces, &close_stdin).await;
                }
            }
        }
    };

    // What the program started and left behind ends with it.
    #[cfg(unix)]
    if let Some(pid) = pid {
        process::signal_group(pid, libc::SIGKILL);
    }
    let _ = close_stdin.send(true);
    if !stdout_ended && timeout(DRAIN_TIMEOUT, &mut stdout_task).await.is_err() {
        stdout_task.abort();
    }
    if timeout(DRAIN_TIMEOUT, &mut stderr_task).await.is_err() {
        stderr_task.abort();
    }
    let stderr_tail = lock(&log).tail();
    let (code, signal) = exit_codes(&status);

    lock(&inner.runs).active.remove(&run_id);
    log::info!(
        "[agent_runner] run {run_id} ended: code {code:?}, signal {signal:?}, reason {reason:?}"
    );
    inner.events.exit(ExitEvent {
        run_id,
        code,
        signal,
        reason: reason.map(str::to_owned),
        stderr_tail,
    });
    let _ = done.send(true);
}

/// The exit code and, on Unix, the signal of `status`; neither when it could not be read.
fn exit_codes(status: &std::io::Result<ExitStatus>) -> (Option<i32>, Option<i32>) {
    let Ok(status) = status else {
        return (None, None);
    };
    #[cfg(unix)]
    let signal = std::os::unix::process::ExitStatusExt::signal(status);
    #[cfg(not(unix))]
    let signal = None;
    (status.code(), signal)
}

/// `cwd` as a path, when it is absolute and an existing folder.
fn check_cwd(cwd: &str) -> Result<PathBuf, String> {
    let path = Path::new(cwd);
    if cwd.is_empty() || cwd.contains('\0') || !path.is_absolute() {
        return Err("The working folder must be a full path.".to_owned());
    }
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => Ok(path.to_path_buf()),
        Ok(_) => Err(format!("{cwd} is not a folder.")),
        Err(_) => Err(format!("The folder {cwd} does not exist.")),
    }
}

/// The program to run for `program`: a full path to an executable file, or a bare name found in
/// `dirs`.
fn resolve_program(program: &str, dirs: &[PathBuf]) -> Result<PathBuf, String> {
    if program.trim().is_empty() {
        return Err("Choose the program to start.".to_owned());
    }
    if program.contains('\0') {
        return Err("The program name is not valid.".to_owned());
    }
    let path = Path::new(program);
    if path.is_absolute() {
        if !path.exists() {
            return Err(format!("{program} does not exist."));
        }
        if !lookup::is_executable_file(path) {
            return Err(format!("{program} is not a program that can be run."));
        }
        return Ok(path.to_path_buf());
    }
    if !lookup::is_bare_name(program) {
        return Err(
            "The program must be a full path or a name found on PATH, not a relative path."
                .to_owned(),
        );
    }
    lookup::find_in(program, dirs, lookup::path_extensions().as_deref())
        .ok_or_else(|| format!("No program named {program} was found on PATH."))
}

/// The `PATH` a run gets when it differs from the app's: on macOS, the lookup's directories, so
/// a program found through the login shell finds what it runs the same way.
fn child_path(dirs: &[PathBuf]) -> Option<std::ffi::OsString> {
    #[cfg(target_os = "macos")]
    {
        std::env::join_paths(dirs).ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = dirs;
        None
    }
}

/// A new run id: `ar_` and 16 URL-safe characters.
fn new_run_id() -> Result<String, String> {
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).map_err(|error| format!("No run id could be made: {error}."))?;
    Ok(format!("ar_{}", URL_SAFE_NO_PAD.encode(bytes)))
}

/// `bytes` in MiB when it is a whole number of them, in bytes otherwise.
fn describe_size(bytes: usize) -> String {
    if bytes >= MIB && bytes.is_multiple_of(MIB) {
        format!("{} MiB", bytes / MIB)
    } else {
        format!("{bytes} bytes")
    }
}

/// Refuses a call that does not come from the main window.
fn from_main_window<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    if webview.label() == MAIN_WINDOW {
        Ok(())
    } else {
        Err("Agents can be started and stopped only from the main window.".to_owned())
    }
}

/// Puts the runner in the app's state, with its logs in the app's log directory.
pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) {
    let log_dir = match app.path().app_log_dir() {
        Ok(dir) => Some(dir.join(LOG_FOLDER)),
        Err(error) => {
            log::warn!("[agent_runner] no log directory, run logs are off: {error}");
            None
        }
    };
    app.manage(AgentRunner::new(
        Arc::new(PageEvents(app.clone())),
        log_dir,
        Limits::default(),
    ));
}

/// Starts `program` with `args` in the folder `cwd`, without a shell.
///
/// # Errors
///
/// A sentence for the page saying why the run did not start.
#[tauri::command]
pub async fn agent_runner_start<R: Runtime>(
    webview: Webview<R>,
    runner: State<'_, AgentRunner>,
    program: String,
    args: Vec<String>,
    cwd: String,
) -> Result<StartedRun, String> {
    from_main_window(&webview)?;
    let run_id = runner.start(&program, args, &cwd).await?;
    Ok(StartedRun { run_id })
}

/// Writes `line` and a line break to run `run_id`'s stdin.
///
/// # Errors
///
/// A sentence for the page saying why the line was not written.
#[tauri::command]
pub async fn agent_runner_send<R: Runtime>(
    webview: Webview<R>,
    runner: State<'_, AgentRunner>,
    run_id: String,
    line: String,
) -> Result<(), String> {
    from_main_window(&webview)?;
    runner.send(&run_id, line).await
}

/// Stops run `run_id`; returns once it has ended. Stopping a run that is not running does nothing.
///
/// # Errors
///
/// A sentence for the page when the call does not come from the main window.
#[tauri::command]
pub async fn agent_runner_stop<R: Runtime>(
    webview: Webview<R>,
    runner: State<'_, AgentRunner>,
    run_id: String,
) -> Result<(), String> {
    from_main_window(&webview)?;
    runner.stop(&run_id).await;
    Ok(())
}

/// The full path of each of `names` on the host's `PATH`, or `null` when it is not there.
///
/// # Errors
///
/// A sentence for the page when too many names are asked for.
#[tauri::command]
pub async fn agent_runner_find<R: Runtime>(
    webview: Webview<R>,
    runner: State<'_, AgentRunner>,
    names: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    from_main_window(&webview)?;
    runner.find(&names).await
}

/// The runs that are running, oldest first.
///
/// # Errors
///
/// A sentence for the page when the call does not come from the main window.
#[tauri::command]
pub fn agent_runner_list<R: Runtime>(
    webview: Webview<R>,
    runner: State<'_, AgentRunner>,
) -> Result<Vec<RunInfo>, String> {
    from_main_window(&webview)?;
    Ok(runner.list())
}
