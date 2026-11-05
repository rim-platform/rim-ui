//! The tray icon and its menu. The icon is built once, on first need, and then only shown or
//! hidden, which avoids rebuilding the AppIndicator. What it shows follows a [`TrayState`] the page
//! reports: a dot on the icon and an extra menu item.

use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};

use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::settings::CloseAction;
use super::{show_main_window, DesktopShell, MAIN_WINDOW};

const TRAY_ID: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_RESTART_TO_UPDATE: &str = "restart-to-update";
const MENU_QUIT: &str = "quit";

/// The event that tells the page whether the icon shows, with a [`TrayShown`].
const TRAY_SHOWN_EVENT: &str = "desktop://tray-shown";

/// The event that hands the page a menu choice only it can carry out, with a [`TrayAction`].
const TRAY_ACTION_EVENT: &str = "desktop://tray-action";

/// The dot's diameter as a share of the icon's shorter side.
const DOT_DIAMETER_SHARE: f64 = 0.4;

/// The dot's colour, `#E5484D`, fully opaque.
const DOT_RGBA: [u8; 4] = [0xE5, 0x48, 0x4D, 0xFF];

/// What the icon and its menu show.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct TrayState {
    /// Whether the icon carries the dot.
    pub(crate) dot: bool,
    /// Whether the menu offers "Restart to update".
    pub(crate) update_ready: bool,
}

/// The payload of [`TRAY_SHOWN_EVENT`].
#[derive(Debug, Clone, Copy, Serialize)]
struct TrayShown {
    shown: bool,
}

/// The payload of [`TRAY_ACTION_EVENT`].
#[derive(Debug, Clone, Copy, Serialize)]
struct TrayAction {
    action: &'static str,
}

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
        let hidden = main_window_hidden(&handle);
        sync_now(&handle, hidden);
    });
}

/// [`sync`] for a window just asked to show. On Linux that request is queued, so the window still
/// reports hidden at this point.
pub(crate) fn sync_after_showing_window<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    on_main_thread(app, move || sync_now(&handle, false));
}

fn sync_now<R: Runtime>(app: &AppHandle<R>, window_hidden: bool) {
    let Some(shell) = app.try_state::<DesktopShell>() else {
        return;
    };
    if tray_wanted(shell.close_action(), window_hidden) {
        show_now(app);
    } else if let Some(tray) = app.tray_by_id(TRAY_ID) {
        match tray.set_visible(false) {
            Ok(()) => record_shown(app, &shell, false),
            Err(error) => log::warn!("could not hide the tray icon: {error}"),
        }
    }
}

/// Makes a built icon match the state the page last reported.
pub(crate) fn apply_state<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    on_main_thread(app, move || apply_state_now(&handle));
}

/// Changes the icon and the menu from the main thread, each only when its value changed. A failure
/// keeps the old value, so the next report tries again.
fn apply_state_now<R: Runtime>(app: &AppHandle<R>) {
    let Some(shell) = app.try_state::<DesktopShell>() else {
        return;
    };
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let wanted = shell.tray_state();
    let mut applied = shell.lock_tray_applied();
    if wanted.dot != applied.dot {
        let changed = icon_for(app, &shell, wanted.dot)
            .and_then(|icon| tray.set_icon(Some(icon)).map_err(|error| error.to_string()));
        match changed {
            Ok(()) => applied.dot = wanted.dot,
            Err(error) => log::warn!("could not change the tray icon: {error}"),
        }
    }
    if wanted.update_ready != applied.update_ready {
        let changed = build_menu(app, wanted.update_ready)
            .and_then(|menu| tray.set_menu(Some(menu)).map_err(|error| error.to_string()));
        match changed {
            Ok(()) => applied.update_ready = wanted.update_ready,
            Err(error) => log::warn!("could not change the tray menu: {error}"),
        }
    }
}

