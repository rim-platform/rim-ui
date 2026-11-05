//! The desktop shell: what closing the main window does, the setting that decides it, the system
//! tray that keeps the app reachable while the window is hidden, and starting at login.

mod settings;
mod start_at_login;
mod tray;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::image::Image;
use tauri::{AppHandle, CloseRequestApi, Emitter, Manager, Runtime, State, Window};

use settings::{CloseAction, DesktopSettings};
use start_at_login::StartAtLogin;
use tray::TrayState;

pub(crate) const MAIN_WINDOW: &str = "main";

/// The event that asks the page to show the close dialog, with a [`CloseRequest`].
const CLOSE_REQUESTED_EVENT: &str = "desktop://close-requested";

/// How long the page has to acknowledge a close request before the app quits.
const CLOSE_ACK_TIMEOUT: Duration = Duration::from_secs(3);

/// How long the check for a tray host may take, connecting to the bus included.
const TRAY_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

const SETTINGS_FILE: &str = "desktop-settings.json";

/// The payload of [`CLOSE_REQUESTED_EVENT`].
#[derive(Debug, Clone, Copy, Serialize)]
struct CloseRequest {
    id: u64,
}

/// The state of the desktop shell, managed by the app.
pub(crate) struct DesktopShell {
    settings_path: PathBuf,
    settings: Mutex<DesktopSettings>,
    close_requests: AtomicU64,
    last_acknowledged: AtomicU64,
    tray_failed: AtomicBool,
    /// What the tray icon should show, as the page last reported it.
    tray_state: Mutex<TrayState>,
    /// What the built tray icon shows now.
    tray_applied: Mutex<TrayState>,
    tray_shown: AtomicBool,
    /// The window icon with the dot, made on first need.
    tray_dot_icon: OnceLock<Image<'static>>,
}

impl DesktopShell {
    /// The shell with the settings stored at `settings_path`.
    fn load(settings_path: PathBuf) -> Self {
        let settings = settings::load(&settings_path);
        Self {
            settings_path,
            settings: Mutex::new(settings),
            close_requests: AtomicU64::new(0),
            last_acknowledged: AtomicU64::new(0),
            tray_failed: AtomicBool::new(false),
            tray_state: Mutex::new(TrayState::default()),
            tray_applied: Mutex::new(TrayState::default()),
            tray_shown: AtomicBool::new(false),
            tray_dot_icon: OnceLock::new(),
        }
    }

    fn lock_settings(&self) -> MutexGuard<'_, DesktopSettings> {
        self.settings.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn close_action(&self) -> CloseAction {
        self.lock_settings().close_action
    }

    /// Saves `action`, and takes it into use once it is on disk.
    fn set_close_action(&self, action: CloseAction) -> Result<(), String> {
        let mut current = self.lock_settings();
        let next = DesktopSettings {
            close_action: action,
        };
        settings::save(&self.settings_path, &next)?;
        *current = next;
        Ok(())
    }

    fn next_close_request(&self) -> u64 {
        self.close_requests.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Records that the page answered request `id`. The largest id seen stays.
    fn acknowledge(&self, id: u64) {
        self.last_acknowledged.fetch_max(id, Ordering::SeqCst);
    }

    fn is_acknowledged(&self, id: u64) -> bool {
        self.last_acknowledged.load(Ordering::SeqCst) >= id
    }

    fn tray_failed(&self) -> bool {
        self.tray_failed.load(Ordering::SeqCst)
    }

    fn mark_tray_failed(&self) {
        self.tray_failed.store(true, Ordering::SeqCst);
    }

    fn tray_state(&self) -> TrayState {
        *self
            .tray_state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn set_tray_state(&self, state: TrayState) {
        *self
            .tray_state
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = state;
    }

    fn lock_tray_applied(&self) -> MutexGuard<'_, TrayState> {
        self.tray_applied
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn tray_shown(&self) -> bool {
        self.tray_shown.load(Ordering::SeqCst)
    }

    /// Records whether the icon shows. Returns whether that changed.
    fn record_tray_shown(&self, shown: bool) -> bool {
        self.tray_shown.swap(shown, Ordering::SeqCst) != shown
    }
}

/// What a close request does under the current setting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CloseDecision {
    /// The close goes ahead and the app quits.
    Proceed,
    /// The close is prevented, and the window hides.
    HideToTray,
    /// The close is prevented, and the page asks.
    AskPage,
}

fn close_decision(action: CloseAction) -> CloseDecision {
    match action {
        CloseAction::Ask => CloseDecision::AskPage,
        CloseAction::Tray => CloseDecision::HideToTray,
        CloseAction::Quit => CloseDecision::Proceed,
    }
}

/// What the person chose in the close dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CloseChoice {
    Tray,
    Quit,
}

