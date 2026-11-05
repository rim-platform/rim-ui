//! Starting the app when the person signs in to the computer. Nothing is stored here: the
//! operating system's entry is the truth. The entry carries no arguments, so the window always
//! opens.

use std::ffi::{OsStr, OsString};
use std::path::Path;

use auto_launch::{AutoLaunch, AutoLaunchBuilder, WindowsEnableMode};
use serde::Serialize;
use tauri::{AppHandle, Runtime};

/// Characters that keep an entry from starting, in GLib's launcher or in systemd's autostart
/// generator and unit loader, however the entry escapes them. Only an allowed path gets an entry.
#[cfg(target_os = "linux")]
const REFUSED_IN_PATH: [char; 9] = ['"', '$', '%', '\'', '*', '?', '[', '\\', '`'];

/// What Linux appends to the path of a running file that a package upgrade replaced.
const DELETED_SUFFIX: &str = " (deleted)";

/// The state of the setting on this computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartAtLogin {
    enabled: bool,
    /// Whether the app runs from an AppImage, whose file the person can move.
    app_image: bool,
    /// Whether the running path can go in an entry.
    path_allowed: bool,
}

/// The path the entry starts: the AppImage when there is one, otherwise `exe`, without the suffix
/// of a replaced file.
///
/// # Errors
///
/// A message when the path is not valid UTF-8.
fn entry_path(appimage: Option<&OsStr>, exe: &Path) -> Result<String, String> {
    let path = appimage.unwrap_or(exe.as_os_str());
    let path = path
        .to_str()
        .ok_or_else(|| format!("the path {} is not UTF-8", path.to_string_lossy()))?;
    Ok(path.strip_suffix(DELETED_SUFFIX).unwrap_or(path).to_owned())
}

/// `path` as the `Exec` value of a desktop entry, in double quotes.
///
/// # Errors
///
/// A message when the path holds a control character or one of [`REFUSED_IN_PATH`].
#[cfg(target_os = "linux")]
fn quote_for_entry(path: &str) -> Result<String, String> {
    let refused = path
        .chars()
        .find(|character| character.is_control() || REFUSED_IN_PATH.contains(character));
    match refused {
        None => Ok(format!("\"{path}\"")),
        Some(control) if control.is_control() => {
            Err("RIM can't start at sign-in from a path containing a control character".to_owned())
        }
        Some(character) => Err(format!(
            "RIM can't start at sign-in from a path containing {character}"
        )),
    }
}

/// `path` as the command of a Windows Run value: in double quotes.
///
/// # Errors
///
/// A message when the path holds a double quote, which a Run value cannot carry.
#[cfg(windows)]
fn quote_for_entry(path: &str) -> Result<String, String> {
    if path.contains('"') {
        return Err(format!("the path {path} holds a double quote"));
    }
    Ok(format!("\"{path}\""))
}

/// `path` unchanged: other platforms take it as it is.
///
/// # Errors
///
/// Never; the signature matches the other platforms.
#[cfg(not(any(target_os = "linux", windows)))]
fn quote_for_entry(path: &str) -> Result<String, String> {
    Ok(path.to_owned())
}

/// The value of `APPIMAGE` as the app read it at start.
#[cfg(target_os = "linux")]
fn appimage<R: Runtime>(app: &AppHandle<R>) -> Option<OsString> {
    use tauri::Manager;

    app.env().appimage
}

/// Only Linux has AppImages.
#[cfg(not(target_os = "linux"))]
fn appimage<R: Runtime>(_app: &AppHandle<R>) -> Option<OsString> {
    None
}

/// The operating system's entry with `command` as what it starts.
///
/// # Errors
///
/// A message when the entry cannot be described on this platform.
fn entry<R: Runtime>(app: &AppHandle<R>, command: &str) -> Result<AutoLaunch, String> {
    AutoLaunchBuilder::new()
        .set_app_name(&app.package_info().name)
        .set_app_path(command)
        .set_windows_enable_mode(WindowsEnableMode::CurrentUser)
        .build()
        .map_err(|error| error.to_string())
}

/// The entry for reading or removing it, which go by its name alone, so they work from any path.
///
/// # Errors
///
/// A message when the entry cannot be described on this platform.
fn existing_entry<R: Runtime>(app: &AppHandle<R>) -> Result<AutoLaunch, String> {
    entry(app, "")
}

/// The command an entry needs to start the running app.
///
/// # Errors
///
/// A message when the running path is unknown or cannot go in an entry.
fn running_app_command<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("could not find the running file: {error}"))?;
    quote_for_entry(&entry_path(appimage(app).as_deref(), &exe)?)
}

/// The entry for writing it, starting the running app.
///
/// # Errors
///
/// A message when the running path is unknown or cannot go in an entry.
fn entry_for_running_app<R: Runtime>(app: &AppHandle<R>) -> Result<AutoLaunch, String> {
    entry(app, &running_app_command(app)?)
}

