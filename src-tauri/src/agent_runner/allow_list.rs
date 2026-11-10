//! The programs the person allowed the runner to start, each with its exact arguments, kept in a
//! file in the app's data directory.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The allow list's file name in the app's data directory.
pub(crate) const FILE_NAME: &str = "agent-programs.json";
/// Most entries on the list.
pub(crate) const MAX_ENTRIES: usize = 32;

/// A program's full path and the exact arguments it may be started with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllowedProgram {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
}

/// The file's contents.
#[derive(Debug, Default, Serialize, Deserialize)]
struct AllowFile {
    programs: Vec<AllowedProgram>,
}

/// The allow list in memory, and the file it is saved to. Without a file, it lives in memory only.
pub(crate) struct AllowList {
    path: Option<PathBuf>,
    entries: Vec<AllowedProgram>,
}

impl AllowList {
    /// Reads the list at `path`. A missing file is an empty list; a file that cannot be read or
    /// parsed is an empty list too, and a warning is logged.
    pub(crate) fn open(path: Option<PathBuf>) -> Self {
        let (list, warning) = Self::read(path);
        if let Some(warning) = warning {
            log::warn!("[agent_runner] {warning}");
        }
        list
    }

    /// Reads the list at `path`, with the warning to log when the file was not usable.
    pub(crate) fn read(path: Option<PathBuf>) -> (Self, Option<String>) {
        let Some(file) = path.as_deref() else {
            return (Self::empty(None), None);
        };
        let raw = match fs::read(file) {
            Ok(raw) => raw,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return (Self::empty(path), None);
            }
            Err(error) => {
                let warning = format!(
                    "{} is not readable, no program is allowed: {error}",
                    file.display()
                );
                return (Self::empty(path), Some(warning));
            }
        };
        match serde_json::from_slice::<AllowFile>(&raw) {
            Ok(contents) => {
                let mut entries: Vec<AllowedProgram> = Vec::new();
                for entry in contents.programs {
                    if Path::new(&entry.program).is_absolute() && !entries.contains(&entry) {
                        entries.push(entry);
                    }
                }
                entries.truncate(MAX_ENTRIES);
                (Self { path, entries }, None)
            }
            Err(error) => {
                let warning = format!(
                    "{} is not valid, no program is allowed: {error}",
                    file.display()
                );
                (Self::empty(path), Some(warning))
            }
        }
    }

    fn empty(path: Option<PathBuf>) -> Self {
        Self {
            path,
            entries: Vec::new(),
        }
    }

    /// Whether `program` with exactly `args` is on the list.
    pub(crate) fn contains(&self, program: &str, args: &[String]) -> bool {
        self.entries
            .iter()
            .any(|entry| entry.program == program && entry.args == args)
    }

    /// Whether another entry fits.
    pub(crate) fn is_full(&self) -> bool {
        self.entries.len() >= MAX_ENTRIES
    }

    /// Adds `entry` and saves the list; an entry already there is left as it is.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the list is full or could not be saved; the list is then
    /// unchanged.
    pub(crate) fn add(&mut self, entry: AllowedProgram) -> Result<(), String> {
        if self.contains(&entry.program, &entry.args) {
            return Ok(());
        }
        if self.is_full() {
            return Err(full_message());
        }
        self.entries.push(entry);
        if let Err(error) = self.save() {
            self.entries.pop();
            return Err(error);
        }
        Ok(())
    }

    /// Removes `program` with exactly `args` and saves the list. A pair that is not there is left
    /// alone.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the list could not be saved; the list is then unchanged.
    pub(crate) fn remove(&mut self, program: &str, args: &[String]) -> Result<(), String> {
        let Some(index) = self
            .entries
            .iter()
            .position(|entry| entry.program == program && entry.args == args)
        else {
            return Ok(());
        };
        let removed = self.entries.remove(index);
        if let Err(error) = self.save() {
            self.entries.insert(index, removed);
            return Err(error);
        }
        Ok(())
    }

    /// Removes `old` when it is there, adds `new` when it is given and not there yet, and saves
    /// the list once.
    ///
    /// # Errors
    ///
    /// A sentence for the page when the list would be over its limit or could not be saved; the
    /// list is then unchanged.
    pub(crate) fn replace(
        &mut self,
        old: Option<&AllowedProgram>,
        new: Option<AllowedProgram>,
    ) -> Result<(), String> {
        let before = self.entries.clone();
        if let Some(old) = old {
            self.entries.retain(|entry| entry != old);
        }
        if let Some(new) = new {
            if !self.entries.contains(&new) {
                if self.is_full() {
                    self.entries = before;
                    return Err(full_message());
                }
                self.entries.push(new);
            }
        }
        if self.entries == before {
            return Ok(());
        }
        if let Err(error) = self.save() {
            self.entries = before;
            return Err(error);
        }
        Ok(())
    }

    /// The entries, in the order they were allowed.
    pub(crate) fn entries(&self) -> Vec<AllowedProgram> {
        self.entries.clone()
    }

    /// Writes the list to its file through a temporary file renamed over it, readable only by this
    /// user on Unix.
    fn save(&self) -> Result<(), String> {
        let Some(path) = self.path.as_deref() else {
            return Ok(());
        };
        let failed = |error: std::io::Error| {
            log::warn!("[agent_runner] cannot write {}: {error}", path.display());
            "The list of allowed programs could not be saved.".to_owned()
        };
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(failed)?;
        }
        let raw = serde_json::to_vec_pretty(&AllowFile {
            programs: self.entries.clone(),
        })
        .map_err(|error| failed(std::io::Error::other(error)))?;
        let temporary = path.with_extension("json.tmp");
        let written = write_private(&temporary, &raw).and_then(|()| fs::rename(&temporary, path));
        written.map_err(|error| {
            let _ = fs::remove_file(&temporary);
            failed(error)
        })
    }
}

