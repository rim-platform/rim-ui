/**
 * The unlock gate: whether the signed-in account's data is open on this device. A session alone
 * opens nothing; the account's data opens with its data key, which the password, the recovery
 * phrase or a kept session unlocks. When the vault is locked at start, the gate tries the ways
 * that need no password: on the desktop, a kept account opens without the server.
 */

import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

import { useAccountVault } from "../../../core/accountVault/accountVault";
import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { logger } from "../../../core/logger";
import { keyBackend } from "../../key-identity/api/keyBackend";
import { unlockKeptOnDesktop } from "./accountUnlock";

/** Where the gate is: trying to open without a password, open, or waiting for one. */
export type UnlockGateState = "opening" | "unlocked" | "locked";

/**
 * The principal this device holds for the signed-in `userId` on `endpoint`.
 *
 * @returns The principal id, or `null` when this device holds no keys for the account.
 */
export async function principalOf(endpoint: string, userId: string): Promise<string | null> {
  const accounts = await keyBackend().accounts(endpoint);
  return accounts.find((a) => a.userId === userId)?.principalId ?? null;
}

/**
 * Opens the account without asking for its password, where this device can.
 *
 * @returns Whether it opened.
 */
async function openWithoutPassword(endpoint: string, userId: string): Promise<boolean> {
  const principalId = await principalOf(endpoint, userId);
  if (!principalId) return false;
  if (isTauri()) return unlockKeptOnDesktop(endpoint, principalId);
  return false;
}

/**
 * The gate for the signed-in `userId`: `unlocked` once the vault is ready, `opening` while it
 * tries to open without a password, `locked` when only a password opens it.
 */
export function useUnlockGate(userId: string | null): UnlockGateState {
  const { account } = useAccountVault();
  const [tried, setTried] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || account || tried === userId) return;
    let cancelled = false;
    openWithoutPassword(getGraphqlEndpoint(), userId)
      .catch((err: unknown) => {
        logger.warn("[RIM:auth] opening the account without its password failed:", err);
        return false;
      })
      .finally(() => {
        if (!cancelled) setTried(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, account, tried]);

  if (account) return "unlocked";
  return tried === userId ? "locked" : "opening";
}
