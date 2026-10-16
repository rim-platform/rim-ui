import { appLogDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";

/** Opens the folder that holds the desktop app's log files in the system's file manager. */
export async function openLogFolder(): Promise<void> {
  await openPath(await appLogDir());
}
