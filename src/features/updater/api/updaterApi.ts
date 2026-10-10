import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

import { safeInvoke } from "../../../core/tauri/safeInvoke";
import type { AppPlatform } from "../../../core/runtime/runtime";

export type { DownloadEvent, Update };

/** The version this bundle was built as, from package.json. */
export const BUILD_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

/** Whether this build carries an update endpoint and key; throws when the shell cannot say. */
export async function fetchUpdaterConfigured(): Promise<boolean> {
  const result = await safeInvoke<{ configured: boolean }>("updater_status");
  if (!result.ok) throw new Error(result.error.message);
  return result.value.configured;
}

/** Asks the update endpoints for a newer version; `null` when this one is the latest. */
export function checkForUpdate(): Promise<Update | null> {
  return check();
}

/** Restarts the app, which then runs the installed version. */
export function relaunchApp(): Promise<void> {
  return relaunch();
}

/** The running client's version: the desktop shell's own, or the bundle's on the web. */
export async function readClientVersion(platform: AppPlatform): Promise<string> {
  if (platform !== "desktop") return BUILD_VERSION;
  return getVersion();
}
