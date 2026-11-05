/**
 * The desktop shell's commands (`src-tauri/src/desktop_shell`): what closing the window does and
 * quitting. Every call throws its `SafeInvokeError` on failure, and `ipc_unavailable` in the web
 * app.
 */

import { safeInvoke } from "../../../core/tauri/safeInvoke";

/** What closing the window does: ask each time, keep running in the tray, or quit. */
export type CloseAction = "ask" | "tray" | "quit";

/** An answer in the close dialog. */
export type CloseChoice = "tray" | "quit";

/** The event that asks the page to show the close dialog. */
export const CLOSE_REQUESTED_EVENT = "desktop://close-requested";

/** The payload of {@link CLOSE_REQUESTED_EVENT}. */
export interface CloseRequest {
  id: number;
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
