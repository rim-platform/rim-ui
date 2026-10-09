import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";

import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";

/** How long a plugin's notification title and body may be, so a panel cannot flood the screen. */
const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 300;

function clip(text: unknown, max: number): string {
  const value = typeof text === "string" ? text : "";
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Show a notification a plugin asked for (`ui.notify`). It always names the
 * plugin, so it cannot pass for the app's own. It is a toast, and also a
 * desktop notification while the window is in the background and the user
 * already allowed them (a plugin never makes the app ask for that permission).
 */
export async function showPluginNotification(
  pluginName: string,
  title: unknown,
  body: unknown,
): Promise<void> {
  const heading = `${pluginName}: ${clip(title, MAX_TITLE_LENGTH)}`;
  const text = clip(body, MAX_BODY_LENGTH);
  toast.info(heading, text ? { description: text } : undefined);

  if (typeof document === "undefined" || document.hasFocus()) return;
  try {
    if (await isPermissionGranted()) sendNotification({ title: heading, body: text });
  } catch (error) {
    logger.debug("[RIM:PluginBridge] desktop notification unavailable", error);
  }
}
