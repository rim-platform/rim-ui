import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { lockVault, VaultLockedError } from "../../../core/accountVault/accountVault";
import { readWraps } from "../../../core/accountVault/dkWraps";
import { unlockTestVault } from "../../../test/accountVault";
import {
  deletePendingLink,
  record,
  storedRecord,
  update,
  insert,
  pendingLinks,
  principalRecords,
  putPendingLink,
  records,
  updatePrincipal,
  type BrowserKeyRecord,
  type BrowserPendingLink,
} from "./keyStore";

const ENDPOINT = "http://localhost:8080/api";

async function deviceKey(): Promise<CryptoKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  return pair.privateKey;
}

async function keyRecord(
  principalId: string,
  extra: Partial<BrowserKeyRecord> = {},
): Promise<BrowserKeyRecord> {
  return {
    v: 1,
    endpoint: ENDPOINT,
    principalId,
    deviceId: `device-of-${principalId}`,
    deviceName: "Firefox on Linux",
    deviceKey: await deviceKey(),
    confirmed: false,
    userId: null,
    username: null,
    ...extra,
  };
}

const PENDING: BrowserPendingLink = {
  v: 1,
  linkId: "AAECAwQFBgcICQoLDA0ODw",
  endpoint: ENDPOINT,
  principalId: "rimp1_a",
  deviceId: "01999999-0000-7000-8000-000000000001",
  deviceKey: "ed25519:new",
  certificate: { payload: "{}", signature: "ed25519:sig" },
  answer: { nonce: "n", ciphertext: "c" },
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  lockVault();
});

describe("the browser key store", () => {
  it("drops the unsealed records of an older store and adds the new stores", async () => {
    const old = await keyRecord("rimp1_old");
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("rim-key-identity", 1);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore("deviceKeys", { keyPath: ["endpoint", "principalId"] })
          .put(old);
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    expect(await records(ENDPOINT)).toEqual([]);
    expect(await pendingLinks()).toEqual([]);
    expect(await readWraps(ENDPOINT, "rimp1_old")).toBeNull();
  });

  it("keeps an identity record's keys, kit entropy and flag as written", async () => {
    const identity = { privateKey: await deviceKey(), publicKey: "ed25519:identity" };
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    await insert(
      await keyRecord("rimp1_a", { identity, recoveryEntropy: entropy, kitConfirmed: false }),
    );
    const [stored] = await principalRecords("rimp1_a");
    expect(stored.identity?.publicKey).toBe("ed25519:identity");
    expect(stored.identity?.privateKey.extractable).toBe(false);
    expect(Array.from(stored.recoveryEntropy ?? [])).toEqual(Array.from(entropy));
    expect(stored.kitConfirmed).toBe(false);
  });

  it("changes or removes one principal's records in one go", async () => {
    await insert(await keyRecord("rimp1_a"));
    await insert(await keyRecord("rimp1_b"));
    await updatePrincipal("rimp1_a", (r) => ({ ...r, confirmed: true }));
    expect((await principalRecords("rimp1_a"))[0].confirmed).toBe(true);
    await updatePrincipal("rimp1_a", () => null);
    expect((await records(ENDPOINT)).map((r) => r.principalId)).toEqual(["rimp1_b"]);
  });

  it("stores, lists and deletes pending device links", async () => {
    await expect(putPendingLink(PENDING)).rejects.toBeInstanceOf(VaultLockedError);
    await unlockTestVault({ endpoint: ENDPOINT, principalId: PENDING.principalId });
    await putPendingLink(PENDING);
    expect(await pendingLinks()).toEqual([PENDING]);
    await deletePendingLink(PENDING.linkId);
    await deletePendingLink(PENDING.linkId);
    expect(await pendingLinks()).toEqual([]);
  });

  it("seals the keys of an unlocked account and writes a locked record back unchanged", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    await unlockTestVault({ endpoint: ENDPOINT, principalId: "rimp1_a" });
    await insert(await keyRecord("rimp1_a", { deviceKey: pair.privateKey }));
    const sealed = (await storedRecord(ENDPOINT, "rimp1_a")) as Record<string, unknown>;
    expect(sealed.deviceKey).toBeUndefined();
    expect(sealed.data).toMatchObject({ v: 1 });

    lockVault();
    const locked = await record(ENDPOINT, "rimp1_a");
    expect(locked?.deviceKey).toBeNull();
    await updatePrincipal("rimp1_a", (r) => ({ ...r, confirmed: true, userId: "user-a" }));
    expect(await storedRecord(ENDPOINT, "rimp1_a")).toEqual({
      ...sealed,
      confirmed: true,
      userId: "user-a",
    });

    await unlockTestVault({ endpoint: ENDPOINT, principalId: "rimp1_a" });
    const key = (await record(ENDPOINT, "rimp1_a"))?.deviceKey;
    if (!key) throw new Error("the device key did not open");
    expect(key.extractable).toBe(false);
    const data = new TextEncoder().encode("login");
    const signature = await crypto.subtle.sign("Ed25519", key, data);
    expect(await crypto.subtle.verify("Ed25519", pair.publicKey, signature, data)).toBe(true);

    // Keys opened while unlocked are never written back unsealed once it locks.
    const opened = await record(ENDPOINT, "rimp1_a");
    lockVault();
    await expect(
      update(ENDPOINT, () => ({ put: [{ ...(opened as BrowserKeyRecord), deviceName: "x" }] })),
    ).rejects.toBeInstanceOf(VaultLockedError);
    expect((await storedRecord(ENDPOINT, "rimp1_a")) as Record<string, unknown>).toMatchObject({
      deviceName: "Firefox on Linux",
    });

    // While another account is unlocked, this one's keys stay locked.
    await unlockTestVault({ endpoint: ENDPOINT, principalId: "rimp1_b" });
    expect((await record(ENDPOINT, "rimp1_a"))?.locked).toBeDefined();
  });
});
