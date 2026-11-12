//! The desktop shell's settings file, `desktop-settings.json` in the app config directory.

use std::fs;
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// What closing the main window does.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CloseAction {
    /// The page asks the person each time.
    #[default]
    Ask,
    /// The window hides and the app keeps running with a tray icon.
    Tray,
    /// The app quits.
    Quit,
}

/// The settings the Rust side needs before the webview has loaded.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct DesktopSettings {
    pub(crate) close_action: CloseAction,
    /// Whether agents on this computer may reach the app through the agent bridge.
    pub(crate) agents_enabled: bool,
}

/// Reads the settings at `path`. A missing, unreadable or malformed file, or an unknown
/// `closeAction`, reads as the default; unknown fields are ignored.
pub(crate) fn load(path: &Path) -> DesktopSettings {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) => {
            if error.kind() != std::io::ErrorKind::NotFound {
                log::warn!("could not read {}: {error}", path.display());
            }
            return DesktopSettings::default();
        }
    };
    serde_json::from_str(&raw).unwrap_or_else(|error| {
        log::warn!("{} is not readable: {error}", path.display());
        DesktopSettings::default()
    })
}

/// Writes the settings at `path`, creating its directory. The file is written next to `path`
/// and renamed over it, so a crash cannot leave half a file.
///
/// # Errors
///
/// A message naming the step that failed.
pub(crate) fn save(path: &Path, settings: &DesktopSettings) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    fs::create_dir_all(dir)
        .map_err(|error| format!("could not create {}: {error}", dir.display()))?;
    let raw = serde_json::to_vec_pretty(settings)
        .map_err(|error| format!("could not encode the settings: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    let written = write_synced(&temporary, &raw).and_then(|()| fs::rename(&temporary, path));
    written.map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("could not write {}: {error}", path.display())
    })
}

/// Writes `bytes` to a new file at `path` and flushes it to the disk.
fn write_synced(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRAY: DesktopSettings = DesktopSettings {
        close_action: CloseAction::Tray,
        agents_enabled: false,
    };

    fn settings_file(contents: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop-settings.json");
        fs::write(&path, contents).unwrap();
        (dir, path)
    }

    #[test]
    fn a_missing_file_reads_as_ask() {
        let dir = tempfile::tempdir().unwrap();
        let settings = load(&dir.path().join("desktop-settings.json"));
        assert_eq!(settings.close_action, CloseAction::Ask);
    }

    #[test]
    fn a_corrupt_file_reads_as_ask() {
        let (_dir, path) = settings_file("{ not json");
        assert_eq!(load(&path).close_action, CloseAction::Ask);
    }

    #[test]
    fn an_unknown_close_action_reads_as_ask() {
        let (_dir, path) = settings_file(r#"{ "closeAction": "minimize" }"#);
        assert_eq!(load(&path).close_action, CloseAction::Ask);
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let (_dir, path) = settings_file(r#"{ "closeAction": "quit", "later": 1 }"#);
        assert_eq!(load(&path).close_action, CloseAction::Quit);
    }

    #[test]
    fn a_file_without_the_field_reads_as_ask() {
        let (_dir, path) = settings_file("{}");
        assert_eq!(load(&path).close_action, CloseAction::Ask);
    }

    #[test]
    fn save_then_load_round_trips_and_creates_the_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new").join("desktop-settings.json");
        save(&path, &TRAY).unwrap();
        assert_eq!(load(&path), TRAY);
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains(r#""closeAction": "tray""#), "{raw}");
        let names: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, ["desktop-settings.json"]);
    }

    #[test]
    fn save_replaces_the_previous_file() {
        let (_dir, path) = settings_file(r#"{ "closeAction": "quit" }"#);
        save(&path, &TRAY).unwrap();
        assert_eq!(load(&path), TRAY);
    }

    #[test]
    fn loads_with_agents_off_when_the_field_is_missing() {
        let (_dir, path) = settings_file(r#"{ "closeAction": "quit" }"#);
        assert!(!load(&path).agents_enabled);
    }

    #[test]
    fn saves_and_loads_agents_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop-settings.json");
        let settings = DesktopSettings {
            agents_enabled: true,
            ..TRAY
        };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains(r#""agentsEnabled": true"#), "{raw}");
    }

    #[test]
    fn save_reports_a_directory_that_cannot_be_created() {
        let (_dir, blocker) = settings_file("");
        let path = blocker.join("desktop-settings.json");
        assert!(save(&path, &TRAY).is_err());
    }
}
