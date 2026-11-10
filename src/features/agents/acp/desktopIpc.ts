/**
 * Calling the desktop app's commands and hearing its events, for the agent runner and the
 * agent installer. Every call throws an `Error` whose message the UI can show: the app's own
 * sentence, or {@link DESKTOP_ONLY_MESSAGE} off the desktop app.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { logger } from "../../../core/logger";

/** The message of every call's error off the desktop app. */
export const DESKTOP_ONLY_MESSAGE = "Starting agents needs the desktop app";

/** Throws the off-desktop error when there is no desktop app to ask. */
export function requireDesktop(): void {
  if (!isTauri()) throw new Error(DESKTOP_ONLY_MESSAGE);
}

/**
 * Calls a desktop command.
 *
 * @returns What the command answered. Rejects with an `Error` carrying the command's sentence.
 */
export async function callDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  requireDesktop();
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(typeof error === "string" ? error : JSON.stringify(error), { cause: error });
  }
}

/**
 * Listens for a desktop event.
 *
 * @returns A function that stops listening, also before listening started.
 */
export function listenDesktop<T>(event: string, callback: (payload: T) => void): () => void {
  requireDesktop();
  let stopped = false;
  let unlisten: (() => void) | undefined;
  void listen<T>(event, (e) => {
    if (!stopped) callback(e.payload);
  }).then(
    (stop) => {
      if (stopped) stop();
      else unlisten = stop;
    },
    (error: unknown) => {
      logger.warn(`[RIM:agents] could not listen for ${event}:`, error);
    },
  );
  return () => {
    stopped = true;
    unlisten?.();
    unlisten = undefined;
  };
}
