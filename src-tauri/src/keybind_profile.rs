//! Saving and opening keybind profile files through the native file dialogs.
//!
//! The dialogs open from here, so the webview needs no `dialog:*` or file-system permission
//! and only ever sees the one file the user chose. The webview validates the profile itself;
//! this side only moves text between the file and the webview.

use std::io::Read;
use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Largest profile file read or written.
const MAX_PROFILE_BYTES: u64 = 256 * 1024;

/// File name offered in the save dialog: `name` without any path, ending in `.json`.
fn suggested_file_name(name: &str) -> String {
    let base: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .collect();
    let base = base.trim().trim_start_matches('.');
    let base = if base.is_empty() {
        "rim-keybinds.json"
    } else {
        base
    };
    if base.to_ascii_lowercase().ends_with(".json") {
        base.to_string()
    } else {
        format!("{base}.json")
    }
}

/// The text of the profile file at `path`, refused when it is too large or not UTF-8.
fn read_profile(path: &Path) -> Result<String, String> {
    let file =
        std::fs::File::open(path).map_err(|e| format!("could not open {}: {e}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(MAX_PROFILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("could not read {}: {e}", path.display()))?;
    if bytes.len() as u64 > MAX_PROFILE_BYTES {
        return Err(format!(
            "{} is larger than {} KiB, too large for a keybind profile",
            path.display(),
            MAX_PROFILE_BYTES / 1024
        ));
    }
    String::from_utf8(bytes).map_err(|_| format!("{} is not a text file", path.display()))
}

/// Ask where to save a keybind profile and write `contents` there. Returns the path written,
/// or `None` when the user cancels.
#[tauri::command]
pub async fn keybind_profile_save(
    app: AppHandle,
    file_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    if contents.len() as u64 > MAX_PROFILE_BYTES {
        return Err("the profile is too large to save".into());
    }
    let file_name = suggested_file_name(&file_name);
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Save keybind profile")
            .set_file_name(&file_name)
            .add_filter("Keybind profile", &["json"])
            .blocking_save_file();
        let Some(picked) = picked else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|e| format!("not a local file: {e}"))?;
        std::fs::write(&path, contents)
            .map_err(|e| format!("could not write {}: {e}", path.display()))?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| format!("saving the profile failed: {e}"))?
}

/// Ask for a keybind profile file and return its text, or `None` when the user cancels.
#[tauri::command]
pub async fn keybind_profile_open(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app
            .dialog()
            .file()
            .set_title("Import keybind profile")
            .add_filter("Keybind profile", &["json"])
            .blocking_pick_file();
        let Some(picked) = picked else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|e| format!("not a local file: {e}"))?;
        read_profile(&path).map(Some)
    })
    .await
    .map_err(|e| format!("opening the profile failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggested_file_name_keeps_a_json_name() {
        assert_eq!(
            suggested_file_name("rim-keybinds-vim.json"),
            "rim-keybinds-vim.json"
        );
        assert_eq!(suggested_file_name("Profile.JSON"), "Profile.JSON");
    }

    #[test]
    fn suggested_file_name_adds_the_extension() {
        assert_eq!(suggested_file_name("my profile"), "my profile.json");
    }

    #[test]
    fn suggested_file_name_drops_any_path() {
        assert_eq!(suggested_file_name("../../etc/passwd"), "passwd.json");
        assert_eq!(suggested_file_name("C:\\Users\\x\\vim.json"), "vim.json");
        assert_eq!(suggested_file_name("/"), "rim-keybinds.json");
    }

    #[test]
    fn suggested_file_name_refuses_hidden_and_empty_names() {
        assert_eq!(suggested_file_name(""), "rim-keybinds.json");
        assert_eq!(suggested_file_name(".bashrc"), "bashrc.json");
        assert_eq!(suggested_file_name("a\u{0}b"), "ab.json");
    }

    #[test]
    fn read_profile_returns_the_text() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("p.json");
        std::fs::write(&path, "{\"format\":\"rim.keybind-profile\"}").expect("write");
        assert_eq!(
            read_profile(&path).expect("read"),
            "{\"format\":\"rim.keybind-profile\"}"
        );
    }

    #[test]
    fn read_profile_refuses_a_large_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("big.json");
        std::fs::write(&path, vec![b' '; (MAX_PROFILE_BYTES + 1) as usize]).expect("write");
        let err = read_profile(&path).expect_err("too large");
        assert!(err.contains("too large"), "{err}");
    }

    #[test]
    fn read_profile_refuses_binary() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("bin.json");
        std::fs::write(&path, [0xff, 0xfe, 0x00]).expect("write");
        let err = read_profile(&path).expect_err("not text");
        assert!(err.contains("not a text file"), "{err}");
    }

    #[test]
    fn read_profile_reports_a_missing_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let err = read_profile(&dir.path().join("missing.json")).expect_err("missing");
        assert!(err.contains("could not open"), "{err}");
    }
}
