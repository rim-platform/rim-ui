//! The script that gives a page Tauri's IPC, run in the top-level frame only. It is Tauri's own
//! script, from `vendor/tauri`, filled in the way Tauri fills it and wrapped in a check that the
//! frame is the top one. Tauri adds its scripts to every frame on Windows, so without the check
//! the sandboxed plugin frames would hold the per-launch invoke key and a way to send IPC.

/// Tauri's script that defines `window.__TAURI_INTERNALS__.postMessage` around the invoke key.
const IPC_PROTOCOL: &str = include_str!("../vendor/tauri/ipc-protocol.js");
/// Tauri's function that serializes an IPC message, inlined into [`IPC_PROTOCOL`].
const PROCESS_IPC_MESSAGE_FN: &str = include_str!("../vendor/tauri/process-ipc-message-fn.js");
/// The command Tauri's channels fetch their data with, as Tauri names it.
const FETCH_CHANNEL_DATA_COMMAND: &str = "plugin:__TAURI_CHANNEL__|fetch";

/// The IPC set-up script for `tauri::Builder::invoke_system`: Tauri's own, run only when the
/// frame is the top-level one, with `__INVOKE_KEY__` left for the builder to fill.
pub(crate) fn script() -> String {
    let protocol = IPC_PROTOCOL
        .replace("__TEMPLATE_invoke_key__", "__INVOKE_KEY__")
        .replace("__RAW_process_ipc_message_fn__", PROCESS_IPC_MESSAGE_FN)
        .replace("__TEMPLATE_os_name__", &json(std::env::consts::OS))
        .replace(
            "__TEMPLATE_fetch_channel_data_command__",
            &json(FETCH_CHANNEL_DATA_COMMAND),
        );
    format!("if (window.top === window) {{\n{protocol}\n}}\n")
}

/// `text` as a JavaScript string literal.
fn json(text: &str) -> String {
    serde_json::Value::String(text.to_owned()).to_string()
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::*;

    #[test]
    fn the_script_runs_only_in_the_top_frame() {
        let script = script();
        assert!(script.starts_with("if (window.top === window) {\n"));
        assert!(script.trim_end().ends_with('}'));
        assert_eq!(script.matches("__INVOKE_KEY__").count(), 1);
        assert!(!script.contains("__TEMPLATE_"));
        assert!(!script.contains("__RAW_"));
        assert!(script.contains(&format!("const osName = {}", json(std::env::consts::OS))));
        assert!(
            script.contains("const fetchChannelDataCommand = \"plugin:__TAURI_CHANNEL__|fetch\"")
        );
        assert!(script.contains("Object.defineProperty(window.__TAURI_INTERNALS__, 'postMessage'"));
    }

    /// The version of `tauri` that `Cargo.lock` pins.
    fn locked_tauri_version() -> String {
        include_str!("../Cargo.lock")
            .split("[[package]]")
            .find(|package| package.contains("\nname = \"tauri\"\n"))
            .and_then(|package| {
                package
                    .lines()
                    .find_map(|line| line.strip_prefix("version = \""))
                    .map(|version| version.trim_end_matches('"').to_owned())
            })
            .expect("tauri is in Cargo.lock")
    }

    /// The source folder of the locked `tauri` in cargo's registry.
    fn locked_tauri_source() -> PathBuf {
        let cargo_home = std::env::var_os("CARGO_HOME")
            .map(PathBuf::from)
            .or_else(|| dirs::home_dir().map(|home| home.join(".cargo")))
            .expect("a cargo home");
        let crate_dir = format!("tauri-{}", locked_tauri_version());
        std::fs::read_dir(cargo_home.join("registry").join("src"))
            .expect("cargo's registry sources")
            .flatten()
            .map(|index| index.path().join(&crate_dir))
            .find(|dir| dir.is_dir())
            .unwrap_or_else(|| panic!("{crate_dir} is not in cargo's registry"))
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
    }

    #[test]
    fn the_vendored_scripts_match_the_locked_tauri() {
        let source = locked_tauri_source();
        assert_eq!(
            IPC_PROTOCOL,
            read(&source.join("scripts/ipc-protocol.js")),
            "copy scripts/ipc-protocol.js of {} to vendor/tauri",
            source.display()
        );
        assert_eq!(
            PROCESS_IPC_MESSAGE_FN,
            read(&source.join("scripts/process-ipc-message-fn.js")),
            "copy scripts/process-ipc-message-fn.js of {} to vendor/tauri",
            source.display()
        );
        assert!(read(&source.join("src/ipc/channel.rs")).contains(&format!(
            "pub const FETCH_CHANNEL_DATA_COMMAND: &str = {};",
            json(FETCH_CHANNEL_DATA_COMMAND)
        )));
        let app = read(&source.join("src/app.rs"));
        assert!(app.contains("#[default_template(\"../scripts/ipc-protocol.js\")]"));
        assert!(app.contains(".replace(\"__INVOKE_KEY__\""));
    }
}
