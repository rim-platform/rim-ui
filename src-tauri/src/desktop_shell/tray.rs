//! The tray icon and its menu. The icon is built once, on first need, and then only shown or
//! hidden, which avoids rebuilding the AppIndicator.

use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use super::settings::CloseAction;
use super::{show_main_window, DesktopShell, MAIN_WINDOW};

const TRAY_ID: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_QUIT: &str = "quit";

/// Whether the icon shows: while the setting keeps the app in the tray or the window is hidden.
fn tray_wanted(action: CloseAction, window_hidden: bool) -> bool {
    action == CloseAction::Tray || window_hidden
}

/// Runs `task` on the main thread, at once when already on it.
fn on_main_thread<R: Runtime>(app: &AppHandle<R>, task: impl FnOnce() + Send + 'static) {
    if let Err(error) = app.run_on_main_thread(task) {
        log::warn!("could not reach the main thread for the tray: {error}");
    }
}

/// Shows the icon, building it if needed. A tray that cannot be built leaves the app without one.
pub(crate) fn show<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    on_main_thread(app, move || show_now(&handle));
}

/// Makes the icon match [`tray_wanted`]. It never builds the icon just to hide it.
pub(crate) fn sync<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    on_main_thread(app, move || {
        let Some(shell) = handle.try_state::<DesktopShell>() else {
            return;
        };
        if tray_wanted(shell.close_action(), main_window_hidden(&handle)) {
            show_now(&handle);
        } else if let Some(tray) = handle.tray_by_id(TRAY_ID) {
            if let Err(error) = tray.set_visible(false) {
                log::warn!("could not hide the tray icon: {error}");
            }
        }
    });
}

fn main_window_hidden<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(MAIN_WINDOW)
        .and_then(|window| window.is_visible().ok())
        .is_some_and(|visible| !visible)
}

/// Shows the icon from the main thread. After one failure to build, it does not try again.
fn show_now<R: Runtime>(app: &AppHandle<R>) {
    let Some(shell) = app.try_state::<DesktopShell>() else {
        return;
    };
    if shell.tray_failed() {
        return;
    }
    let tray = match app.tray_by_id(TRAY_ID) {
        Some(tray) => tray,
        None => match build_catching_panics(app) {
            Ok(tray) => tray,
            Err(reason) => {
                log::warn!("the tray icon is not available: {reason}");
                shell.mark_tray_failed();
                return;
            }
        },
    };
    if let Err(error) = tray.set_visible(true) {
        log::warn!("could not show the tray icon: {error}");
    }
}

/// Builds the icon, turning a panic into an error: on Linux the AppIndicator library is opened at
/// run time and a missing one panics.
fn build_catching_panics<R: Runtime>(app: &AppHandle<R>) -> Result<TrayIcon<R>, String> {
    catch_unwind(AssertUnwindSafe(|| build(app))).unwrap_or_else(|panic| Err(panic_text(&*panic)))
}

fn panic_text(panic: &(dyn Any + Send)) -> String {
    panic
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| panic.downcast_ref::<&str>().map(|text| text.to_string()))
        .unwrap_or_else(|| "building it panicked".to_string())
}

fn build<R: Runtime>(app: &AppHandle<R>) -> Result<TrayIcon<R>, String> {
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("the app has no window icon")?;
    let open = MenuItem::with_id(app, MENU_OPEN, "Open RIM", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit RIM", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&open, &quit]).map_err(|error| error.to_string())?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("RIM")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => show_main_window(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_icon_shows_for_the_tray_setting_or_a_hidden_window() {
        assert!(tray_wanted(CloseAction::Tray, false));
        assert!(tray_wanted(CloseAction::Tray, true));
        assert!(tray_wanted(CloseAction::Ask, true));
        assert!(tray_wanted(CloseAction::Quit, true));
        assert!(!tray_wanted(CloseAction::Ask, false));
        assert!(!tray_wanted(CloseAction::Quit, false));
    }

    #[test]
    fn a_panic_is_described_by_its_message() {
        let caught = catch_unwind(|| panic!("no library {}", 3)).unwrap_err();
        assert_eq!(panic_text(&*caught), "no library 3");
        let caught = catch_unwind(|| panic!("no library")).unwrap_err();
        assert_eq!(panic_text(&*caught), "no library");
        let caught = catch_unwind(|| std::panic::panic_any(3)).unwrap_err();
        assert_eq!(panic_text(&*caught), "building it panicked");
    }
}