impl CloseChoice {
    /// The setting that makes this choice for every later close.
    fn as_action(self) -> CloseAction {
        match self {
            Self::Tray => CloseAction::Tray,
            Self::Quit => CloseAction::Quit,
        }
    }
}

/// Reads the settings into the app's state, shows the tray icon if the setting asks for it and
/// mends the start-at-login entry.
///
/// # Panics
///
/// When the OS has no config directory for the app.
pub(crate) fn setup<R: Runtime>(app: &AppHandle<R>) {
    let dir = app
        .path()
        .app_config_dir()
        .expect("failed to resolve app config dir");
    app.manage(DesktopShell::load(dir.join(SETTINGS_FILE)));
    tray::sync(app);
    start_at_login::mend(app);
}

/// Handles a close request of the main window under the current setting.
pub(crate) fn on_close_requested<R: Runtime>(window: &Window<R>, api: &CloseRequestApi) {
    let app = window.app_handle();
    let Some(shell) = app.try_state::<DesktopShell>() else {
        return;
    };
    match close_decision(shell.close_action()) {
        CloseDecision::Proceed => {}
        CloseDecision::HideToTray => {
            api.prevent_close();
            hide_to_tray(app);
        }
        CloseDecision::AskPage => {
            api.prevent_close();
            let id = shell.next_close_request();
            if let Err(error) = app.emit_to(MAIN_WINDOW, CLOSE_REQUESTED_EVENT, CloseRequest { id })
            {
                log::warn!("could not ask the page about closing: {error}");
            }
            quit_unless_acknowledged(app.clone(), id);
        }
    }
}

/// Quits after [`CLOSE_ACK_TIMEOUT`] unless the page has acknowledged request `id`, so a hung or
/// still-loading page cannot make the app impossible to close.
fn quit_unless_acknowledged<R: Runtime>(app: AppHandle<R>, id: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_ACK_TIMEOUT);
        if !app.state::<DesktopShell>().is_acknowledged(id) {
            log::warn!("the page did not answer a close request: quitting");
            app.exit(0);
        }
    });
}

/// Shows the tray icon and hides the main window. A tray that cannot be built still hides the
/// window: starting the app again brings it back.
fn hide_to_tray<R: Runtime>(app: &AppHandle<R>) {
    tray::show(app);
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        log::warn!("there is no main window to hide");
        return;
    };
    if let Err(error) = window.hide() {
        log::warn!("could not hide the main window: {error}");
    }
}

/// Shows, restores and focuses the main window, then updates the tray icon to match.
pub(crate) fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        log::warn!("there is no main window to show");
        return;
    };
    let shown = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(error) = shown {
        log::warn!("could not show the main window: {error}");
    }
    tray::sync_after_showing_window(app);
}

