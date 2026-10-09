//! Where the archive's files live. One trait; this module holds the local folder provider,
//! which also covers folders that Dropbox, Google Drive, OneDrive, iCloud Drive or Syncthing
//! keep in sync. The Google Drive and Dropbox API providers are in `cloud/`.
//!
//! Paths are archive-relative and `/`-separated (`accounts/<tag>/devices/<id>/head.rimx`);
//! [`check_path`] refuses anything that could leave the archive's root.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use super::ArchiveError;

/// Storage for an archive's files. Implementations are called from the blocking pool.
pub(crate) trait ArchiveProvider: Send + Sync {
    /// The file's bytes, or `None` when there is no such file.
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, ArchiveError>;

    /// Write a file whole, replacing what is there. A reader sees the old bytes or the new
    /// ones, never a mix. Only ever called on files this device owns.
    fn write(&self, path: &str, bytes: &[u8]) -> Result<(), ArchiveError>;

    /// Create a file only if nothing is at `path`; `Ok(false)` when something already is.
    fn create(&self, path: &str, bytes: &[u8]) -> Result<bool, ArchiveError>;

    /// The names of the directories directly inside `dir`; empty when `dir` does not exist.
    fn list_dirs(&self, dir: &str) -> Result<Vec<String>, ArchiveError>;

    /// Fail with [`ArchiveError::NotWritable`] unless this device can write here. Joining an
    /// archive writes nothing, so without this check a read-only folder would take the
    /// passphrase and then fail every backup.
    fn check_writable(&self) -> Result<(), ArchiveError>;

    /// What to show the user as the archive's location.
    fn describe(&self) -> String;
}

/// Refuse paths that are empty, absolute, or step outside the root (`..`, drive letters,
/// backslashes, NUL).
pub(crate) fn check_path(path: &str) -> Result<(), ArchiveError> {
    let bad = path.is_empty()
        || path.split('/').any(|part| {
            part.is_empty() || part == "." || part == ".." || part.contains(['\\', ':', '\0'])
        });
    if bad {
        return Err(ArchiveError::Invalid(format!("bad archive path: {path:?}")));
    }
    Ok(())
}

/// A folder on this computer.
pub(crate) struct LocalFolderProvider {
    root: PathBuf,
}

impl LocalFolderProvider {
    /// The folder must exist: a path whose drive is unplugged or not yet mounted must not
    /// quietly become a fresh, empty archive on the local disk.
    pub(crate) fn new(root: impl Into<PathBuf>) -> Result<Self, ArchiveError> {
        let root = root.into();
        if !root.is_absolute() {
            return Err(ArchiveError::Invalid(
                "the archive folder must be an absolute path".into(),
            ));
        }
        if !root.is_dir() {
            return Err(ArchiveError::Unavailable(format!(
                "{} is not a folder that can be reached",
                root.display()
            )));
        }
        Ok(Self { root })
    }

    fn resolve(&self, path: &str) -> Result<PathBuf, ArchiveError> {
        check_path(path)?;
        Ok(path
            .split('/')
            .fold(self.root.clone(), |p, part| p.join(part)))
    }

    /// A hidden temporary file next to `target`, which sync clients and readers ignore.
    fn write_temp(target: &Path, bytes: &[u8]) -> Result<PathBuf, ArchiveError> {
        let dir = target
            .parent()
            .ok_or_else(|| ArchiveError::Invalid("archive path has no parent".into()))?;
        fs::create_dir_all(dir).map_err(io)?;
        let name = target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let suffix = hex::encode(super::crypto::random_bytes::<6>()?);
        let temp = dir.join(format!(".{name}.{suffix}.tmp"));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(io)?;
        let written = file.write_all(bytes).and_then(|()| file.sync_all());
        if let Err(e) = written {
            let _ = fs::remove_file(&temp);
            return Err(io(e));
        }
        Ok(temp)
    }
}

