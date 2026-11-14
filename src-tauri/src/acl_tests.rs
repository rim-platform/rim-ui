//! The app's command access list as Tauri enforces it, checked on a mock runtime: the main window
//! reaches the commands its capability grants and nothing else.

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{WebviewWindow, WebviewWindowBuilder};

/// A window of the app with its real configuration and capabilities, whose commands all answer
/// `null` once access is granted.
fn window(label: &str) -> WebviewWindow<tauri::test::MockRuntime> {
    let app = mock_builder()
        .invoke_handler(|invoke| {
            invoke.resolver.resolve(());
            true
        })
        .build(tauri::generate_context!())
        .expect("the app builds");
    WebviewWindowBuilder::new(&app, label, Default::default())
        .build()
        .expect("the window opens")
}

/// Call `cmd` from the app's own page in `window`.
fn call(window: &WebviewWindow<tauri::test::MockRuntime>, cmd: &str) -> bool {
    let url = if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: url.parse().expect("url"),
            body: InvokeBody::default(),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        },
    )
    .is_ok()
}

#[test]
fn the_main_window_reaches_only_the_commands_it_is_granted() {
    let main = window("main");
    for granted in [
        "e2ee_link_preview",
        "plugin_install_from_git",
        "agent_runner_start",
    ] {
        assert!(call(&main, granted), "{granted} is granted");
    }
    for refused in [
        "plugin_install",
        "agent_validate_credentials",
        "not_a_command",
    ] {
        assert!(!call(&main, refused), "{refused} is not granted");
    }
}

#[test]
fn another_window_reaches_no_app_command() {
    assert!(!call(&window("other"), "e2ee_link_preview"));
}
