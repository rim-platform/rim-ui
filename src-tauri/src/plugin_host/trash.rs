//! The plugins folder's trash: uninstall, update and a failed install move a
//! plugin's folder into `<plugins_root>/.trash/` at once and delete it there in
//! the background. No step follows a symlink: a link loses only itself, never
//! its target.

use crate::plugin_host::plugin_protocol::is_safe_segment;
use std::path::{Path, PathBuf};
use tauri::async_runtime::JoinHandle;

/// Name of the trash folder inside the plugins folder. It starts with `.`, so
/// no plugin id names it and discovery skips it.
pub const TRASH_DIR: &str = ".trash";

/// Move `<plugins_root>/<plugin_id>` into the trash under `plugins_root` and
/// return where it went. An id that is not a safe path segment or starts with
/// `.` is refused. The trash is created when missing; one that is a link or not
/// a folder is refused.
pub fn move_to_trash(plugins_root: &Path, plugin_id: &str) -> std::io::Result<PathBuf> {
    check_plugin_id(plugin_id)?;
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

/// Refuse an id that is not a safe path segment or starts with `.`, the names
/// of the trash and of install staging.
fn check_plugin_id(plugin_id: &str) -> std::io::Result<()> {
    if is_safe_segment(plugin_id) && !plugin_id.starts_with('.') {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "{plugin_id} is not a safe path segment"
        )))
    }
}

/// Delete the trash entry `trashed` of `plugin_id` on a blocking thread. Nobody
/// need wait for the handle: the outcome is logged, and the next sweep retries
/// a failure.
pub fn delete_in_background(plugin_id: &str, trashed: PathBuf) -> JoinHandle<()> {
    let plugin_id = plugin_id.to_string();
    tauri::async_runtime::spawn_blocking(move || match delete_trashed(&trashed) {
        Ok(()) => log::warn!(
            "[AUDIT] event=plugin_trash_entry_deleted plugin_id={plugin_id} path={}",
            trashed.display()
        ),
        Err(e) => log::warn!(
            "[AUDIT] event=plugin_trash_delete_failed plugin_id={plugin_id} path={} error={e}",
            trashed.display()
        ),
    })
}

/// Delete `<plugins_root>/<plugin_id>` without waiting for it: it moves into
/// the trash and goes there in the background. When the trash cannot take it (a
/// link or a file in its place, another filesystem), it is deleted here instead,
/// without following a link. A missing folder is not an error.
pub fn delete_later(plugins_root: &Path, plugin_id: &str) -> std::io::Result<()> {
    check_plugin_id(plugin_id)?;
    let dir = plugins_root.join(plugin_id);
    match std::fs::symlink_metadata(&dir) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        other => other?,
    };
    match move_to_trash(plugins_root, plugin_id) {
        Ok(trashed) => {
            delete_in_background(plugin_id, trashed);
            Ok(())
        }
        Err(e) => {
            log::warn!(
                "[AUDIT] event=plugin_trash_skipped plugin_id={plugin_id} path={} error={e}",
                dir.display()
            );
            let deleted = delete_trashed(&dir);
            log_deleted_in_place(plugin_id, &dir, &deleted);
            deleted
        }
    }
}

fn log_deleted_in_place(plugin_id: &str, path: &Path, deleted: &std::io::Result<()>) {
    match deleted {
        Ok(()) => log::warn!(
            "[AUDIT] event=plugin_folder_deleted plugin_id={plugin_id} path={}",
            path.display()
        ),
        Err(e) => log::warn!(
            "[AUDIT] event=plugin_folder_delete_failed plugin_id={plugin_id} path={} error={e}",
            path.display()
        ),
    }
}

/// Where the copy a [`Swap`] replaced waits.
#[derive(Debug)]
enum Old {
    /// In the trash, which a sweep empties.
    Trashed(PathBuf),
    /// Beside the plugin's folder under a `.replaced-` name, when the trash
    /// could not take it.
    Beside(PathBuf),
}

