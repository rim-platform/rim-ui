mod plugin_host;
mod terminal;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Retrieve (or generate) a per-installation Stronghold password from the OS keychain.
///
/// On first run a cryptographically random 32-byte key is generated, stored in
/// the platform keystore (macOS Keychain / Windows Credential Manager / Linux
/// Secret Service) and returned as a base64 string.  Subsequent calls retrieve
/// the existing key.
#[tauri::command]
fn get_stronghold_password() -> Result<String, String> {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

    const SERVICE: &str = "com.rim.rim-ui";
    const USER: &str = "stronghold-master-key";

    let entry = keyring::Entry::new(SERVICE, USER)
        .map_err(|e| format!("keyring init failed: {e}"))?;

    // Try to retrieve an existing password.
    match entry.get_password() {
        Ok(existing) => Ok(existing),
        Err(keyring::Error::NoEntry) => {
            // First run — generate a new random password.
            let mut bytes = [0u8; 32];
            getrandom::fill(&mut bytes)
                .map_err(|e| format!("random generation failed: {e}"))?;
            let password = URL_SAFE_NO_PAD.encode(bytes);
            entry
                .set_password(&password)
                .map_err(|e| format!("keyring store failed: {e}"))?;
            log::info!("Generated and stored new Stronghold master key in OS keychain");
            Ok(password)
        }
        Err(e) => Err(format!("keyring retrieval failed: {e}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_local_data_dir()
                .expect("failed to resolve app local data dir");
            let salt_path = app_data_dir.join("salt.txt");
            app.handle().plugin(
                tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build(),
            )?;

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let plugin_state = plugin_host::init(&app_data_dir);
            app.manage(plugin_state);

            let terminal_state = terminal::init();
            app.manage(terminal_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_stronghold_password,
            plugin_host::commands::plugin_list,
            plugin_host::commands::plugin_install,
            plugin_host::commands::plugin_enable,
            plugin_host::commands::plugin_disable,
            plugin_host::commands::plugin_uninstall,
            plugin_host::commands::plugin_approve_capabilities,
            plugin_host::commands::plugin_revoke_capability,
            plugin_host::commands::plugin_suggested_keybinds,
            plugin_host::commands::plugin_context_actions,
            plugin_host::commands::plugin_install_from_git,
            plugin_host::commands::plugin_update,
            plugin_host::commands::plugin_panel_state,
            plugin_host::commands::plugin_relay_ui_event,
            terminal::commands::terminal_create,
            terminal::commands::terminal_write,
            terminal::commands::terminal_resize,
            terminal::commands::terminal_close,
            terminal::commands::terminal_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
