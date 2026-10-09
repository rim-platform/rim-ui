import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ENDPOINT, loadMlsModule } from "../../../test/e2eeWorld";
import { keyFromSeed } from "../../../test/ed25519";
import { insert } from "../../key-identity/browser/keyStore";
import { useE2eeStore } from "../state/useE2eeStore";
import { closeStores } from "./webCommands";
import { webStoreAccount } from "./webAccount";
import { resolveWebSession } from "./webSession";
import { useAuthStore } from "../../auth/state/useAuthStore";

const PRINCIPAL = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";

beforeAll(() => {
  loadMlsModule();
  (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange;
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  closeStores();
  useAuthStore.getState().setSession({ userId: "u-ada" });
});

async function linked(confirmed: boolean) {
  await insert({
    v: 1,
    endpoint: ENDPOINT,
    principalId: PRINCIPAL,
    deviceId: "0199D1A0-0000-7000-8000-000000000001",
    deviceName: "Firefox on Linux",
    deviceKey: (await keyFromSeed(20)).privateKey,
    confirmed,
    userId: "u-ada",
    username: "ada",
  });
}

describe("whether this browser runs encrypted conversations", () => {
  it("needs a confirmed device key of its own", async () => {
    expect(await resolveWebSession(ENDPOINT, "u-ada")).toEqual({
      support: "noDeviceKey",
      account: null,
    });
    await linked(false);
    expect((await resolveWebSession(ENDPOINT, "u-ada")).support).toBe("noDeviceKey");
    expect(useE2eeStore.getState().webEncryption).toBe("noDeviceKey");
    expect(webStoreAccount()).toBeNull();
  });

  it("opens the store for a linked browser and names its account", async () => {
    await linked(true);
    const { support, account } = await resolveWebSession(`${ENDPOINT}/`, "u-ada");
    expect(support).toBe("ready");
    expect(account).toEqual({
      endpoint: ENDPOINT,
      userId: "u-ada",
      principalId: PRINCIPAL,
      deviceId: "0199d1a0-0000-7000-8000-000000000001",
      web: true,
    });
    expect(webStoreAccount()).toEqual(account);
    expect(useE2eeStore.getState().webEncryption).toBe("ready");
    useAuthStore.getState().setSession({ userId: "u-someone-else" });
    expect(webStoreAccount()).toBeNull();
  });

  it("leaves encryption to the tab that holds the lock", async () => {
    await linked(true);
    const request = vi.fn(
      (_name: string, _options: unknown, callback: (lock: unknown) => unknown) =>
        Promise.resolve(callback(null)),
    );
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    try {
      expect((await resolveWebSession("http://other.example/api", "u-ada")).support).toBe(
        "noDeviceKey",
      );
      expect((await resolveWebSession(ENDPOINT, "u-ada")).support).toBe("otherTab");
      expect(request).toHaveBeenCalledWith(
        `rim-e2ee:${ENDPOINT}:${PRINCIPAL}`,
        { ifAvailable: true },
        expect.any(Function),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says a browser without WebCrypto Ed25519 or IndexedDB cannot", async () => {
    const factory = globalThis.indexedDB;
    // @ts-expect-error a browser without IndexedDB
    delete globalThis.indexedDB;
    try {
      vi.resetModules();
      const fresh = await import("./webSession");
      expect((await fresh.resolveWebSession(ENDPOINT, "u-ada")).support).toBe("unsupported");
    } finally {
      globalThis.indexedDB = factory;
    }
  });
});
