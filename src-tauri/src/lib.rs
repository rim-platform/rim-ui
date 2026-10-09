mod agent_proxy;
mod history_archive;
mod identity_backup;
mod key_identity;
mod message_cache;
mod offline_session;
mod plugin_host;
mod secret_store;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Native dialogs — used Rust-side only (the history archive folder picker).
        // No `dialog:*` permission is granted to the renderer.
        .plugin(tauri_plugin_dialog::init())
        // Register the rim-plugin:// URI scheme for serving plugin panel assets.
        // The handler resolves rim-plugin://<plugin_id>/<panel_id>/<rest> to
        // ~/.rim/plugins/<plugin_id>/panels/<panel_id>/<rest> with full
        // path-traversal validation, and rim-plugin://shell/v1/ to the frame
        // shell web plugins load.  See plugin_protocol.rs for the resolver
        // and its security model.
        .register_asynchronous_uri_scheme_protocol("rim-plugin", |_app, request, responder| {
            use plugin_host::plugin_protocol::{resolve_plugin_uri, ResolveResult};

            let uri = request.uri().to_string();
            // Strip the scheme+authority: "rim-plugin://host/path" → "/path"
            // Tauri passes the full URI; we want everything after the authority.
            let path_part = uri
                .strip_prefix("rim-plugin://")
                .unwrap_or(&uri);

            // The frame shell web plugins' frames load: fixed files compiled in.
            if let Some((bytes, mime)) = plugin_host::plugin_protocol::shell_asset(path_part) {
                let response = tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header(
                        "Content-Security-Policy",
                        plugin_host::plugin_protocol::SHELL_POLICY,
                    )
                    .header("X-Content-Type-Options", "nosniff")
                    .header("Referrer-Policy", "no-referrer")
                    .body(bytes.to_vec())
                    .expect("failed to build response");
                responder.respond(response);
                return;
            }

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
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let plugin_state = plugin_host::init(&app_data_dir);
            plugin_host::forward_to_ui(app.handle().clone(), &plugin_state);
            app.manage(plugin_state);

            app.manage(message_cache::init(&app_data_dir));
            app.manage(history_archive::init(&app_data_dir));
            app.manage(offline_session::init());
            app.manage(key_identity::init());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            plugin_host::commands::plugin_install_from_git,
            plugin_host::commands::plugin_install_from_local,
            plugin_host::commands::plugin_trust_fingerprint,
            plugin_host::commands::plugin_update,
            plugin_host::commands::plugin_panel_state,
            plugin_host::commands::plugin_relay_ui_event,
            plugin_host::commands::plugin_set_principal,
            plugin_host::commands::plugin_install_bundle,
            plugin_host::commands::plugin_web_files,
            plugin_host::commands::plugin_set_starting,
            plugin_host::commands::plugin_storage_get,
            plugin_host::commands::plugin_storage_set,
            plugin_host::commands::plugin_principal_mappings,
            plugin_host::commands::plugin_check_ai_consent,
            plugin_host::registry::plugin_signing_source,
            plugin_host::registry::plugin_pick_signing_bundle,
            plugin_host::registry::plugin_export_signature,
            plugin_host::registry::plugin_install_registry_git,
            plugin_host::registry::plugin_detach_registry,
            agent_proxy::agent_chat_completion,
            agent_proxy::agent_validate_credentials,
            agent_proxy::agent_validate_provided_key,
            agent_proxy::agent_list_models,
            agent_proxy::set_provider_key,
            agent_proxy::clear_provider_key,
            agent_proxy::is_provider_key_configured,
            message_cache::commands::message_cache_track,
            message_cache::commands::message_cache_sync_begin,
            message_cache::commands::message_cache_sync_apply,
            message_cache::commands::message_cache_timeline,
            message_cache::commands::message_cache_search,
            history_archive::commands::history_archive_pick_folder,
            history_archive::commands::history_archive_inspect_folder,
            history_archive::commands::history_archive_status,
            history_archive::commands::history_archive_cloud_services,
            history_archive::commands::history_archive_cloud_authorize,
            history_archive::commands::history_archive_cloud_cancel,
            history_archive::commands::history_archive_cloud_discard,
            history_archive::commands::history_archive_connect,
            history_archive::commands::history_archive_unlock,
            history_archive::commands::history_archive_disconnect,
            history_archive::commands::history_archive_export,
            history_archive::commands::history_archive_restore,
            identity_backup::commands::identity_backup_sync,
            identity_backup::commands::identity_backup_enable,
            identity_backup::commands::identity_backup_take_over,
            identity_backup::commands::identity_backup_can_unlock_archive,
            identity_backup::commands::identity_backup_unlock_archive,
            message_cache::commands::message_cache_snapshot_put,
            message_cache::commands::message_cache_snapshot_get,
            offline_session::offline_session_load,
            offline_session::offline_session_save,
            key_identity::commands::key_identity_accounts,
            key_identity::commands::key_identity_default_device_name,
            key_identity::commands::key_identity_begin_enrollment,
            key_identity::commands::key_identity_sign_enrollment,
            key_identity::commands::key_identity_sign_signup,
            key_identity::commands::key_identity_remove_draft_keys,
            key_identity::commands::key_identity_restore_draft_keys,
            key_identity::commands::key_identity_forget_unconfirmed,
            key_identity::commands::key_identity_discard_enrollment,
            key_identity::commands::key_identity_settle,
            key_identity::commands::key_identity_sign_login,
            key_identity::commands::key_identity_sync_log,
            key_identity::commands::key_identity_sign_revocation,
            key_identity::commands::key_identity_begin_rotation,
            key_identity::commands::key_identity_sign_profile_card,
            key_identity::commands::key_identity_sign_plugin_manifest,
            key_identity::commands::key_identity_verify_plugin_manifest,
            key_identity::commands::key_identity_begin_recovery,
            key_identity::commands::key_identity_discard_recovery,
            key_identity::commands::key_identity_forget,
            key_identity::commands::key_identity_link_begin,
            key_identity::commands::key_identity_link_review_offer,
            key_identity::commands::key_identity_link_confirm,
            key_identity::commands::key_identity_link_pending,
            key_identity::commands::key_identity_link_resume,
            key_identity::commands::key_identity_link_end,
            key_identity::commands::key_identity_link_offer,
            key_identity::commands::key_identity_link_open_answer,
            key_identity::commands::key_identity_link_accept,
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