impl ArchiveProvider for LocalFolderProvider {
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>, ArchiveError> {
        match fs::read(self.resolve(path)?) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(io(e)),
        }
    }

    fn write(&self, path: &str, bytes: &[u8]) -> Result<(), ArchiveError> {
        let target = self.resolve(path)?;
        let temp = Self::write_temp(&target, bytes)?;
        // Rename replaces atomically on the same file system (MoveFileEx on Windows).
        fs::rename(&temp, &target).map_err(|e| {
            let _ = fs::remove_file(&temp);
            io(e)
        })
    }

    fn create(&self, path: &str, bytes: &[u8]) -> Result<bool, ArchiveError> {
        let target = self.resolve(path)?;
        let temp = Self::write_temp(&target, bytes)?;
        // A hard link appears whole and fails if the name is taken, so two devices creating
        // an archive in one folder at once cannot both win.
        let linked = fs::hard_link(&temp, &target);
        let result = match linked {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(false),
            // Some file systems (FAT, some network shares) have no hard links: fall back to
            // an exclusive create, which is still atomic about the name.
            Err(_) => match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
            {
                Ok(mut file) => file
                    .write_all(bytes)
                    .and_then(|()| file.sync_all())
                    .map(|()| true)
                    .map_err(io),
                Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(false),
                Err(e) => Err(io(e)),
            },
        };
        let _ = fs::remove_file(&temp);
        result
    }

    fn list_dirs(&self, dir: &str) -> Result<Vec<String>, ArchiveError> {
        let entries = match fs::read_dir(self.resolve(dir)?) {
            Ok(entries) => entries,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(io(e)),
        };
        let mut names = Vec::new();
        for entry in entries {
            let entry = entry.map_err(io)?;
            if entry.file_type().map_err(io)?.is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    names.push(name.to_string());
                }
            }
        }
        names.sort();
        Ok(names)
    }

    fn check_writable(&self) -> Result<(), ArchiveError> {
        let probe = self.root.join("rim-write-check");
        let temp = Self::write_temp(&probe, b"").map_err(|e| match e {
            ArchiveError::Io(reason) => {
                ArchiveError::NotWritable(format!("{}: {reason}", self.root.display()))
            }
            other => other,
        })?;
        let _ = fs::remove_file(temp);
        Ok(())
    }

    fn describe(&self) -> String {
        self.root.display().to_string()
    }
}

fn io(e: std::io::Error) -> ArchiveError {
    ArchiveError::Io(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_cannot_leave_the_root() {
        for bad in [
            "", "/abs", "a//b", "../x", "a/../b", "a/./b", "a\\b", "c:x", "a/", "nul\0",
        ] {
            assert!(check_path(bad).is_err(), "{bad:?} accepted");
        }
        check_path("accounts/abc/devices/d1/head.rimx").unwrap();
    }

    #[test]
    fn a_missing_or_relative_folder_is_refused() {
        assert!(LocalFolderProvider::new("relative/dir").is_err());
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            LocalFolderProvider::new(dir.path().join("unplugged")),
            Err(ArchiveError::Unavailable(_))
        ));
    }

    #[test]
    fn write_replaces_and_create_refuses_to() {
        let dir = tempfile::tempdir().unwrap();
        let provider = LocalFolderProvider::new(dir.path()).unwrap();
        assert_eq!(provider.read("a/b.txt").unwrap(), None);
        provider.write("a/b.txt", b"one").unwrap();
        provider.write("a/b.txt", b"two").unwrap();
        assert_eq!(provider.read("a/b.txt").unwrap().unwrap(), b"two");

        assert!(provider.create("m.json", b"first").unwrap());
        assert!(!provider.create("m.json", b"second").unwrap());
        assert_eq!(provider.read("m.json").unwrap().unwrap(), b"first");

        // No temporary files are left behind.
        let names: Vec<_> = fs::read_dir(dir.path().join("a"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["b.txt"]);
        provider.check_writable().unwrap();
        assert!(provider.list_dirs("").is_err());
        assert_eq!(provider.list_dirs("a").unwrap(), Vec::<String>::new());
        assert_eq!(provider.list_dirs("missing").unwrap(), Vec::<String>::new());
    }
}
