/**
 * The desktop shell's commands (`src-tauri/src/desktop_shell`): what closing the window does,
 * quitting, the tray icon and starting at login. Every call throws its `SafeInvokeError` on
 * failure, and `ipc_unavailable` in the web app.
 */

import { safeInvoke } from "../../../core/tauri/safeInvoke";

/** What closing the window does: ask each time, keep running in the tray, or quit. */
export type CloseAction = "ask" | "tray" | "quit";

/** An answer in the close dialog. */
export type CloseChoice = "tray" | "quit";

/** Starting at login on this computer. */
export interface StartAtLogin {
  enabled: boolean;
  /** Whether the app runs from an AppImage, whose file the person can move. */
  appImage: boolean;
  /** Whether an entry can start the app from where it runs now. */
  pathAllowed: boolean;
}

/** The event that asks the page to show the close dialog. */
export const CLOSE_REQUESTED_EVENT = "desktop://close-requested";

/** The payload of {@link CLOSE_REQUESTED_EVENT}. */
export interface CloseRequest {
  id: number;
}

/** The event that says whether the tray icon shows. */
export const TRAY_SHOWN_EVENT = "desktop://tray-shown";

/** The payload of {@link TRAY_SHOWN_EVENT}. */
export interface TrayShown {
  shown: boolean;
}

/** The event that hands the page a tray menu choice only it can carry out. */
export const TRAY_ACTION_EVENT = "desktop://tray-action";

/** The payload of {@link TRAY_ACTION_EVENT}. */
export interface TrayAction {
  action: "restart-to-update";
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await safeInvoke<T>(command, args);
  if (!result.ok) throw result.error;
  return result.value;
}

/** @returns The current close setting. */
export function desktopCloseAction(): Promise<CloseAction> {
  return call("desktop_close_action");
}

/**
 * Saves the close setting.
 *
 * @param action - The new setting.
 */
export function desktopSetCloseAction(action: CloseAction): Promise<null> {
  return call("desktop_set_close_action", { action });
}

/**
 * Tells the desktop app the page answered a close request, so the app does not quit.
 *
 * @param id - The request's id.
 */
export function desktopCloseAck(id: number): Promise<null> {
  return call("desktop_close_ack", { id });
}

/**
 * Applies an answer in the close dialog: hides the window to the tray, or quits.
 *
 * @param choice - The answer.
 * @param remember - Whether the answer also becomes the setting.
 */
export function desktopCloseChoose(choice: CloseChoice, remember: boolean): Promise<null> {
  return call("desktop_close_choose", { choice, remember });
}

/** Quits the app. */
export function desktopQuit(): Promise<null> {
  return call("desktop_quit");
}

/** @returns Whether this desktop can show the tray icon. */
export function desktopTrayAvailable(): Promise<boolean> {
  return call("desktop_tray_available");
}

/**
 * Tells the desktop app what the tray icon should show.
 *
 * @param dot - Whether the icon carries the dot.
 * @param updateReady - Whether the menu offers "Restart to update".
 */
export function desktopSetTrayState(dot: boolean, updateReady: boolean): Promise<null> {
  return call("desktop_set_tray_state", { dot, updateReady });
}

/** @returns Whether the tray icon shows now. */
export function desktopTrayShown(): Promise<boolean> {
  return call("desktop_tray_shown");
}

/** Shows, restores and focuses the window. */
export function desktopShowWindow(): Promise<null> {
  return call("desktop_show_window");
}

/** @returns Whether the app starts at login, as the operating system's entry says. */
export function desktopStartAtLogin(): Promise<StartAtLogin> {
  return call("desktop_start_at_login");
}

/**
 * Turns starting at login on or off.
 *
 * @param enabled - The new state.
 */
export function desktopSetStartAtLogin(enabled: boolean): Promise<null> {
  return call("desktop_set_start_at_login", { enabled });
}
