mod plugin_host;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