/// A new copy of a plugin moved into `<plugins_root>/<plugin_id>`, with the
/// copy it replaced kept aside until [`Swap::keep`] or [`Swap::undo`].
#[must_use]
#[derive(Debug)]
pub struct Swap {
    plugins_root: PathBuf,
    plugin_id: String,
    old: Option<Old>,
}

/// Move `staged` into `<plugins_root>/<plugin_id>`. A folder already there
/// moves into the trash first, or beside itself when the trash cannot take it,
/// and comes back when `staged` cannot move in. `staged` must be on the same
/// filesystem as the plugins folder.
pub fn swap_in(plugins_root: &Path, plugin_id: &str, staged: &Path) -> std::io::Result<Swap> {
    check_plugin_id(plugin_id)?;
    let dir = plugins_root.join(plugin_id);
    let old = match std::fs::symlink_metadata(&dir) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
        Ok(_) => Some(set_aside(plugins_root, plugin_id)?),
    };
    let swap = Swap {
        plugins_root: plugins_root.to_path_buf(),
        plugin_id: plugin_id.to_string(),
        old,
    };
    if let Err(e) = std::fs::rename(staged, &dir) {
        // The rename's error is the one to report; a failed put-back is logged.
        let _ = swap.put_back();
        return Err(e);
    }
    Ok(swap)
}

/// Move `<plugins_root>/<plugin_id>` into the trash, or to a `.replaced-` name
/// beside it when the trash cannot take it.
fn set_aside(plugins_root: &Path, plugin_id: &str) -> std::io::Result<Old> {
    match move_to_trash(plugins_root, plugin_id) {
        Ok(trashed) => Ok(Old::Trashed(trashed)),
        Err(e) => {
            let dir = plugins_root.join(plugin_id);
            let beside = replaced_path(plugins_root, plugin_id);
            log::warn!(
                "[AUDIT] event=plugin_trash_skipped plugin_id={plugin_id} path={} beside={} error={e}",
                dir.display(),
                beside.display()
            );
            std::fs::rename(&dir, &beside)?;
            Ok(Old::Beside(beside))
        }
    }
}

/// A new `.replaced-` name for a copy of `plugin_id` under `plugins_root`.
fn replaced_path(plugins_root: &Path, plugin_id: &str) -> PathBuf {
    plugins_root.join(format!(".replaced-{plugin_id}-{}", uuid::Uuid::now_v7()))
}

impl Swap {
    /// Keep the new copy and delete the replaced one: from the trash in the
    /// background, returning the handle, or here when it waits beside.
    pub fn keep(self) -> Option<JoinHandle<()>> {
        match self.old? {
            Old::Trashed(trashed) => Some(delete_in_background(&self.plugin_id, trashed)),
            Old::Beside(beside) => {
                log_deleted_in_place(&self.plugin_id, &beside, &delete_trashed(&beside));
                None
            }
        }
    }

    /// Drop the new copy without waiting for its deletion and put the replaced
    /// one back.
    pub fn undo(self) -> std::io::Result<()> {
        if let Err(e) = delete_later(&self.plugins_root, &self.plugin_id) {
            log::warn!(
                "[AUDIT] event=plugin_replace_undo_failed plugin_id={} error={e}",
                self.plugin_id
            );
        }
        self.put_back()
    }

