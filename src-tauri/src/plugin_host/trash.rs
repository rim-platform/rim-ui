//! The plugins folder's trash: uninstall, update and a failed install move a
//! plugin's folder into `<plugins_root>/.trash/` at once and delete it there in
//! the background. An update keeps the copy it replaces beside it until the new
//! one is ready, and the next start puts back one a crash left there. No step
//! follows a symlink: a link loses only itself, never its target.

use crate::plugin_host::plugin_protocol::is_safe_segment;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::async_runtime::JoinHandle;

/// Name of the trash folder inside the plugins folder. It starts with `.`, so
/// no plugin id names it and discovery skips it.
pub const TRASH_DIR: &str = ".trash";

/// Moves `<plugins_root>/<plugin_id>` into the trash under `plugins_root` and
/// returns where it went. The trash is created when missing.
///
/// # Errors
///
/// Returns an error for an id that is not a safe path segment or starts with
/// `.`, for a trash that is a link or not a folder, and when the move fails.
pub fn move_to_trash(plugins_root: &Path, plugin_id: &str) -> std::io::Result<PathBuf> {
    check_plugin_id(plugin_id)?;
    trash_entry(plugins_root, plugin_id, plugin_id)
}

/// Moves the entry `name` under `plugins_root` into the trash as a copy of
/// `plugin_id` and returns where it went, with the checks of [`move_to_trash`]
/// on the trash.
fn trash_entry(plugins_root: &Path, name: &str, plugin_id: &str) -> std::io::Result<PathBuf> {
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
    std::fs::rename(plugins_root.join(name), &trashed)?;
    Ok(trashed)
}

/// Refuses an id that is not a safe path segment or starts with `.`, the names
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

/// Deletes the trash entry `trashed` of `plugin_id` on a blocking thread. Nobody
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

/// Deletes `<plugins_root>/<plugin_id>` without waiting for it: it moves into
/// the trash and goes there in the background. When the trash cannot take it (a
/// link or a file in its place, another filesystem), it is deleted here instead,
/// without following a link. A missing folder is not an error.
///
/// # Errors
///
/// Returns an error for an unsafe id, or when the folder can be neither
/// trashed nor deleted here.
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

/// Prefix of the name a replaced copy of a plugin waits under, beside its
/// folder, while an update finishes: `.replaced-<plugin_id>-<uuid v7>`.
const REPLACED_PREFIX: &str = ".replaced-";

/// A new `.replaced-` name for a copy of `plugin_id`.
fn replaced_name(plugin_id: &str) -> String {
    format!("{REPLACED_PREFIX}{plugin_id}-{}", uuid::Uuid::now_v7())
}

/// The plugin id and uuid of a `.replaced-<plugin_id>-<uuid v7>` name, when the
/// id passes [`check_plugin_id`].
fn parse_replaced(name: &str) -> Option<(String, uuid::Uuid)> {
    let rest = name.strip_prefix(REPLACED_PREFIX)?;
    let split = rest.len().checked_sub(37)?;
    let plugin_id = rest.get(..split)?;
    let uuid = uuid::Uuid::parse_str(rest.get(split..)?.strip_prefix('-')?).ok()?;
    if uuid.get_version_num() != 7 || check_plugin_id(plugin_id).is_err() {
        return None;
    }
    Some((plugin_id.to_string(), uuid))
}

/// A new copy of a plugin moved into `<plugins_root>/<plugin_id>`, with the
/// copy it replaced waiting beside it under a `.replaced-` name until
/// [`Swap::keep`] or [`Swap::undo`]. A `.replaced-` copy a crash leaves behind
/// is put back by [`recover_replaced`].
#[must_use]
#[derive(Debug)]
pub struct Swap {
    plugins_root: PathBuf,
    plugin_id: String,
    /// The name the replaced copy waits under; `None` when there was none.
    replaced: Option<String>,
}

/// Moves `staged` into `<plugins_root>/<plugin_id>`. A folder already there
/// moves to a `.replaced-` name beside it first, and comes back when `staged`
/// cannot move in. `staged` must be on the same filesystem as the plugins
/// folder.
///
/// # Errors
///
/// Returns an error for an unsafe id, or when a rename fails.
pub fn swap_in(plugins_root: &Path, plugin_id: &str, staged: &Path) -> std::io::Result<Swap> {
    check_plugin_id(plugin_id)?;
    let dir = plugins_root.join(plugin_id);
    let replaced = match std::fs::symlink_metadata(&dir) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
        Ok(_) => {
            let name = replaced_name(plugin_id);
            std::fs::rename(&dir, plugins_root.join(&name))?;
            Some(name)
        }
    };
    let swap = Swap {
        plugins_root: plugins_root.to_path_buf(),
        plugin_id: plugin_id.to_string(),
        replaced,
    };
    if let Err(e) = std::fs::rename(staged, &dir) {
        // The rename's error is the one to report; a failed put-back is logged.
        let _ = swap.put_back();
        return Err(e);
    }
    Ok(swap)
}

