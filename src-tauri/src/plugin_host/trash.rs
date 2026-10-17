//! The plugins folder's trash: uninstall moves a plugin's folder into
//! `<plugins_root>/.trash/` at once and deletes it there in the background.
//! No step follows a symlink: a link loses only itself, never its target.

use crate::plugin_host::plugin_protocol::is_safe_segment;
use std::path::{Path, PathBuf};

/// Name of the trash folder inside the plugins folder. It starts with `.`, so
/// no plugin id names it and discovery skips it.
pub const TRASH_DIR: &str = ".trash";

/// Move `<plugins_root>/<plugin_id>` into the trash under `plugins_root` and
/// return where it went. An id that is not a safe path segment is refused. The
/// trash is created when missing; one that is a link or not a folder is refused.
pub fn move_to_trash(plugins_root: &Path, plugin_id: &str) -> std::io::Result<PathBuf> {
    if !is_safe_segment(plugin_id) {
        return Err(std::io::Error::other(format!(
            "{plugin_id} is not a safe path segment"
        )));
    }
    let dir = plugins_root.join(plugin_id);
    let trash = plugins_root.join(TRASH_DIR);
    std::fs::create_dir_all(&trash)?;
    let metadata = std::fs::symlink_metadata(&trash)?;
    if !metadata.is_dir() {
        log::warn!(
            "[AUDIT] event=plugin_trash_refused path={} reason=not_a_folder",
            trash.display()
        );
        return Err(std::io::Error::other(format!(
            "{} is not a folder",
            trash.display()
        )));
    }
    let trashed = trash.join(format!("{plugin_id}-{}", uuid::Uuid::now_v7()));
    std::fs::rename(&dir, &trashed)?;
    Ok(trashed)
}

/// Delete the trash entry at `path`: a link loses only itself, a folder goes
/// with everything in it, and a file is removed.
pub fn delete_trashed(path: &Path) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        remove_link(path)
    } else if metadata.is_dir() {
        // `remove_dir_all` removes links inside the folder, not their targets.
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// Delete everything in the trash under `plugins_root`. A trash that is a link
/// loses only the link. Failures are logged; the next sweep retries them.
pub fn sweep(plugins_root: &Path) {
    let trash = plugins_root.join(TRASH_DIR);
    let metadata = match std::fs::symlink_metadata(&trash) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return,
        Err(e) => {
            log::warn!(
                "[AUDIT] event=plugin_trash_sweep_failed path={} error={e}",
                trash.display()
            );
            return;
        }
        Ok(metadata) => metadata,
    };
    if metadata.file_type().is_symlink() {
        match remove_link(&trash) {
            Ok(()) => log::warn!(
                "[AUDIT] event=plugin_trash_link_removed path={}",
                trash.display()
            ),
            Err(e) => log::warn!(
                "[AUDIT] event=plugin_trash_sweep_failed path={} error={e}",
                trash.display()
            ),
        }
        return;
    }
    if !metadata.is_dir() {
        log::warn!(
            "[AUDIT] event=plugin_trash_sweep_failed path={} reason=not_a_folder",
            trash.display()
        );
        return;
    }
    let entries = match std::fs::read_dir(&trash) {
        Ok(entries) => entries,
        Err(e) => {
            log::warn!(
                "[AUDIT] event=plugin_trash_sweep_failed path={} error={e}",
                trash.display()
            );
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match delete_trashed(&path) {
            Ok(()) => log::warn!(
                "[AUDIT] event=plugin_trash_entry_deleted path={}",
                path.display()
            ),
            Err(e) => log::warn!(
                "[AUDIT] event=plugin_trash_sweep_failed path={} error={e}",
                path.display()
            ),
        }
    }
}

/// Remove the link at `path`. A directory link on Windows goes with
/// `remove_dir`, which removes only the link.
pub fn remove_link(path: &Path) -> std::io::Result<()> {
    std::fs::remove_file(path).or_else(|_| std::fs::remove_dir(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[cfg(unix)]
    #[test]
    fn a_linked_trash_is_neither_used_nor_followed() {
        let root = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("keep.txt"), b"keep").unwrap();
        let trash = root.path().join(TRASH_DIR);
        std::os::unix::fs::symlink(outside.path(), &trash).unwrap();
        let dir = root.path().join("dev.example.hello");
        fs::create_dir_all(&dir).unwrap();

        move_to_trash(root.path(), "dev.example.hello").unwrap_err();
        assert!(dir.exists());

        sweep(root.path());
        assert!(fs::symlink_metadata(&trash).is_err());
        assert!(outside.path().join("keep.txt").exists());
    }

    #[test]
    fn sweeping_without_a_trash_does_nothing() {
        let root = TempDir::new().unwrap();
        sweep(root.path());
        assert!(fs::read_dir(root.path()).unwrap().next().is_none());
    }
}