/// The setting as the operating system's entry says.
///
/// # Errors
///
/// A message when the entry cannot be read.
pub(super) fn state<R: Runtime>(app: &AppHandle<R>) -> Result<StartAtLogin, String> {
    let enabled = existing_entry(app)?
        .is_enabled()
        .map_err(|error| error.to_string())?;
    Ok(StartAtLogin {
        enabled,
        app_image: appimage(app).is_some(),
        path_allowed: running_app_command(app).is_ok(),
    })
}

/// Creates or removes the operating system's entry.
///
/// # Errors
///
/// A message when the entry cannot be written or removed, or the running path cannot go in one.
pub(super) fn set<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    let changed = if enabled {
        entry_for_running_app(app)?.enable()
    } else {
        existing_entry(app)?.disable()
    };
    changed.map_err(|error| error.to_string())
}

/// Rewrites an enabled entry at the running path, so moving an AppImage and opening it once
/// mends the entry. Does nothing in a dev build, or when the entry is not enabled. A failure,
/// such as a running path that cannot go in an entry, is logged, leaves the entry as it is, and
/// start-up continues.
pub(super) fn mend<R: Runtime>(app: &AppHandle<R>) {
    if tauri::is_dev() {
        return;
    }
    if let Err(error) = rewrite_if_enabled(app) {
        log::warn!("could not mend the start-at-login entry: {error}");
    }
}

fn rewrite_if_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if existing_entry(app)?
        .is_enabled()
        .map_err(|error| error.to_string())?
    {
        entry_for_running_app(app)?
            .enable()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_entry_starts_the_running_file_without_an_appimage() {
        let path = entry_path(None, Path::new("/usr/bin/rim-ui")).unwrap();
        assert_eq!(path, "/usr/bin/rim-ui");
    }

    #[test]
    fn the_entry_starts_the_appimage_when_there_is_one() {
        let path = entry_path(
            Some(OsStr::new("/home/a b/RIM.AppImage")),
            Path::new("/tmp/.mount_RIMabc/usr/bin/rim-ui"),
        )
        .unwrap();
        assert_eq!(path, "/home/a b/RIM.AppImage");
    }

    #[test]
    fn the_suffix_of_a_replaced_file_goes() {
        let path = entry_path(None, Path::new("/usr/bin/rim-ui (deleted)")).unwrap();
        assert_eq!(path, "/usr/bin/rim-ui");
    }

    #[test]
    fn the_suffix_goes_only_from_the_end() {
        let path = entry_path(None, Path::new("/a (deleted)/rim-ui")).unwrap();
        assert_eq!(path, "/a (deleted)/rim-ui");
    }

    #[cfg(unix)]
    #[test]
    fn a_path_that_is_not_utf8_is_an_error() {
        use std::os::unix::ffi::OsStrExt;

        let bad = OsStr::from_bytes(b"/a/\xff/rim-ui");
        assert!(entry_path(Some(bad), Path::new("/usr/bin/rim-ui")).is_err());
        assert!(entry_path(None, Path::new(bad)).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_wraps_an_allowed_path_in_double_quotes() {
        let cases = [
            ("/usr/bin/rim-ui", r#""/usr/bin/rim-ui""#),
            ("/home/a b/RIM.AppImage", r#""/home/a b/RIM.AppImage""#),
            ("/a (b) #1 & c;d/rim-ui", r#""/a (b) #1 & c;d/rim-ui""#),
            ("/-a/b]/~,=!+@:{}^|<>", r#""/-a/b]/~,=!+@:{}^|<>""#),
            (
                "/home/\u{17e}/\u{1f600}/rim-ui",
                "\"/home/\u{17e}/\u{1f600}/rim-ui\"",
            ),
        ];
        for (path, written) in cases {
            assert_eq!(quote_for_entry(path).unwrap(), written, "{path}");
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_refuses_each_character_that_keeps_an_entry_from_starting() {
        for character in ['"', '$', '%', '\'', '*', '?', '[', '\\', '`'] {
            assert_eq!(
                quote_for_entry(&format!("/a{character}b/rim-ui")).unwrap_err(),
                format!("RIM can't start at sign-in from a path containing {character}"),
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_refuses_control_characters() {
        for path in ["/a\nb", "/a\tb", "/a\rb", "/a\u{7f}b", "/a\u{85}b"] {
            assert!(quote_for_entry(path).is_err(), "{path:?}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_quotes_the_path() {
        assert_eq!(
            quote_for_entry(r"C:\Program Files\RIM\rim-ui.exe").unwrap(),
            r#""C:\Program Files\RIM\rim-ui.exe""#
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_refuses_a_double_quote() {
        assert!(quote_for_entry("C:\\a\"b\\rim-ui.exe").is_err());
    }

    #[cfg(not(any(target_os = "linux", windows)))]
    #[test]
    fn other_platforms_keep_the_path() {
        assert_eq!(quote_for_entry("/a b/$c").unwrap(), "/a b/$c");
    }

    #[test]
    fn the_state_serializes_in_camel_case() {
        let state = StartAtLogin {
            enabled: true,
            app_image: false,
            path_allowed: true,
        };
        assert_eq!(
            serde_json::to_value(state).unwrap(),
            serde_json::json!({ "enabled": true, "appImage": false, "pathAllowed": true })
        );
    }
}