    /// Move the replaced copy back to `<plugins_root>/<plugin_id>`. One that
    /// cannot go back leaves the trash for a `.replaced-` name, so no sweep
    /// deletes it.
    fn put_back(self) -> std::io::Result<()> {
        let Some(old) = self.old else {
            return Ok(());
        };
        let dir = self.plugins_root.join(&self.plugin_id);
        let (aside, in_trash) = match old {
            Old::Trashed(path) => (path, true),
            Old::Beside(path) => (path, false),
        };
        let Err(e) = std::fs::rename(&aside, &dir) else {
            return Ok(());
        };
        let mut kept = aside;
        if in_trash {
            let beside = replaced_path(&self.plugins_root, &self.plugin_id);
            if std::fs::rename(&kept, &beside).is_ok() {
                kept = beside;
            }
        }
        log::warn!(
            "[AUDIT] event=plugin_replace_restore_failed plugin_id={} path={} kept={} error={e}",
            self.plugin_id,
            dir.display(),
            kept.display()
        );
        Err(e)
    }
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
    // Listed first, so a folder set aside after the sweep starts is not taken.
    let entries: Vec<_> = match std::fs::read_dir(&trash) {
        Ok(entries) => entries.flatten().collect(),
        Err(e) => {
            log::warn!(
                "[AUDIT] event=plugin_trash_sweep_failed path={} error={e}",
                trash.display()
            );
            return;
        }
    };
    for entry in entries {
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

    const HELLO: &str = "dev.example.hello";

    /// A copy of [`HELLO`] at `dir` whose `version.txt` reads `version`.
    fn copy_at(dir: &Path, version: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("version.txt"), version).unwrap();
    }

    /// The `version.txt` of the copy at `dir`.
    fn version_at(dir: &Path) -> String {
        fs::read_to_string(dir.join("version.txt")).unwrap()
    }

    /// A plugins folder holding version 1 of [`HELLO`] and, staged beside it,
    /// version 2.
    fn installed_and_staged() -> (TempDir, PathBuf) {
        let root = TempDir::new().unwrap();
        copy_at(&root.path().join(HELLO), "1");
        let staged = root.path().join(".staging-test");
        copy_at(&staged, "2");
        (root, staged)
    }

