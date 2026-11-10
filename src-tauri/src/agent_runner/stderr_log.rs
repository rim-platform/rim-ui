//! A run's stderr: a log file with a size cap, and its last lines for the exit event.

use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// Largest log file. Past it, the oldest part is dropped.
pub(crate) const LOG_CAP: u64 = 1024 * 1024;
/// How many of the last stderr lines the exit event carries.
pub(crate) const TAIL_LINES: usize = 20;
/// Longest tail line kept, in bytes; the rest of a longer line is left out of the tail.
const TAIL_LINE_MAX: usize = 4096;
/// How many run logs the folder keeps; older ones are removed when a run starts.
const KEPT_LOGS: usize = 50;

/// The stderr of one run, written to `<dir>/<run id>.log` when the file could be created.
pub(crate) struct StderrLog {
    file: Option<File>,
    size: u64,
    cap: u64,
    tail: Tail,
}

impl StderrLog {
    /// Starts the log of run `run_id` in `dir`, after removing the oldest logs there so at most
    /// [`KEPT_LOGS`] stay. Without `dir`, or when the file cannot be created, only the tail is kept.
    pub(crate) fn create(dir: Option<&Path>, run_id: &str) -> Self {
        Self::create_with(dir, run_id, LOG_CAP)
    }

    /// [`StderrLog::create`] with a cap of `cap` bytes.
    pub(crate) fn create_with(dir: Option<&Path>, run_id: &str, cap: u64) -> Self {
        let file = dir.and_then(|dir| match open_log(dir, run_id) {
            Ok(file) => Some(file),
            Err(error) => {
                log::warn!("[agent_runner] cannot write the log of run {run_id}: {error}");
                None
            }
        });
        Self {
            file,
            size: 0,
            cap,
            tail: Tail::default(),
        }
    }

    /// Adds `chunk` to the log and the tail. A log that would pass the cap keeps its newest
    /// three quarters, from the start of a line. A failed write stops the log, not the run.
    pub(crate) fn write(&mut self, chunk: &[u8]) {
        self.tail.push(chunk);
        let Some(file) = self.file.as_mut() else {
            return;
        };
        let result = if self.size + chunk.len() as u64 > self.cap {
            shrink(file, chunk, self.cap).map(|size| self.size = size)
        } else {
            file.write_all(chunk)
                .map(|()| self.size += chunk.len() as u64)
        };
        if let Err(error) = result {
            log::warn!("[agent_runner] stopped writing a run log: {error}");
            self.file = None;
        }
    }

    /// The last [`TAIL_LINES`] lines, an unfinished last line included.
    pub(crate) fn tail(&self) -> Vec<String> {
        self.tail.lines()
    }
}

/// Creates the log file, readable only by this user.
fn open_log(dir: &Path, run_id: &str) -> std::io::Result<File> {
    std::fs::create_dir_all(dir)?;
    prune(dir, KEPT_LOGS.saturating_sub(1));
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(dir.join(format!("{run_id}.log")))
}

/// Removes the oldest `.log` files in `dir` so at most `keep` stay.
fn prune(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut logs: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "log") && path.is_file())
        .map(|path| {
            let modified = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            (modified, path)
        })
        .collect();
    if logs.len() <= keep {
        return;
    }
    logs.sort();
    let excess = logs.len() - keep;
    for (_, path) in logs.into_iter().take(excess) {
        let _ = std::fs::remove_file(path);
    }
}

/// Rewrites `file` as the newest three quarters of `cap` of its contents followed by `chunk`,
/// starting after a line break when there is one.
///
/// # Returns
///
/// The new size of the file.
fn shrink(file: &mut File, chunk: &[u8], cap: u64) -> std::io::Result<u64> {
    let mut contents = Vec::new();
    file.seek(SeekFrom::Start(0))?;
    file.read_to_end(&mut contents)?;
    contents.extend_from_slice(chunk);
    let keep = (cap as usize / 4) * 3;
    let mut start = contents.len().saturating_sub(keep);
    if start > 0 {
        if let Some(newline) = contents[start..].iter().position(|&b| b == b'\n') {
            if start + newline + 1 < contents.len() {
                start += newline + 1;
            }
        }
    }
    let kept = &contents[start..];
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(kept)?;
    Ok(kept.len() as u64)
}

