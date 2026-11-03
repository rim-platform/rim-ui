//! The environment for programs the desktop app starts: inside a Linux AppImage, without the
//! AppImage's own directories, so system programs load system libraries.

use std::ffi::OsString;
use std::path::Path;

/// Variables the AppImage launcher points into its mount, as colon-separated lists or single paths.
const APPIMAGE_VARS: &[&str] = &[
    "LD_LIBRARY_PATH",
    "PATH",
    "PYTHONPATH",
    "PERLLIB",
    "QT_PLUGIN_PATH",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "XDG_DATA_DIRS",
    "GSETTINGS_SCHEMA_DIR",
    "PYTHONHOME",
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GTK_PATH",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GIO_MODULE_DIR",
    "GI_TYPELIB_PATH",
];

/// What to change in a child's environment so it does not see the AppImage mount `appdir`:
/// for each variable of [`APPIMAGE_VARS`] in `vars` that names a path under `appdir`, the
/// value with those entries removed, or `None` to unset it when nothing is left.
pub(crate) fn host_env_changes(
    vars: impl IntoIterator<Item = (OsString, OsString)>,
    appdir: &Path,
) -> Vec<(OsString, Option<OsString>)> {
    if appdir.as_os_str().is_empty() || appdir.components().count() <= 1 {
        return Vec::new();
    }
    let mut changes = Vec::new();
    for (name, value) in vars {
        if !APPIMAGE_VARS.iter().any(|known| name == *known) {
            continue;
        }
        let entries: Vec<_> = std::env::split_paths(&value).collect();
        let kept: Vec<_> = entries
            .iter()
            .filter(|entry| !entry.starts_with(appdir))
            .cloned()
            .collect();
        if kept.len() == entries.len() {
            continue;
        }
        if kept.is_empty() {
            changes.push((name, None));
        } else if let Ok(joined) = std::env::join_paths(kept) {
            changes.push((name, Some(joined)));
        }
    }
    changes
}

/// Gives `cmd` the host's environment back when the app runs from an AppImage (`APPIMAGE` and
/// `APPDIR` set); does nothing otherwise.
pub(crate) fn restore_host_env(cmd: &mut tokio::process::Command) {
    if std::env::var_os("APPIMAGE").is_none() {
        return;
    }
    let Some(appdir) = std::env::var_os("APPDIR").filter(|dir| !dir.is_empty()) else {
        return;
    };
    for (name, value) in host_env_changes(std::env::vars_os(), Path::new(&appdir)) {
        match value {
            Some(value) => cmd.env(name, value),
            None => cmd.env_remove(name),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).into(), (*v).into()))
            .collect()
    }

    fn changes(pairs: &[(&str, &str)], appdir: &str) -> Vec<(String, Option<String>)> {
        host_env_changes(vars(pairs), Path::new(appdir))
            .into_iter()
            .map(|(k, v)| {
                (
                    k.to_string_lossy().into_owned(),
                    v.map(|v| v.to_string_lossy().into_owned()),
                )
            })
            .collect()
    }

    #[test]
    fn strips_appimage_entries_and_keeps_the_rest() {
        let result = changes(
            &[
                (
                    "LD_LIBRARY_PATH",
                    "/tmp/.mount_rimX/usr/lib/:/tmp/.mount_rimX/lib/:/opt/foo/lib",
                ),
                ("PATH", "/tmp/.mount_rimX/usr/bin/:/usr/local/bin:/usr/bin"),
                (
                    "XDG_DATA_DIRS",
                    "/tmp/.mount_rimX/usr/share:/usr/share:/usr/local/share",
                ),
                ("HOME", "/home/x"),
            ],
            "/tmp/.mount_rimX",
        );
        assert_eq!(
            result,
            vec![
                ("LD_LIBRARY_PATH".into(), Some("/opt/foo/lib".into())),
                ("PATH".into(), Some("/usr/local/bin:/usr/bin".into())),
                (
                    "XDG_DATA_DIRS".into(),
                    Some("/usr/share:/usr/local/share".into())
                ),
            ]
        );
    }

    #[test]
    fn unsets_a_variable_left_empty() {
        let result = changes(
            &[
                ("LD_LIBRARY_PATH", "/tmp/.mount_rimX/usr/lib/"),
                ("GIO_MODULE_DIR", "/tmp/.mount_rimX//usr/lib/gio/modules"),
            ],
            "/tmp/.mount_rimX",
        );
        assert_eq!(
            result,
            vec![
                ("LD_LIBRARY_PATH".into(), None),
                ("GIO_MODULE_DIR".into(), None),
            ]
        );
    }

    #[test]
    fn leaves_unrelated_values_alone() {
        assert!(changes(&[("PATH", "/usr/bin:/bin")], "/tmp/.mount_rimX").is_empty());
        assert!(changes(
            &[("LD_LIBRARY_PATH", "/tmp/.mount_rimXY/usr/lib")],
            "/tmp/.mount_rimX"
        )
        .is_empty());
    }

    #[test]
    fn ignores_an_empty_or_root_appdir() {
        assert!(changes(&[("PATH", "/usr/bin")], "").is_empty());
        assert!(changes(&[("PATH", "/usr/bin")], "/").is_empty());
    }

    #[test]
    fn restore_host_env_is_a_no_op_outside_an_appimage() {
        if std::env::var_os("APPIMAGE").is_some() {
            return;
        }
        let mut cmd = tokio::process::Command::new("true");
        restore_host_env(&mut cmd);
        assert_eq!(cmd.as_std().get_envs().count(), 0);
    }
}
