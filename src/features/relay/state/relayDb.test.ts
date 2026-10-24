import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { lockVault, VaultLockedError } from "../../../core/accountVault/accountVault";
import { unlockTestVault } from "../../../test/accountVault";
import { allRecords, getRecord, putRecord, updateRecord } from "./relayDb";

const ACCOUNT = "http://localhost:8080/api|rimp1_me";

/** Every record of `store` as IndexedDB holds it. */
async function stored(store: string): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("rim-relay");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };
  });
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await unlockTestVault();
});

describe("the relay store at rest", () => {
  it("seals every account's record but its key, and opens it only while unlocked", async () => {
    await putRecord("aliases", { account: ACCOUNT, principalId: "rimp1_bob", alias: "Bobby" });
    const [raw] = (await stored("aliases")) as Record<string, unknown>[];
    expect(Object.keys(raw).sort()).toEqual(["account", "data", "principalId"]);
    expect(JSON.stringify(raw)).not.toContain("Bobby");
    expect(await getRecord("aliases", [ACCOUNT, "rimp1_bob"])).toEqual({
      account: ACCOUNT,
      principalId: "rimp1_bob",
      alias: "Bobby",
    });

    lockVault();
    await expect(allRecords("aliases")).rejects.toBeInstanceOf(VaultLockedError);
    await expect(putRecord("meta", { account: ACCOUNT, name: "x" })).rejects.toBeInstanceOf(
      VaultLockedError,
    );
  });

  it("keeps the public server pins plain", async () => {
    lockVault();
    await putRecord("servers", { serverId: "rims1_a", origin: "https://a.example" });
    expect(await getRecord("servers", "rims1_a")).toEqual({
      serverId: "rims1_a",
      origin: "https://a.example",
    });
  });

  it("changes a record one change at a time", async () => {
    const key = ["device-1", "host"];
    const bump = () =>
      updateRecord<{ deviceId: string; host: string; seq: number }>("requestSeq", key, (c) => ({
        deviceId: "device-1",
        host: "host",
        seq: (c?.seq ?? 0) + 1,
      }));
    await Promise.all([bump(), bump(), bump()]);
    expect(await getRecord("requestSeq", key)).toMatchObject({ seq: 3 });
  });
});