/// The refusal when the list is full.
pub(crate) fn full_message() -> String {
    format!("At most {MAX_ENTRIES} programs can be allowed. Forget one first.")
}

/// Writes `bytes` to a new file at `path`, readable only by this user on Unix, and flushes it to
/// the disk.
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let _ = fs::remove_file(path);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn entry(program: &str, args: &[&str]) -> AllowedProgram {
        AllowedProgram {
            program: program.to_owned(),
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        }
    }

    fn args(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn the_list_round_trips_through_its_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("data").join(FILE_NAME);
        let mut list = AllowList::open(Some(path.clone()));
        list.add(entry("/usr/bin/gemini", &["--experimental-acp"]))
            .unwrap();
        list.add(entry("/usr/bin/codex", &[])).unwrap();
        list.add(entry("/usr/bin/codex", &[])).unwrap();

        let (read, warning) = AllowList::read(Some(path.clone()));
        assert_eq!(warning, None);
        assert_eq!(
            read.entries(),
            vec![
                entry("/usr/bin/gemini", &["--experimental-acp"]),
                entry("/usr/bin/codex", &[])
            ]
        );
        assert!(read.contains("/usr/bin/gemini", &args(&["--experimental-acp"])));
        assert!(!read.contains("/usr/bin/gemini", &args(&[])));
        assert!(!dir
            .path()
            .join("data")
            .join("agent-programs.json.tmp")
            .exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn forgetting_removes_only_the_exact_pair() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(FILE_NAME);
        let mut list = AllowList::open(Some(path.clone()));
        list.add(entry("/bin/a", &["x"])).unwrap();
        list.add(entry("/bin/a", &["y"])).unwrap();
        list.remove("/bin/a", &args(&["x"])).unwrap();
        list.remove("/bin/missing", &args(&[])).unwrap();
        assert_eq!(list.entries(), vec![entry("/bin/a", &["y"])]);
        assert_eq!(
            AllowList::read(Some(path)).0.entries(),
            vec![entry("/bin/a", &["y"])]
        );
    }

    #[test]
    fn a_corrupt_file_is_an_empty_list_with_a_warning() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(FILE_NAME);
        fs::write(&path, "{ not json").unwrap();
        let (list, warning) = AllowList::read(Some(path.clone()));
        assert!(list.entries().is_empty());
        assert!(warning.is_some_and(|warning| warning.contains("is not valid")));

        fs::write(
            &path,
            r#"{"programs":[{"program":"relative/a","args":[]}]}"#,
        )
        .unwrap();
        let (list, warning) = AllowList::read(Some(path));
        assert!(list.entries().is_empty());
        assert_eq!(warning, None);
    }

    #[test]
    fn a_missing_file_is_an_empty_list_without_a_warning() {
        let dir = TempDir::new().unwrap();
        let (list, warning) = AllowList::read(Some(dir.path().join(FILE_NAME)));
        assert!(list.entries().is_empty());
        assert_eq!(warning, None);
    }

    #[test]
    fn replacing_swaps_one_pair_for_another_in_one_save() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(FILE_NAME);
        let mut list = AllowList::open(Some(path.clone()));
        for i in 0..MAX_ENTRIES {
            list.add(entry(&format!("/bin/p{i}"), &[])).unwrap();
        }
        assert_eq!(
            list.replace(None, Some(entry("/bin/new", &[]))),
            Err(full_message())
        );
        list.replace(
            Some(&entry("/bin/p3", &[])),
            Some(entry("/bin/new", &["acp"])),
        )
        .unwrap();
        let read = AllowList::read(Some(path)).0;
        assert!(read.contains("/bin/new", &args(&["acp"])));
        assert!(!read.contains("/bin/p3", &args(&[])));
        assert_eq!(read.entries().len(), MAX_ENTRIES);
        list.replace(Some(&entry("/bin/new", &["acp"])), None)
            .unwrap();
        assert_eq!(list.entries().len(), MAX_ENTRIES - 1);
    }

    #[test]
    fn the_list_holds_at_most_its_limit() {
        let mut list = AllowList::open(None);
        for i in 0..MAX_ENTRIES {
            list.add(entry(&format!("/bin/p{i}"), &[])).unwrap();
        }
        assert!(list.is_full());
        assert_eq!(list.add(entry("/bin/more", &[])), Err(full_message()));
        list.add(entry("/bin/p0", &[])).unwrap();
        assert_eq!(list.entries().len(), MAX_ENTRIES);
    }
}