impl Swap {
    /// Keeps the new copy and deletes the replaced one: it moves into the trash
    /// and goes there in the background, returning the handle. When the trash
    /// cannot take it, it is deleted here instead, without following a link.
    pub fn keep(self) -> Option<JoinHandle<()>> {
        let name = self.replaced?;
        match trash_entry(&self.plugins_root, &name, &self.plugin_id) {
            Ok(trashed) => Some(delete_in_background(&self.plugin_id, trashed)),
            Err(e) => {
                let replaced = self.plugins_root.join(&name);
                // Renamed out of recovery's reach first, so a delete that stops
                // part-way is never put back.
                let doomed = self.plugins_root.join(format!(
                    ".deleting-{}-{}",
                    self.plugin_id,
                    uuid::Uuid::now_v7()
                ));
                let path = match std::fs::rename(&replaced, &doomed) {
                    Ok(()) => doomed,
                    Err(_) => replaced,
                };
                log::warn!(
                    "[AUDIT] event=plugin_trash_skipped plugin_id={} path={} error={e}",
                    self.plugin_id,
                    path.display()
                );
                log_deleted_in_place(&self.plugin_id, &path, &delete_trashed(&path));
                None
            }
        }
    }

    /// Drops the new copy without waiting for its deletion and puts the replaced
    /// one back.
    ///
    /// # Errors
    ///
    /// Returns an error when the replaced copy cannot go back; a failure to
    /// delete the new copy is logged.
    pub fn undo(self) -> std::io::Result<()> {
        if let Err(e) = delete_later(&self.plugins_root, &self.plugin_id) {
            log::warn!(
                "[AUDIT] event=plugin_replace_undo_failed plugin_id={} error={e}",
                self.plugin_id
            );
        }
        self.put_back()
    }

    /// Moves the replaced copy back to `<plugins_root>/<plugin_id>`. One that
    /// cannot go back keeps its `.replaced-` name for [`recover_replaced`].
    fn put_back(self) -> std::io::Result<()> {
        let Some(name) = self.replaced else {
            return Ok(());
        };
        let dir = self.plugins_root.join(&self.plugin_id);
        let aside = self.plugins_root.join(&name);
        std::fs::rename(&aside, &dir).inspect_err(|e| {
            log::warn!(
                "[AUDIT] event=plugin_replace_restore_failed plugin_id={} path={} kept={} error={e}",
                self.plugin_id,
                dir.display(),
                aside.display()
            )
        })
    }
}

/// Puts back the copies updates left under `.replaced-` names when they did not
/// finish, before discovery reads the plugins folder. The newest
/// `.replaced-<plugin_id>-<uuid v7>` folder of each id takes
/// `<plugins_root>/<plugin_id>` again; the unfinished copy that was there and
/// older `.replaced-` copies of the id move into the trash, for the sweep to
/// delete. A link, or a name whose id is unsafe, is left alone. Only renames: a
/// step that fails leaves things as they are, and is logged.
pub fn recover_replaced(plugins_root: &Path) {
    let Ok(entries) = std::fs::read_dir(plugins_root) else {
        return;
    };
    let mut copies: BTreeMap<String, Vec<(uuid::Uuid, String)>> = BTreeMap::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !name.starts_with(REPLACED_PREFIX) {
            continue;
        }
        let path = entry.path();
        let Some((plugin_id, uuid)) = parse_replaced(&name) else {
            log::warn!(
                "[AUDIT] event=plugin_replaced_ignored path={} reason=unrecognized_name",
                path.display()
            );
            continue;
        };
        if !std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir()) {
            log::warn!(
                "[AUDIT] event=plugin_replaced_ignored path={} reason=not_a_folder",
                path.display()
            );
            continue;
        }
        copies.entry(plugin_id).or_default().push((uuid, name));
    }
    for (plugin_id, mut names) in copies {
        names.sort();
        let Some((_, newest)) = names.pop() else {
            continue;
        };
        if !put_replaced_back(plugins_root, &plugin_id, &newest) {
            continue;
        }
        for (_, older) in names {
            match trash_entry(plugins_root, &older, &plugin_id) {
                Ok(trashed) => log::warn!(
                    "[AUDIT] event=plugin_replaced_trashed plugin_id={plugin_id} path={} trash={}",
                    plugins_root.join(&older).display(),
                    trashed.display()
                ),
                Err(e) => log::warn!(
                    "[AUDIT] event=plugin_replaced_trash_failed plugin_id={plugin_id} path={} error={e}",
                    plugins_root.join(&older).display()
                ),
            }
        }
    }
}

