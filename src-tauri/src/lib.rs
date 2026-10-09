mod agent_proxy;
mod history_archive;
mod message_cache;
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
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

    const USER: &str = "stronghold-master-key";

    let entry = keyring::Entry::new(agent_proxy::KEYRING_SERVICE, USER)
        .map_err(|e| format!("keyring init failed: {e}"))?;

    // Try to retrieve an existing password.
    match entry.get_password() {
        Ok(existing) => Ok(existing),
        Err(keyring::Error::NoEntry) => {
            // First run — generate a new random password.
            let mut bytes = [0u8; 32];
            getrandom::fill(&mut bytes).map_err(|e| format!("random generation failed: {e}"))?;
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
        // Native dialogs — used Rust-side only (terminal first-use confirmation,
        // S-H1). No `dialog:*` permission is granted to the renderer.
        .plugin(tauri_plugin_dialog::init())
        // Register the rim-plugin:// URI scheme for serving plugin panel assets.
        // The handler resolves rim-plugin://<plugin_id>/<panel_id>/<rest> to
        // ~/.rim/plugins/<plugin_id>/panels/<panel_id>/<rest> with full
        // path-traversal validation.  See plugin_protocol.rs for the resolver
        // and its security model.
        .register_asynchronous_uri_scheme_protocol("rim-plugin", |_app, request, responder| {
            use plugin_host::plugin_protocol::{resolve_plugin_uri, ResolveResult};

            let uri = request.uri().to_string();
            // Strip the scheme+authority: "rim-plugin://host/path" → "/path"
            // Tauri passes the full URI; we want everything after the authority.
            let path_part = uri
                .strip_prefix("rim-plugin://")
                .unwrap_or(&uri);

            let plugins_root = plugin_host::discovery::plugins_dir();

            match resolve_plugin_uri(path_part, &plugins_root) {
                ResolveResult::Ok(file_path) => {
                    match std::fs::read(&file_path) {
                        Ok(bytes) => {
                            let mime = guess_mime(&file_path);
                            let response = tauri::http::Response::builder()
                                .status(200)
                                .header("Content-Type", mime)
                                .header("Content-Security-Policy",
                                    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'")
                                .body(bytes)
                                .expect("failed to build response");
                            responder.respond(response);
                        }
                        Err(e) => {
                            log::warn!("[plugin_protocol] failed to read {:?}: {}", file_path, e);
                            responder.respond(
                                tauri::http::Response::builder()
                                    .status(404)
                                    .body(b"Not Found".to_vec())
                                    .unwrap(),
                            );
                        }
                    }
                }
                ResolveResult::NotFound => {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(404)
                            .body(b"Not Found".to_vec())
                            .unwrap(),
                    );
                }
                ResolveResult::Forbidden => {
                    log::warn!("[AUDIT] event=plugin_protocol_forbidden uri={}", uri);
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(403)
                            .body(b"Forbidden".to_vec())
                            .unwrap(),
                    );
                }
            }
        })
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_local_data_dir()
                .expect("failed to resolve app local data dir");
            let salt_path = app_data_dir.join("salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let plugin_state = plugin_host::init(&app_data_dir);
            plugin_host::forward_to_ui(app.handle().clone(), &plugin_state);
            app.manage(plugin_state);

            app.manage(message_cache::init(&app_data_dir));
            app.manage(history_archive::init(&app_data_dir));

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
            plugin_host::commands::plugin_approve_ai_commands,
            plugin_host::commands::plugin_revoke_ai_consent,
            plugin_host::commands::plugin_run_ai_command,
            plugin_host::commands::plugin_execute_command,
            plugin_host::commands::plugin_suggested_keybinds,
            plugin_host::commands::plugin_context_actions,
            plugin_host::commands::plugin_install_from_git,
            plugin_host::commands::plugin_install_from_local,
            plugin_host::commands::plugin_trust_fingerprint,
            plugin_host::commands::plugin_update,
            plugin_host::commands::plugin_panel_state,
            plugin_host::commands::plugin_relay_ui_event,
            plugin_host::commands::plugin_set_principal,
            terminal::commands::terminal_create,
            terminal::commands::terminal_write,
            terminal::commands::terminal_resize,
            terminal::commands::terminal_close,
            terminal::commands::terminal_list,
            agent_proxy::agent_chat_completion,
            agent_proxy::agent_validate_credentials,
            agent_proxy::agent_validate_provided_key,
            agent_proxy::agent_list_models,
            agent_proxy::set_provider_key,
            agent_proxy::clear_provider_key,
            agent_proxy::is_provider_key_configured,
            agent_proxy::migrate_provider_keys,
            message_cache::commands::message_cache_track,
            message_cache::commands::message_cache_sync_begin,
            message_cache::commands::message_cache_sync_apply,
            message_cache::commands::message_cache_timeline,
            message_cache::commands::message_cache_search,
            history_archive::commands::history_archive_pick_folder,
            history_archive::commands::history_archive_inspect_folder,
            history_archive::commands::history_archive_status,
            history_archive::commands::history_archive_connect,
            history_archive::commands::history_archive_unlock,
            history_archive::commands::history_archive_disconnect,
            history_archive::commands::history_archive_export,
            history_archive::commands::history_archive_restore,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // `run` ends the process without running destructors, so plugin
            // processes are stopped here or they outlive the app.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<plugin_host::PluginHostState>() {
                    tauri::async_runtime::block_on(plugin_host::runtime::stop_all(&state));
                }
            }
        });
}

/// Guess a MIME type from a file extension.
///
/// Falls back to `"application/octet-stream"` for unknown extensions.
fn guess_mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("wasm") => "application/wasm",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    }
}
