mod account_lock;
mod agent_proxy;
mod e2ee;
mod history_archive;
mod identity_backup;
mod key_identity;
mod keybind_profile;
mod logging;
mod message_cache;
mod offline_session;
mod plugin_host;
mod relay;
mod secret_store;
mod updater;

use std::sync::Arc;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    let (updater_config, updater_warning) = updater::UpdaterConfig::bundled();
    let builder = updater::register(
        tauri::Builder::default(),
        &mut context,
        updater_config.as_ref(),
    );
    builder
        // First, so the other plugins' and the app's start-up messages reach the log file.
        .plugin(logging::plugin())
        .manage(updater::UpdaterStatus::of(updater_config.as_ref()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Native dialogs — used Rust-side only (the history archive folder picker).
        // No `dialog:*` permission is granted to the renderer.
        .plugin(tauri_plugin_dialog::init())
        // The rim-plugin:// scheme serves the frame shell every plugin frame and
        // panel frame loads, at rim-plugin://shell/v1/; see plugin_protocol.rs.
        .register_asynchronous_uri_scheme_protocol("rim-plugin", |_app, request, responder| {
            let uri = request.uri().to_string();
            let path = uri.strip_prefix("rim-plugin://").unwrap_or(&uri);
            responder.respond(plugin_host::plugin_protocol::respond(path));
        })
        .setup(move |app| {
            // The log plugin installed its logger while plugins were initialized, before this hook.
            if let Some(warning) = updater_warning {
                warning.emit();
            }
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let vault = Arc::new(secret_store::SecretVault::open(&app_data_dir));
            let plugin_state = plugin_host::init(&app_data_dir, vault.clone());
            plugin_host::forward_to_ui(app.handle().clone(), &plugin_state);
            app.manage(plugin_state);

            app.manage(message_cache::init(&app_data_dir, vault.clone()));
            app.manage(history_archive::init(&app_data_dir, vault.clone()));
            app.manage(offline_session::init(vault.clone()));
            app.manage(key_identity::init(vault.clone()));
            app.manage(account_lock::init(vault.clone()));
            app.manage(e2ee::attachment_state());
            app.manage(relay::direct::DirectState::default());
            app.manage(relay::pow::PowState::default());
            app.manage(vault);
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
            plugin_host::bundle_fetch::plugin_fetch_bundle,
            plugin_host::commands::plugin_web_files,
            plugin_host::commands::plugin_panel_files,
            plugin_host::commands::plugin_set_starting,
            plugin_host::commands::plugin_storage_get,
            plugin_host::commands::plugin_storage_set,
            plugin_host::commands::plugin_settings_get,
            plugin_host::commands::plugin_settings_save,
            plugin_host::commands::plugin_settings_reset,
            plugin_host::commands::plugin_web_settings,
            plugin_host::commands::plugin_principal_mappings,
            plugin_host::commands::plugin_check_ai_consent,
            plugin_host::commands::plugin_chat_respond,
            plugin_host::commands::plugin_record_encrypted_reads,
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
            message_cache::commands::message_cache_remove_account,
            message_cache::commands::message_cache_track,
            message_cache::commands::message_cache_sync_begin,
            message_cache::commands::message_cache_sync_apply,
            message_cache::commands::message_cache_timeline,
            message_cache::commands::message_cache_search,
            message_cache::commands::message_cache_thread,
            message_cache::commands::message_cache_message,
            message_cache::commands::message_cache_plugin_messages,
            message_cache::commands::message_cache_plugin_message,
            message_cache::commands::message_cache_plugin_search,
            e2ee::commands::e2ee_status,
            e2ee::commands::e2ee_ensure_identity,
            e2ee::commands::e2ee_key_packages,
            e2ee::commands::e2ee_create_group,
            e2ee::commands::e2ee_commit,
            e2ee::commands::e2ee_settle_commit,
            e2ee::commands::e2ee_process_commits,
            e2ee::commands::e2ee_join,
            e2ee::commands::e2ee_verify,
            e2ee::commands::e2ee_readd_request,
            e2ee::commands::e2ee_readd_check,
            e2ee::commands::e2ee_encrypt_message,
            e2ee::commands::e2ee_reencrypt_message,
            e2ee::commands::e2ee_settle_message,
            e2ee::commands::e2ee_forget,
            e2ee::commands::e2ee_pin,
            e2ee::attachment::e2ee_attachment_encrypt,
            e2ee::attachment::e2ee_attachment_decrypt,
            e2ee::attachment::e2ee_reported_attachment_decrypt,
            e2ee::link_preview::e2ee_link_preview,
            history_archive::commands::history_archive_pick_folder,
            history_archive::commands::history_archive_inspect_folder,
            history_archive::commands::history_archive_status,
            history_archive::commands::history_archive_cloud_services,
            history_archive::commands::history_archive_cloud_authorize,
            history_archive::commands::history_archive_cloud_cancel,
            history_archive::commands::history_archive_cloud_discard,
            history_archive::commands::history_archive_endpoint_check,
            history_archive::commands::history_archive_s3_check,
            history_archive::commands::history_archive_devices,
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
            keybind_profile::keybind_profile_save,
            keybind_profile::keybind_profile_open,
            key_identity::commands::key_identity_accounts,
            key_identity::commands::key_identity_default_device_name,
            key_identity::commands::key_identity_begin_enrollment,
            key_identity::commands::key_identity_sign_enrollment,
            key_identity::commands::key_identity_sign_signup,
            key_identity::commands::key_identity_remove_draft_keys,
            key_identity::commands::key_identity_restore_draft_keys,
            key_identity::commands::key_identity_forget_unconfirmed,
            key_identity::commands::key_identity_discard_enrollment,
            key_identity::commands::key_identity_recovery_kit,
            key_identity::commands::key_identity_confirm_recovery_kit,
            key_identity::commands::key_identity_settle,
            key_identity::commands::key_identity_sign_login,
            key_identity::commands::key_identity_sign_device_request,
            key_identity::commands::key_identity_sign_delegation,
            key_identity::commands::key_identity_sign_login_for_server,
            relay::commands::relay_verify_discovery,
            relay::commands::relay_replay_server_log,
            relay::commands::relay_host_response_key_seq,
            relay::commands::relay_verify_host_response,
            relay::commands::relay_read_host_event,
            relay::commands::relay_verify_card,
            relay::commands::relay_revocation_ack_key_seq,
            relay::commands::relay_verify_revocation_ack,
            relay::direct::relay_direct_discovery,
            relay::direct::relay_direct_open,
            relay::direct::relay_direct_close,
            relay::direct::relay_direct_graphql,
            relay::direct::relay_direct_socket_open,
            relay::direct::relay_direct_socket_send,
            relay::direct::relay_direct_socket_close,
            relay::pow::relay_solve_pow,
            relay::pow::relay_cancel_pow,
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
            account_lock::commands::opaque_registration_start,
            account_lock::commands::opaque_registration_finish,
            account_lock::commands::opaque_login_start,
            account_lock::commands::opaque_login_finish,
            account_lock::commands::account_unlock_after_login,
            account_lock::commands::account_unlock_after_signup,
            account_lock::commands::account_unlock_kept,
            account_lock::commands::account_unlock_with_recovery,
            account_lock::commands::account_lock,
            account_lock::commands::account_forget_keep,
            updater::updater_status,
        ])
        .build(context)
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