/// The last lines of a byte stream.
#[derive(Default)]
struct Tail {
    lines: VecDeque<String>,
    partial: Vec<u8>,
}

impl Tail {
    fn push(&mut self, chunk: &[u8]) {
        let mut rest = chunk;
        while let Some(newline) = rest.iter().position(|&b| b == b'\n') {
            self.extend_partial(&rest[..newline]);
            let line = std::mem::take(&mut self.partial);
            self.lines.push_back(line_text(&line));
            if self.lines.len() > TAIL_LINES {
                self.lines.pop_front();
            }
            rest = &rest[newline + 1..];
        }
        self.extend_partial(rest);
    }

    fn extend_partial(&mut self, bytes: &[u8]) {
        let room = TAIL_LINE_MAX.saturating_sub(self.partial.len());
        self.partial
            .extend_from_slice(&bytes[..bytes.len().min(room)]);
    }

    fn lines(&self) -> Vec<String> {
        let mut lines: Vec<String> = self.lines.iter().cloned().collect();
        if !self.partial.is_empty() {
            lines.push(line_text(&self.partial));
            if lines.len() > TAIL_LINES {
                lines.remove(0);
            }
        }
        lines
    }
}

/// A line as text, without a trailing carriage return.
fn line_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn keeps_the_last_twenty_lines() {
        let mut log = StderrLog::create(None, "ar_test");
        for i in 0..30 {
            log.write(format!("line {i}\r\n").as_bytes());
        }
        log.write(b"unfinished");
        let tail = log.tail();
        assert_eq!(tail.len(), TAIL_LINES);
        assert_eq!(tail[0], "line 11");
        assert_eq!(tail[18], "line 29");
        assert_eq!(tail[19], "unfinished");
    }

    #[test]
    fn a_line_split_across_chunks_is_one_line() {
        let mut log = StderrLog::create(None, "ar_test");
        log.write(b"hel");
        log.write(b"lo\nwor");
        log.write(b"ld\n");
        assert_eq!(log.tail(), vec!["hello", "world"]);
    }

    #[test]
    fn a_long_tail_line_is_cut() {
        let mut log = StderrLog::create(None, "ar_test");
        log.write(&vec![b'x'; TAIL_LINE_MAX * 3]);
        log.write(b"\n");
        assert_eq!(log.tail()[0].len(), TAIL_LINE_MAX);
    }

    #[test]
    fn the_log_drops_its_oldest_part_at_the_cap() {
        let dir = TempDir::new().unwrap();
        let mut log = StderrLog::create_with(Some(dir.path()), "ar_test", 100);
        for i in 0..40 {
            log.write(format!("line {i:02}\n").as_bytes());
        }
        let contents = std::fs::read_to_string(dir.path().join("ar_test.log")).unwrap();
        assert!(contents.len() as u64 <= 100);
        assert!(contents.starts_with("line "));
        assert!(contents.ends_with("line 39\n"));
        assert!(!contents.contains("line 00"));
    }

    #[test]
    fn the_folder_keeps_the_newest_logs() {
        let dir = TempDir::new().unwrap();
        for i in 0..KEPT_LOGS + 5 {
            std::fs::write(dir.path().join(format!("old{i:03}.log")), "x").unwrap();
        }
        std::fs::write(dir.path().join("notes.txt"), "x").unwrap();
        let _log = StderrLog::create(Some(dir.path()), "ar_new");
        let logs = std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|ext| ext == "log")
            })
            .count();
        assert_eq!(logs, KEPT_LOGS);
        assert!(dir.path().join("ar_new.log").exists());
        assert!(dir.path().join("notes.txt").exists());
    }
}
