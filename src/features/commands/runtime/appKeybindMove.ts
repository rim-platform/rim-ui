import { useEffect } from "react";

import { getApiOrigin } from "../../../core/graphql/config";
import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { toast } from "../../../shared/toast";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { APP_COMMAND_KEYBINDS, hasCapability } from "../../updater/api/serverCapabilities";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import {
  createKeybind,
  deleteKeybind,
  invalidateKeybinds,
  updateKeybind,
} from "../api/useKeybindSettings";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import type { ResolvedKeybind } from "../types";
import { isLocalCommand } from "./localCommands";

/** What the person is told once keybinds to this app's own commands moved to the server. */
export const APP_KEYBINDS_MOVED_MESSAGE =
  "Your keyboard shortcuts for app commands now follow you to your other devices";

function movedKey(account: string): string {
  return `rim.appKeybindsMoved.${account}`;
}

/** The account `userId` of the connected server, as the move records it. */
export function appKeybindAccount(userId: string): string {
  return `${getApiOrigin()}:${userId}`;
}

/** Whether the move already ran for `account`; `true` when storage cannot be read. */
export function appKeybindsMoved(account: string): boolean {
  try {
    return localStorage.getItem(movedKey(account)) !== null;
  } catch {
    return true;
  }
}

function recordMoved(account: string): void {
  try {
    localStorage.setItem(movedKey(account), String(Date.now()));
  } catch {
    // Storage unavailable: appKeybindsMoved reads it as moved, so nothing runs twice.
  }
}

/** Forgets that the move ran for the account `userId`, an account removed from this device. */
export function forgetAppKeybindMove(userId: string): void {
  try {
    localStorage.removeItem(movedKey(appKeybindAccount(userId)));
  } catch {
    // Storage unavailable: there is nothing kept to forget.
  }
}

/**
 * Saves the device keybind `kb` on the server with its keys, context and on or off state.
 *
 * @returns Whether the server holds it as it was; on a refusal it holds nothing.
 */
async function saveOnServer(kb: ResolvedKeybind): Promise<boolean> {
  const fields = { keystroke: kb.keystroke, commandId: kb.commandId, context: kb.context };
  let saved;
  try {
    saved = await createKeybind({ scope: "USER", ...fields });
  } catch (err) {
    logger.warn(`[RIM:keybinds] the server refused the keybind to ${kb.commandId}:`, err);
    return false;
  }
  if (kb.isEnabled) return true;
  try {
    await updateKeybind({ keybindId: saved.id, ...fields, isEnabled: false });
    return true;
  } catch (err) {
    logger.warn(`[RIM:keybinds] the keybind to ${kb.commandId} could not be turned off:`, err);
    try {
      await deleteKeybind({ keybindId: saved.id });
    } catch {
      // The device copy stays and holds these keys above the server's, so it still decides.
    }
    return false;
  }
}

const running = new Set<string>();

/**
 * Moves this device's keybinds to this app's own commands to the connected server, once for
 * `account`: each is saved on the server and, once saved, removed from this device. A binding
 * the server refuses stays on this device, and the move does not run again for the account.
 * Keybinds to plugin commands stay on this device. One toast says so when any moved.
 *
 * @param account - The account and server, from {@link appKeybindAccount}.
 * @returns How many keybinds moved.
 */
export async function moveAppKeybindsToServer(account: string): Promise<number> {
  if (running.has(account) || appKeybindsMoved(account)) return 0;
  running.add(account);
  recordMoved(account);
  try {
    const toMove = useDeviceKeybindStore
      .getState()
      .keybinds.filter((kb) => isLocalCommand(kb.commandId));
    let moved = 0;
    for (const kb of toMove) {
      if (!(await saveOnServer(kb))) continue;
      useDeviceKeybindStore.getState().remove(kb.id);
      moved += 1;
    }
    if (moved > 0) {
      invalidateKeybinds(queryClient);
      toast.info(APP_KEYBINDS_MOVED_MESSAGE);
    }
    return moved;
  } finally {
    running.delete(account);
  }
}

/**
 * Runs {@link moveAppKeybindsToServer} for the signed-in account once its server is known to
 * list {@link APP_COMMAND_KEYBINDS}.
 */
export function useAppKeybindMove(): void {
  const userId = useAuthStore((s) => s.session?.userId);
  const keepsAppKeybinds = hasCapability(useServerInfo().info, APP_COMMAND_KEYBINDS);
  useEffect(() => {
    if (!userId || !keepsAppKeybinds) return;
    void moveAppKeybindsToServer(appKeybindAccount(userId));
  }, [userId, keepsAppKeybinds]);
}