/// Moves the copy at `<plugins_root>/<plugin_id>`, if any, into the trash and the
/// `.replaced-` copy `name` back in its place, and returns whether it went back.
fn put_replaced_back(plugins_root: &Path, plugin_id: &str, name: &str) -> bool {
    let dir = plugins_root.join(plugin_id);
    let replaced = plugins_root.join(name);
    match std::fs::symlink_metadata(&dir) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            log::warn!(
                "[AUDIT] event=plugin_update_recovery_failed plugin_id={plugin_id} path={} error={e}",
                dir.display()
            );
            return false;
        }
        Ok(_) => match move_to_trash(plugins_root, plugin_id) {
            Ok(trashed) => log::warn!(
                "[AUDIT] event=plugin_unfinished_update_trashed plugin_id={plugin_id} path={} trash={}",
                dir.display(),
                trashed.display()
            ),
            Err(e) => {
                log::warn!(
                    "[AUDIT] event=plugin_update_recovery_failed plugin_id={plugin_id} path={} error={e}",
                    dir.display()
                );
                return false;
            }
        },
    }
    match std::fs::rename(&replaced, &dir) {
        Ok(()) => {
            log::warn!(
                "[AUDIT] event=plugin_update_rolled_back plugin_id={plugin_id} path={} from={}",
                dir.display(),
                replaced.display()
            );
            true
        }
        Err(e) => {
            log::warn!(
                "[AUDIT] event=plugin_update_recovery_failed plugin_id={plugin_id} path={} error={e}",
                replaced.display()
            );
            false
        }
    }
}

/// Deletes the trash entry at `path`: a link loses only itself, a folder goes
/// with everything in it, and a file is removed.
///
/// # Errors
///
/// Returns the IO error of the removal.
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

/// Deletes everything in the trash under `plugins_root`. A trash that is a link
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
    // Listed first, so a folder trashed after the sweep starts is not taken.
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

