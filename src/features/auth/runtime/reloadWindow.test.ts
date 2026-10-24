// The reload window of an unkept web session, against a server that holds the reload key and
// hands it back once per reload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The server's side: the reload key it holds, and whether a reload is answered now. */
const server = vi.hoisted(() => ({
  key: null as string | null,
  open: true,
  reloads: 0,
}));

vi.mock("../api/sessionKeys", async () => {
  const { toB64 } = await import("../../../core/accountVault/crypto");
  const fresh = () => toB64(crypto.getRandomValues(new Uint8Array(32)));
  return {
    setReloadKey: async () => {
      server.key = fresh();
      return server.key;
    },
    reloadSession: async () => {
      server.reloads += 1;
      if (!server.open || !server.key) throw new Error("UNAUTHENTICATED");
      const reloadKey = server.key;
      server.key = fresh();
      return { reloadKey, nextReloadKey: server.key };
    },
  };
});

import {
  lockVault,
  unlockVault,
  unlockVaultWithStoreKey,
  vaultAccount,
  vaultDataKey,
} from "../../../core/accountVault/accountVault";
import { toB64 } from "../../../core/accountVault/crypto";
import { sessionSecret, setSessionSecret } from "../../../core/graphql/sessionSecret";
import { clearReloadWindow, keepForReload, restoreAfterReload } from "./reloadWindow";

const ENDPOINT = "http://localhost:8080/api/";
const ACCOUNT = { endpoint: "http://localhost:8080/api", principalId: "rimp1_me" };
const KEY = "rim:reload:http://localhost:8080/api";
const DATA_KEY = new Uint8Array(32).fill(0x44);
const SECRET = "dGhlIHNlc3Npb24gc2VjcmV0IG9mIDMyIGJ5dGVzIQ";

/** A reload: what lived in memory is gone. */
function reload() {
  lockVault();
  setSessionSecret(null);
}

beforeEach(async () => {
  server.key = null;
  server.open = true;
  server.reloads = 0;
  sessionStorage.clear();
  reload();
  await unlockVault(ACCOUNT, DATA_KEY);
  setSessionSecret(SECRET);
});

afterEach(() => {
  reload();
  clearReloadWindow();
});

describe("the reload window", () => {
  it("keeps the data key and the secret sealed under a key only the server holds", async () => {
    await keepForReload();
    const kept = sessionStorage.getItem(KEY);
    expect(kept).not.toBeNull();
    expect(kept).not.toContain(SECRET);
    expect(kept).not.toContain(toB64(DATA_KEY));

    reload();
    expect(await restoreAfterReload(ENDPOINT)).toBe(true);
    expect(vaultAccount()).toEqual(ACCOUNT);
    expect(vaultDataKey()).toEqual(DATA_KEY);
    expect(sessionSecret()).toBe(SECRET);
    // Sealed again under the key the server holds now, so the next reload opens too.
    expect(sessionStorage.getItem(KEY)).not.toBe(kept);

    reload();
    expect(await restoreAfterReload(ENDPOINT)).toBe(true);
    expect(sessionSecret()).toBe(SECRET);
  });

  it("locks the account and forgets what it kept once the server answers nothing", async () => {
    await keepForReload();
    reload();
    server.open = false;
    expect(await restoreAfterReload(ENDPOINT)).toBe(false);
    expect(vaultAccount()).toBeNull();
    expect(sessionSecret()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("refuses what was kept under another key, or changed", async () => {
    await keepForReload();
    const kept = sessionStorage.getItem(KEY) ?? "";
    sessionStorage.setItem(
      KEY,
      `${kept.slice(0, 20)}${kept[20] === "A" ? "B" : "A"}${kept.slice(21)}`,
    );
    reload();
    expect(await restoreAfterReload(ENDPOINT)).toBe(false);
    expect(vaultAccount()).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("asks nothing without a kept session or while the secret is in memory", async () => {
    expect(await restoreAfterReload(ENDPOINT)).toBe(false);
    await keepForReload();
    expect(await restoreAfterReload(ENDPOINT)).toBe(false);
    expect(server.reloads).toBe(0);
  });

  it("keeps nothing for a kept session or without the data key, as on the desktop", async () => {
    setSessionSecret(null);
    await keepForReload();
    expect(sessionStorage.getItem(KEY)).toBeNull();

    setSessionSecret(SECRET);
    await unlockVaultWithStoreKey(ACCOUNT, new Uint8Array(32).fill(1));
    await keepForReload();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(server.key).toBeNull();
  });
});
