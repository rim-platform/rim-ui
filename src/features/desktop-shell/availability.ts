import { detectPlatform, getRuntimeCapabilities } from "../../core/runtime/runtime";

/** The command that quits the desktop app, after a confirmation. */
export const QUIT_COMMAND_ID = "app.quit";

/** Whether this app has the system tray and a window to close: the desktop app only. */
export function desktopShellAvailable(): boolean {
  return getRuntimeCapabilities(detectPlatform()).desktopShell;
}
