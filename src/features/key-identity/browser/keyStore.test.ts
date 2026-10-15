import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  deletePendingLink,
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
});

describe("the browser key store", () => {
  it("keeps the records a version 1 store holds and adds the pending link store", async () => {
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

    expect((await records(ENDPOINT)).map((r) => r.principalId)).toEqual(["rimp1_old"]);
    expect(await pendingLinks()).toEqual([]);
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
    await putPendingLink(PENDING);
    expect(await pendingLinks()).toEqual([PENDING]);
    await deletePendingLink(PENDING.linkId);
    await deletePendingLink(PENDING.linkId);
    expect(await pendingLinks()).toEqual([]);
  });
});