/// Removes the link at `path`. A directory link on Windows goes with
/// `remove_dir`, which removes only the link.
///
/// # Errors
///
/// Returns the IO error of the removal.
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

    /// The `.replaced-` names under `root`, sorted.
    fn replaced_names(root: &Path) -> Vec<String> {
        names_beside_the_trash(root)
            .into_iter()
            .filter(|name| name.starts_with(REPLACED_PREFIX))
            .collect()
    }

    /// A replaced copy of [`HELLO`] under `root` whose `version.txt` reads
    /// `version`, named newer than any made before it.
    fn replaced_at(root: &Path, version: &str) -> PathBuf {
        let path = root.join(replaced_name(HELLO));
        copy_at(&path, version);
        path
    }

    #[test]
    fn a_swap_keeps_the_old_copy_beside_until_kept_then_deletes_it_from_the_trash() {
        let (root, staged) = installed_and_staged();
        let swap = swap_in(root.path(), HELLO, &staged).unwrap();
        assert_eq!(version_at(&root.path().join(HELLO)), "2");
        let replaced = replaced_names(root.path());
        assert_eq!(replaced.len(), 1, "{replaced:?}");
        assert!(replaced[0].starts_with(&format!(".replaced-{HELLO}-")));
        assert_eq!(version_at(&root.path().join(&replaced[0])), "1");
        assert!(
            !root.path().join(TRASH_DIR).exists(),
            "not in the trash yet"
        );

        let deleting = swap
            .keep()
            .expect("the old copy is deleted in the background");
        tauri::async_runtime::block_on(deleting).unwrap();
        assert_eq!(names_beside_the_trash(root.path()), [HELLO]);
        assert!(fs::read_dir(root.path().join(TRASH_DIR))
            .unwrap()
            .next()
            .is_none());
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
        assert_eq!(names_beside_the_trash(root.path()), [HELLO]);
        assert!(!root.path().join(TRASH_DIR).exists());
    }

    #[test]
    fn a_swap_whose_new_copy_cannot_move_in_puts_the_old_one_back() {
        let (root, _) = installed_and_staged();
        let missing = root.path().join(".staging-missing");
        swap_in(root.path(), HELLO, &missing).unwrap_err();
        assert_eq!(version_at(&root.path().join(HELLO)), "1");
        assert!(replaced_names(root.path()).is_empty());
        assert!(!root.path().join(TRASH_DIR).exists());
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
    fn an_old_copy_that_cannot_go_back_waits_beside_for_recovery_not_the_sweep() {
        let (root, staged) = installed_and_staged();
        let swap = swap_in(root.path(), HELLO, &staged).unwrap();
        // The new copy still holds the name, so the old one cannot take it back.
        swap.put_back().unwrap_err();
        assert_eq!(version_at(&root.path().join(HELLO)), "2");
        let replaced = replaced_names(root.path());
        assert_eq!(replaced.len(), 1, "{replaced:?}");
        fs::create_dir_all(root.path().join(TRASH_DIR)).unwrap();
        sweep(root.path());
        assert_eq!(replaced_names(root.path()), replaced, "the sweep leaves it");
        assert_eq!(version_at(&root.path().join(&replaced[0])), "1");
    }

    #[cfg(unix)]
    #[test]
    fn a_kept_swap_without_a_usable_trash_deletes_the_old_copy_in_place() {
        let (root, staged) = installed_and_staged();
        let outside = TempDir::new().unwrap();
        fs::write(outside.path().join("keep.txt"), b"keep").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join(TRASH_DIR)).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join(HELLO).join("escape")).unwrap();

        let swap = swap_in(root.path(), HELLO, &staged).unwrap();
        assert!(
            swap.keep().is_none(),
            "deleted in place, not in the background"
        );
        assert_eq!(names_beside_the_trash(root.path()), [HELLO]);
        assert_eq!(version_at(&root.path().join(HELLO)), "2");
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
        assert!(outside.path().join("keep.txt").exists());
    }

    #[test]
    fn recovery_puts_the_newest_replaced_copy_back_and_trashes_the_rest() {
        let root = TempDir::new().unwrap();
        copy_at(&root.path().join(HELLO), "unfinished");
        replaced_at(root.path(), "1");
        replaced_at(root.path(), "2");

        recover_replaced(root.path());
        assert_eq!(version_at(&root.path().join(HELLO)), "2");
        assert!(replaced_names(root.path()).is_empty());
        let trashed: Vec<_> = fs::read_dir(root.path().join(TRASH_DIR))
            .unwrap()
            .flatten()
            .map(|e| version_at(&e.path()))
            .collect();
        assert_eq!(trashed.len(), 2, "{trashed:?}");
        assert!(trashed.contains(&"unfinished".to_string()));
        assert!(trashed.contains(&"1".to_string()));
        assert_only_hello_in_the_trash(root.path());
    }

    #[test]
    fn recovery_without_a_current_copy_only_puts_the_replaced_one_back() {
        let root = TempDir::new().unwrap();
        replaced_at(root.path(), "1");
        recover_replaced(root.path());
        assert_eq!(version_at(&root.path().join(HELLO)), "1");
        assert_eq!(names_beside_the_trash(root.path()), [HELLO]);
        assert!(!root.path().join(TRASH_DIR).exists());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_leaves_a_replaced_link_and_unsafe_names_alone() {
        let root = TempDir::new().unwrap();
        copy_at(&root.path().join(HELLO), "current");
        let outside = TempDir::new().unwrap();
        copy_at(outside.path(), "outside");
        let link = root.path().join(replaced_name(HELLO));
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        let uuid = uuid::Uuid::now_v7();
        let unsafe_names = [
            format!(".replaced-..-{uuid}"),
            format!(".replaced-.trash-{uuid}"),
            format!(".replaced-{HELLO}-not-a-uuid"),
            format!(".replaced-{HELLO}-{}", uuid::Uuid::new_v4()),
        ];
        for name in &unsafe_names {
            copy_at(&root.path().join(name), "unsafe");
        }

        recover_replaced(root.path());
        assert_eq!(version_at(&root.path().join(HELLO)), "current");
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(version_at(outside.path()), "outside");
        for name in &unsafe_names {
            assert_eq!(version_at(&root.path().join(name)), "unsafe", "{name}");
        }
        assert!(!root.path().join(TRASH_DIR).exists());
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