/// Whether a host for tray icons is on the session bus: a name owner of the status notifier
/// watcher. An unreachable bus counts as no host.
#[cfg(target_os = "linux")]
fn tray_host_present() -> bool {
    /// The name a desktop's tray host owns.
    const WATCHER: &str = "org.kde.StatusNotifierWatcher";
    /// How long the bus may take to answer, so a stuck bus cannot hold up the close dialog.
    const BUS_TIMEOUT: Duration = Duration::from_secs(1);

    let owned = (|| -> zbus::Result<bool> {
        let bus = zbus::blocking::connection::Builder::session()?
            .method_timeout(BUS_TIMEOUT)
            .build()?;
        let proxy = zbus::blocking::fdo::DBusProxy::new(&bus)?;
        Ok(proxy.name_has_owner(WATCHER.try_into()?)?)
    })();
    owned.unwrap_or_else(|error| {
        log::info!("could not ask the session bus about a tray host: {error}");
        false
    })
}

/// Other platforms always have somewhere to show a tray icon.
#[cfg(not(target_os = "linux"))]
fn tray_host_present() -> bool {
    true
}

/// The current close setting.
#[tauri::command]
pub fn desktop_close_action(shell: State<'_, DesktopShell>) -> CloseAction {
    shell.close_action()
}

/// Saves the close setting and updates the tray icon to match. A failure is also logged.
///
/// # Errors
///
/// A message when the setting could not be saved; it then stays as it was.
#[tauri::command]
pub fn desktop_set_close_action<R: Runtime>(
    app: AppHandle<R>,
    shell: State<'_, DesktopShell>,
    action: CloseAction,
) -> Result<(), String> {
    shell
        .set_close_action(action)
        .inspect_err(|error| log::warn!("could not save the close setting: {error}"))?;
    tray::sync(&app);
    Ok(())
}

/// Records that the page answered close request `id`.
#[tauri::command]
pub fn desktop_close_ack(shell: State<'_, DesktopShell>, id: u64) {
    shell.acknowledge(id);
}

/// Applies the person's answer in the close dialog: hides to the tray or quits. With `remember`
/// the answer also becomes the setting; a failure to save it is logged and the answer still
/// applies.
#[tauri::command]
pub fn desktop_close_choose<R: Runtime>(
    app: AppHandle<R>,
    shell: State<'_, DesktopShell>,
    choice: CloseChoice,
    remember: bool,
) {
    if remember {
        if let Err(error) = shell.set_close_action(choice.as_action()) {
            log::warn!("could not save the close setting: {error}");
        }
    }
    match choice {
        CloseChoice::Tray => hide_to_tray(&app),
        CloseChoice::Quit => app.exit(0),
    }
}

/// Quits the app.
#[tauri::command]
pub fn desktop_quit<R: Runtime>(app: AppHandle<R>) {
    app.exit(0);
}

/// Whether this desktop can show the tray icon. It runs on the blocking pool, because the bus
/// call must not hold up the main thread. A check that outlasts [`TRAY_CHECK_TIMEOUT`] counts as
/// no tray, so a stuck bus cannot keep the close dialog from opening.
#[tauri::command]
pub async fn desktop_tray_available<R: Runtime>(app: AppHandle<R>) -> bool {
    if app.state::<DesktopShell>().tray_failed() {
        return false;
    }
    let check = tauri::async_runtime::spawn_blocking(tray_host_present);
    matches!(
        tokio::time::timeout(TRAY_CHECK_TIMEOUT, check).await,
        Ok(Ok(true))
    )
}

/// Stores what the tray icon should show, and applies it when the icon exists. An icon built later
/// uses it.
#[tauri::command]
pub fn desktop_set_tray_state<R: Runtime>(
    app: AppHandle<R>,
    shell: State<'_, DesktopShell>,
    dot: bool,
    update_ready: bool,
) {
    shell.set_tray_state(TrayState { dot, update_ready });
    tray::apply_state(&app);
}

/// Whether the tray icon shows now.
#[tauri::command]
pub fn desktop_tray_shown(shell: State<'_, DesktopShell>) -> bool {
    shell.tray_shown()
}

