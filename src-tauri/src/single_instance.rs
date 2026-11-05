//! One running copy of the desktop app per data directory: starting it again brings the running
//! window forward, and the new process exits before it opens anything.

use std::path::Path;

use sha2::{Digest, Sha256};
use tauri::{plugin::TauriPlugin, Runtime};

use crate::desktop_shell::show_main_window;

/// The id the running copy claims on the D-Bus session bus: `identifier` plus a hash of
/// `data_dir`, so copies with different data directories run side by side.
fn instance_id(identifier: &str, data_dir: &Path) -> String {
    let digest = Sha256::digest(data_dir.as_os_str().as_encoded_bytes());
    format!("{identifier}.d{}", hex::encode(&digest[..8]))
}

/// The plugin that enforces one running copy for the app `identifier`. Register it before every
/// other plugin. Windows ignores the D-Bus id and allows one copy per session.
pub(crate) fn plugin<R: Runtime>(identifier: &str) -> TauriPlugin<R> {
    let builder = tauri_plugin_single_instance::Builder::new().callback(|app, _args, _cwd| {
        log::info!("the app was started again: showing the running window");
        show_main_window(app);
    });
    match dirs::data_dir() {
        Some(data_dir) => builder.dbus_id(instance_id(identifier, &data_dir)),
        None => builder,
    }
    .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDENTIFIER: &str = "com.rim.rim-ui";

    #[test]
    fn instance_id_is_stable_for_one_data_directory() {
        let dir = Path::new("/home/someone/.local/share");
        assert_eq!(instance_id(IDENTIFIER, dir), instance_id(IDENTIFIER, dir));
    }

    #[test]
    fn instance_id_differs_between_data_directories() {
        assert_ne!(
            instance_id(IDENTIFIER, Path::new("/home/someone/.local/share")),
            instance_id(IDENTIFIER, Path::new("/tmp/rim-second")),
        );
    }

    /// The D-Bus rules for a well-known name: at least two elements, each non-empty, not starting
    /// with a digit, made of `[A-Za-z0-9_-]`, and 255 bytes at most in all.
    #[test]
    fn instance_id_makes_a_valid_bus_name() {
        let id = instance_id(IDENTIFIER, Path::new("/tmp/rim-second"));
        let name = format!("{id}.SingleInstance");
        assert!(name.len() <= 255);
        for element in name.split('.') {
            assert!(!element.is_empty());
            assert!(!element.starts_with(|c: char| c.is_ascii_digit()));
            assert!(element
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
        }
    }
}
