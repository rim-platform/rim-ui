//! The app's log file: `rim.log` in the OS log directory, rotated at a few megabytes with a
//! bounded number of old files kept. Info and above by default; `RIM_LOG` (`error`, `warn`,
//! `info`, `debug`, `trace`) sets the level of this app's own code, and only lowers the level of
//! its dependencies, whose debug output may carry request contents.

use log::LevelFilter;
use tauri::plugin::TauriPlugin;
use tauri::Runtime;
use tauri_plugin_log::{Builder, RotationStrategy, Target, TargetKind};

/// The environment variable that sets the app's log level.
const LEVEL_VAR: &str = "RIM_LOG";
/// The log file's name, without its `.log` extension.
const FILE_NAME: &str = "rim";
/// Size at which the log file is rotated.
const MAX_FILE_BYTES: u128 = 2 * 1024 * 1024;
/// Rotated files kept besides the current one.
const KEPT_FILES: usize = 4;
/// Log targets of this app's own code, which `RIM_LOG` may raise above info.
const APP_TARGETS: [&str; 3] = ["rim_ui_lib", "rim_mls", "audit"];

/// The level `RIM_LOG` names; info when it is unset or names no level.
fn requested_level(value: Option<&str>) -> LevelFilter {
    match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        Some("off") => LevelFilter::Off,
        Some("error") => LevelFilter::Error,
        Some("warn") => LevelFilter::Warn,
        Some("debug") => LevelFilter::Debug,
        Some("trace") => LevelFilter::Trace,
        _ => LevelFilter::Info,
    }
}

/// The log plugin, writing the log file (and the terminal in a debug build).
pub(crate) fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let level = requested_level(std::env::var(LEVEL_VAR).ok().as_deref());
    let mut builder = Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir {
            file_name: Some(FILE_NAME.into()),
        }))
        .max_file_size(MAX_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEPT_FILES))
        .level(level.min(LevelFilter::Info));
    for target in APP_TARGETS {
        builder = builder.level_for(target, level);
    }
    if cfg!(debug_assertions) {
        builder = builder.target(Target::new(TargetKind::Stdout));
    }
    builder.build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_level_from_rim_log() {
        assert_eq!(requested_level(Some("debug")), LevelFilter::Debug);
        assert_eq!(requested_level(Some(" TRACE ")), LevelFilter::Trace);
        assert_eq!(requested_level(Some("warn")), LevelFilter::Warn);
        assert_eq!(requested_level(Some("error")), LevelFilter::Error);
        assert_eq!(requested_level(Some("off")), LevelFilter::Off);
    }

    #[test]
    fn falls_back_to_info() {
        assert_eq!(requested_level(None), LevelFilter::Info);
        assert_eq!(requested_level(Some("")), LevelFilter::Info);
        assert_eq!(requested_level(Some("verbose")), LevelFilter::Info);
    }
}