/// Shows, restores and focuses the main window.
#[tauri::command]
pub fn desktop_show_window<R: Runtime>(app: AppHandle<R>) {
    show_main_window(&app);
}

/// Whether the app starts when the person signs in to this computer. A failure is also logged.
///
/// # Errors
///
/// A message when the operating system's entry cannot be read.
#[tauri::command]
pub fn desktop_start_at_login<R: Runtime>(app: AppHandle<R>) -> Result<StartAtLogin, String> {
    start_at_login::state(&app)
        .inspect_err(|error| log::warn!("could not read the start-at-login entry: {error}"))
}

/// Turns starting at login on or off. A failure is also logged.
///
/// # Errors
///
/// A message when the operating system's entry cannot be changed.
#[tauri::command]
pub fn desktop_set_start_at_login<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    start_at_login::set(&app, enabled)
        .inspect_err(|error| log::warn!("could not change the start-at-login entry: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell(dir: &tempfile::TempDir) -> DesktopShell {
        DesktopShell::load(dir.path().join(SETTINGS_FILE))
    }

    #[test]
    fn each_setting_has_its_close_decision() {
        assert_eq!(close_decision(CloseAction::Ask), CloseDecision::AskPage);
        assert_eq!(close_decision(CloseAction::Tray), CloseDecision::HideToTray);
        assert_eq!(close_decision(CloseAction::Quit), CloseDecision::Proceed);
    }

    #[test]
    fn each_choice_has_its_setting() {
        assert_eq!(CloseChoice::Tray.as_action(), CloseAction::Tray);
        assert_eq!(CloseChoice::Quit.as_action(), CloseAction::Quit);
    }

    #[test]
    fn close_requests_count_up_from_one() {
        let dir = tempfile::tempdir().unwrap();
        let shell = shell(&dir);
        assert_eq!(shell.next_close_request(), 1);
        assert_eq!(shell.next_close_request(), 2);
    }

    #[test]
    fn nothing_is_acknowledged_at_first() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!shell(&dir).is_acknowledged(1));
    }

    #[test]
    fn the_acknowledgement_keeps_the_largest_id() {
        let dir = tempfile::tempdir().unwrap();
        let shell = shell(&dir);
        shell.acknowledge(3);
        shell.acknowledge(1);
        assert!(shell.is_acknowledged(3));
        assert!(shell.is_acknowledged(2));
        assert!(!shell.is_acknowledged(4));
    }

    #[test]
    fn a_saved_setting_is_in_use_and_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let first = shell(&dir);
        assert_eq!(first.close_action(), CloseAction::Ask);
        first.set_close_action(CloseAction::Tray).unwrap();
        assert_eq!(first.close_action(), CloseAction::Tray);
        assert_eq!(shell(&dir).close_action(), CloseAction::Tray);
    }

    #[test]
    fn only_a_real_change_of_the_tray_icon_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let shell = shell(&dir);
        assert!(!shell.tray_shown());
        assert!(!shell.record_tray_shown(false));
        assert!(shell.record_tray_shown(true));
        assert!(shell.tray_shown());
        assert!(!shell.record_tray_shown(true));
        assert!(shell.record_tray_shown(false));
    }

    #[test]
    fn the_tray_state_starts_empty_and_keeps_the_last_report() {
        let dir = tempfile::tempdir().unwrap();
        let shell = shell(&dir);
        assert_eq!(shell.tray_state(), TrayState::default());
        let state = TrayState {
            dot: true,
            update_ready: true,
        };
        shell.set_tray_state(state);
        assert_eq!(shell.tray_state(), state);
    }

    #[test]
    fn a_setting_that_cannot_be_saved_stays_as_it_was() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("a-file");
        std::fs::write(&blocker, "").unwrap();
        let shell = DesktopShell::load(blocker.join(SETTINGS_FILE));
        assert!(shell.set_close_action(CloseAction::Tray).is_err());
        assert_eq!(shell.close_action(), CloseAction::Ask);
    }
}