/// Records whether the icon shows, and tells the page when that changed.
fn record_shown<R: Runtime>(app: &AppHandle<R>, shell: &DesktopShell, shown: bool) {
    if shell.record_tray_shown(shown) {
        if let Err(error) = app.emit_to(MAIN_WINDOW, TRAY_SHOWN_EVENT, TrayShown { shown }) {
            log::warn!("could not tell the page about the tray icon: {error}");
        }
    }
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
    match tray.set_visible(true) {
        Ok(()) => record_shown(app, &shell, true),
        Err(error) => log::warn!("could not show the tray icon: {error}"),
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

/// The window icon, with the dot when `dot` says so.
fn icon_for<R: Runtime>(
    app: &AppHandle<R>,
    shell: &DesktopShell,
    dot: bool,
) -> Result<Image<'static>, String> {
    let plain = app
        .default_window_icon()
        .ok_or("the app has no window icon")?;
    if !dot {
        return Ok(plain.clone().to_owned());
    }
    let with_dot = shell.tray_dot_icon.get_or_init(|| {
        let (width, height) = (plain.width(), plain.height());
        Image::new_owned(icon_with_dot(plain.rgba(), width, height), width, height)
    });
    Ok(with_dot.clone())
}

/// `rgba` with a solid dot in the top-right corner. Input whose length does not match `width` and
/// `height` comes back unchanged.
fn icon_with_dot(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out = rgba.to_vec();
    let columns = width as usize;
    let rows = height as usize;
    if columns
        .checked_mul(rows)
        .and_then(|pixels| pixels.checked_mul(4))
        != Some(rgba.len())
    {
        return out;
    }
    let radius = f64::from(width.min(height)) * DOT_DIAMETER_SHARE / 2.0;
    let center_x = f64::from(width) - radius;
    let center_y = radius;
    for (index, pixel) in out.chunks_exact_mut(4).enumerate() {
        let x = (index % columns) as f64 + 0.5;
        let y = (index / columns) as f64 + 0.5;
        if (x - center_x).powi(2) + (y - center_y).powi(2) <= radius.powi(2) {
            pixel.copy_from_slice(&DOT_RGBA);
        }
    }
    out
}

/// The menu: "Open RIM" first, because AppIndicator delivers no clicks, then "Restart to update"
/// only while an update is ready, then "Quit RIM".
fn build_menu<R: Runtime>(app: &AppHandle<R>, update_ready: bool) -> Result<Menu<R>, String> {
    let item = |id: &str, text: &str| {
        MenuItem::with_id(app, id, text, true, None::<&str>).map_err(|error| error.to_string())
    };
    let open = item(MENU_OPEN, "Open RIM")?;
    let quit = item(MENU_QUIT, "Quit RIM")?;
    let menu = if update_ready {
        let restart = item(MENU_RESTART_TO_UPDATE, "Restart to update")?;
        Menu::with_items(app, &[&open, &restart, &quit])
    } else {
        Menu::with_items(app, &[&open, &quit])
    };
    menu.map_err(|error| error.to_string())
}

/// Asks the page to restart into the update, because its updater store holds the download.
fn request_restart_to_update<R: Runtime>(app: &AppHandle<R>) {
    let action = TrayAction {
        action: MENU_RESTART_TO_UPDATE,
    };
    if let Err(error) = app.emit_to(MAIN_WINDOW, TRAY_ACTION_EVENT, action) {
        log::warn!("could not ask the page to restart to update: {error}");
    }
}

/// Builds the icon under the current state and records that state as applied.
fn build<R: Runtime>(app: &AppHandle<R>) -> Result<TrayIcon<R>, String> {
    let shell = app
        .try_state::<DesktopShell>()
        .ok_or("the desktop shell is not ready")?;
    let state = shell.tray_state();
    let icon = icon_for(app, &shell, state.dot)?;
    let menu = build_menu(app, state.update_ready)?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("RIM")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => show_main_window(app),
            MENU_RESTART_TO_UPDATE => request_restart_to_update(app),
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
        .map_err(|error| error.to_string())?;
    *shell.lock_tray_applied() = state;
    Ok(tray)
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

    /// A 100 by 50 image of one colour, which the dot's colour is not.
    fn plain_rgba() -> Vec<u8> {
        [10, 20, 30, 40].repeat(100 * 50)
    }

    fn pixel(rgba: &[u8], width: usize, x: usize, y: usize) -> &[u8] {
        let start = (y * width + x) * 4;
        &rgba[start..start + 4]
    }

    #[test]
    fn the_dot_fills_the_top_right_corner_in_its_colour() {
        let out = icon_with_dot(&plain_rgba(), 100, 50);
        assert_eq!(out.len(), plain_rgba().len());
        // The dot's diameter is 40% of the shorter side, so 20 pixels, centred at (90, 10).
        assert_eq!(pixel(&out, 100, 90, 10), DOT_RGBA);
        assert_eq!(pixel(&out, 100, 81, 10), DOT_RGBA);
        assert_eq!(pixel(&out, 100, 98, 10), DOT_RGBA);
        assert_eq!(pixel(&out, 100, 90, 1), DOT_RGBA);
        assert_eq!(pixel(&out, 100, 90, 18), DOT_RGBA);
    }

    #[test]
    fn the_dot_is_round_and_leaves_the_rest_alone() {
        let original = plain_rgba();
        let out = icon_with_dot(&original, 100, 50);
        assert_eq!(pixel(&out, 100, 99, 0), pixel(&original, 100, 99, 0));
        assert_eq!(pixel(&out, 100, 90, 25), pixel(&original, 100, 90, 25));
        assert_eq!(pixel(&out, 100, 0, 49), pixel(&original, 100, 0, 49));
    }

    #[test]
    fn input_of_the_wrong_length_comes_back_unchanged() {
        let short = vec![1, 2, 3, 4, 5];
        assert_eq!(icon_with_dot(&short, 100, 50), short);
        assert_eq!(icon_with_dot(&[], 2, 2), Vec::<u8>::new());
        let huge = u32::MAX;
        assert_eq!(icon_with_dot(&short, huge, huge), short);
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
