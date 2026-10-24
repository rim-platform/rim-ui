/**
 * The reload window of an unkept web session: a reload loses the data key and the session
 * secret held in memory, so while the account is unlocked the tab keeps both in
 * `sessionStorage`, sealed under a reload key only the server holds (`rim:reload:<endpoint>`).
 * At start the page asks the server for that key; it answers once, within 60 seconds of the
 * session's WebSocket closing, with a new key to seal under again. After that, after a browser
 * restart or in a copied profile, nothing opens and the account is locked.
 *
 * The stored value is base64url of `nonce ‖ ciphertext ‖ tag`: AES-256-GCM under the reload key,
 * authenticating the storage key, of `{v: 1, principalId, dataKey, sessionSecret}`.
 */

import { unlockVault, vaultAccount, vaultDataKey } from "../../../core/accountVault/accountVault";
import { fromB64, open, seal, toB64 } from "../../../core/accountVault/crypto";
import { sessionSecret, setSessionSecret } from "../../../core/graphql/sessionSecret";
import { logger } from "../../../core/logger";
import { utf8 } from "../../key-identity/browser/bytes";
import { storedEndpoint } from "../../key-identity/browser/keyStore";
import { reloadSession, setReloadKey } from "../api/sessionKeys";

const PREFIX = "rim:reload:";

/** What a tab keeps for a reload. */
interface ReloadBlob {
  v: 1;
  principalId: string;
  /** The account's data key, base64url. */
  dataKey: string;
  sessionSecret: string;
}

function storageKey(endpoint: string): string {
  return `${PREFIX}${storedEndpoint(endpoint)}`;
}

function isBlob(value: unknown): value is ReloadBlob {
  const blob = value as Partial<ReloadBlob> | null;
  return (
    typeof blob === "object" &&
    blob !== null &&
    blob.v === 1 &&
    typeof blob.principalId === "string" &&
    typeof blob.dataKey === "string" &&
    typeof blob.sessionSecret === "string"
  );
}

async function keep(endpoint: string, reloadKey: Uint8Array, blob: ReloadBlob): Promise<void> {
  const key = storageKey(endpoint);
  const sealed = await seal(reloadKey, utf8(key), utf8(JSON.stringify(blob)));
  sessionStorage.setItem(key, toB64(sealed));
}

/**
 * Keeps the unlocked account's data key and the session secret for a reload, under a new reload
 * key from the server. Nothing happens without a data key (the desktop) or a session secret (a
 * kept session).
 */
export async function keepForReload(): Promise<void> {
  const account = vaultAccount();
  const secret = sessionSecret();
  const dataKey = vaultDataKey();
  try {
    if (!account || !secret || !dataKey) return;
    const reloadKey = fromB64(await setReloadKey(), "the reload key");
    try {
      await keep(account.endpoint, reloadKey, {
        v: 1,
        principalId: account.principalId,
        dataKey: toB64(dataKey),
        sessionSecret: secret,
      });
    } finally {
      reloadKey.fill(0);
    }
  } finally {
    dataKey?.fill(0);
  }
}

/**
 * After a reload, opens what the tab kept with the reload key the server hands back, keeps it
 * again under the next one, and unlocks the account with the session secret back in memory.
 * On any failure what was kept goes, and the account stays locked.
 *
 * @param endpoint - The GraphQL endpoint the session is at.
 * @returns Whether the account is unlocked; `false` too when nothing was kept or a session
 *   secret is already held.
 */
export async function restoreAfterReload(endpoint: string): Promise<boolean> {
  const key = storageKey(endpoint);
  let stored: string | null;
  try {
    stored = sessionStorage.getItem(key);
  } catch {
    return false;
  }
  if (!stored || sessionSecret()) return false;
  try {
    const keys = await reloadSession();
    const opened = await open(
      fromB64(keys.reloadKey, "the reload key"),
      utf8(key),
      fromB64(stored, "the kept session"),
    );
    const blob: unknown = JSON.parse(new TextDecoder().decode(opened));
    opened.fill(0);
    if (!isBlob(blob)) throw new Error("what the tab kept for the reload is not readable");
    const next = fromB64(keys.nextReloadKey, "the next reload key");
    try {
      await keep(endpoint, next, blob);
    } finally {
      next.fill(0);
    }
    setSessionSecret(blob.sessionSecret);
    const dataKey = fromB64(blob.dataKey, "the data key");
    try {
      await unlockVault(
        { endpoint: storedEndpoint(endpoint), principalId: blob.principalId },
        dataKey,
      );
    } finally {
      dataKey.fill(0);
    }
    return true;
  } catch (err) {
    logger.warn("[RIM:auth] the session did not come back after the reload:", err);
    setSessionSecret(null);
    clearReloadWindow();
    return false;
  }
}

/** Forgets what this tab kept for a reload, as locking and signing out do. */
export function clearReloadWindow(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) stale.push(key);
    }
    for (const key of stale) sessionStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing was kept there either.
  }
}