    /// The names under `dir` other than [`TRASH_DIR`], sorted.
    fn names_beside_the_trash(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name != TRASH_DIR)
            .collect();
        names.sort();
        names
    }

    /// Every entry left in the trash under `root` is a copy of [`HELLO`] that the
    /// background may still be deleting.
    fn assert_only_hello_in_the_trash(root: &Path) {
        for entry in fs::read_dir(root.join(TRASH_DIR)).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            assert!(name.starts_with(&format!("{HELLO}-")), "{name}");
        }
    }

    #[test]
    fn a_kept_swap_deletes_the_replaced_copy_from_the_trash_in_the_background() {
        let (root, staged) = installed_and_staged();
        let swap = swap_in(root.path(), HELLO, &staged).unwrap();
        assert_eq!(version_at(&root.path().join(HELLO)), "2");
        let Some(Old::Trashed(trashed)) = &swap.old else {
            panic!("expected the old copy in the trash, got {:?}", swap.old);
        };
        let trashed = trashed.clone();
        assert_eq!(
            trashed.parent(),
            Some(root.path().join(TRASH_DIR).as_path())
        );
        assert_eq!(version_at(&trashed), "1");
        assert_eq!(names_beside_the_trash(root.path()), [HELLO]);

        let deleting = swap
            .keep()
            .expect("a trashed copy is deleted in the background");
        tauri::async_runtime::block_on(deleting).unwrap();
        assert!(fs::symlink_metadata(&trashed).is_err());
        assert_eq!(version_at(&root.path().join(HELLO)), "2");
    }

    #[test]
    fn a_swap_without_a_copy_to_replace_only_moves_the_new_one_in() {
        let root = TempDir::new().unwrap();
        let staged = root.path().join(".staging-test");
        copy_at(&staged, "2");
        let swap = swap_in(root.path(), HELLO, &staged).unwrap();
        assert!(swap.keep().is_none());
        assert_eq!(version_at(&root.path().join(HELLO)), "2");
        assert!(!root.path().join(TRASH_DIR).exists());
    }

    #[test]
    fn a_swap_whose_new_copy_cannot_move_in_puts_the_old_one_back() {
        let (root, _) = installed_and_staged();
        let missing = root.path().join(".staging-missing");
        swap_in(root.path(), HELLO, &missing).unwrap_err();
        assert_eq!(version_at(&root.path().join(HELLO)), "1");
        assert!(fs::read_dir(root.path().join(TRASH_DIR))
            .unwrap()
            .next()
            .is_none());
    }

    #[test]
    fn an_undone_swap_puts_the_old_copy_back_and_drops_the_new_one() {
        let (root, staged) = installed_and_staged();
        let swap = swap_in(root.path(), HELLO, &staged).unwrap();
        swap.undo().unwrap();
        assert_eq!(version_at(&root.path().join(HELLO)), "1");
        assert_eq!(names_beside_the_trash(root.path()), [HELLO]);
        assert_only_hello_in_the_trash(root.path());
    }

    #[test]
    fn an_old_copy_that_cannot_go_back_leaves_the_trash() {
        let (root, staged) = installed_and_staged();
        let swap = swap_in(root.path(), HELLO, &staged).unwrap();
        // The new copy still holds the name, so the old one cannot take it back.
        swap.put_back().unwrap_err();
        assert_eq!(version_at(&root.path().join(HELLO)), "2");
        let names = names_beside_the_trash(root.path());
        assert_eq!(names.len(), 2, "{names:?}");
        let kept = root.path().join(&names[0]);
        assert!(
            names[0].starts_with(&format!(".replaced-{HELLO}-")),
            "{names:?}"
        );
        assert_eq!(version_at(&kept), "1");
        sweep(root.path());
        assert_eq!(version_at(&kept), "1", "no sweep deletes the old copy");
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_trash_makes_a_swap_set_the_old_copy_beside_and_delete_it_in_place() {
        let (root, staged) = installed_and_staged();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("keep.txt"), b"keep").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join(TRASH_DIR)).unwrap();

        let swap = swap_in(root.path(), HELLO, &staged).unwrap();
        let Some(Old::Beside(beside)) = &swap.old else {
            panic!("expected the old copy beside, got {:?}", swap.old);
        };
        assert_eq!(beside.parent(), Some(root.path()));
        assert_eq!(version_at(beside), "1");
        assert!(
            swap.keep().is_none(),
            "deleted in place, not in the background"
        );

        assert_eq!(names_beside_the_trash(root.path()), [HELLO]);
        assert_eq!(version_at(&root.path().join(HELLO)), "2");
        let outside_names: Vec<_> = fs::read_dir(outside.path()).unwrap().flatten().collect();
        assert_eq!(outside_names.len(), 1, "nothing moved through the link");
        assert!(outside.path().join("keep.txt").exists());
    }

    #[test]
    fn deleting_later_moves_the_folder_to_the_trash_and_deletes_it_there() {
        let (root, _) = installed_and_staged();
        delete_later(root.path(), HELLO).unwrap();
        assert!(fs::symlink_metadata(root.path().join(HELLO)).is_err());
        assert_only_hello_in_the_trash(root.path());
        delete_later(root.path(), HELLO).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn deleting_later_without_a_usable_trash_deletes_in_place_without_following_links() {
        let (root, _) = installed_and_staged();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("keep.txt"), b"keep").unwrap();
        let dir = root.path().join(HELLO);
        std::os::unix::fs::symlink(outside.path(), dir.join("escape")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join(TRASH_DIR)).unwrap();

        delete_later(root.path(), HELLO).unwrap();
        assert!(fs::symlink_metadata(&dir).is_err());
        assert!(outside.path().join("keep.txt").exists());
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
    }

    #[test]
    fn an_unsafe_or_dot_id_moves_and_deletes_nothing() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("plugins");
        copy_at(&root.join(".staging-x"), "1");
        copy_at(&tmp.path().join("outside"), "1");
        let staged = root.join(".staging-x");
        for id in ["../outside", ".", ".staging-x", ""] {
            delete_later(&root, id).unwrap_err();
            swap_in(&root, id, &staged).unwrap_err();
        }
        assert_eq!(version_at(&tmp.path().join("outside")), "1");
        assert_eq!(version_at(&staged), "1");
        assert!(!root.join(TRASH_DIR).exists());
    }

    #[test]
    fn sweeping_without_a_trash_does_nothing() {
        let root = TempDir::new().unwrap();
        sweep(root.path());
        assert!(fs::read_dir(root.path()).unwrap().next().is_none());
    }
}
