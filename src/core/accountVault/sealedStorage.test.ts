import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { useDraftStore } from "../../features/messages/state/useDraftStore";
import { lockVault, unlockVault } from "./accountVault";
import {
  deleteSealedAccount,
  dropLegacyLocalStorage,
  flushSealedStorage,
  readSealedItem,
  writeSealedItem,
} from "./sealedStorage";

const ALICE = { endpoint: "http://localhost:8080/api", principalId: "rimp1_alice" };
const BOB = { endpoint: "http://localhost:8080/api", principalId: "rimp1_bob" };

function unlock(account: typeof ALICE) {
  return unlockVault(account, new Uint8Array(32).fill(account === ALICE ? 1 : 2));
}

async function storedRows(): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("rim-account");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve) => {
    const request = db.transaction("kv").objectStore("kv").getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  lockVault();
  localStorage.clear();
});

describe("the account's sealed values", () => {
  it("keep nothing while locked, and seal what they keep per account", async () => {
    writeSealedItem("note", "lost");
    expect(readSealedItem("note")).toBeNull();

    await unlock(ALICE);
    writeSealedItem("note", "alice's secret");
    useDraftStore.getState().setDraft("c1", "a draft of alice");
    await flushSealedStorage();
    const rows = await storedRows();
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("secret");
    expect(JSON.stringify(rows)).not.toContain("a draft");

    lockVault();
    expect(readSealedItem("note")).toBeNull();
    expect(useDraftStore.getState().drafts).toEqual({});

    await unlock(BOB);
    expect(readSealedItem("note")).toBeNull();
    expect(useDraftStore.getState().drafts).toEqual({});

    await unlock(ALICE);
    expect(readSealedItem("note")).toBe("alice's secret");
    expect(useDraftStore.getState().drafts).toEqual({ c1: "a draft of alice" });
  });

  it("are deleted with their account, locked or not", async () => {
    await unlock(ALICE);
    writeSealedItem("note", "alice");
    await unlock(BOB);
    writeSealedItem("note", "bob");
    await flushSealedStorage();
    lockVault();

    await deleteSealedAccount(ALICE.endpoint, ALICE.principalId);
    await unlock(ALICE);
    expect(readSealedItem("note")).toBeNull();
    await unlock(BOB);
    expect(readSealedItem("note")).toBe("bob");
  });

  it("replace what earlier versions kept in localStorage, which goes", () => {
    localStorage.setItem("rim-drafts", "{}");
    localStorage.setItem("rim:remote-join-requests:http://x|rimp1_a", "[]");
    localStorage.setItem("rim-shell", "kept");
    dropLegacyLocalStorage();
    expect(localStorage.getItem("rim-drafts")).toBeNull();
    expect(localStorage.getItem("rim:remote-join-requests:http://x|rimp1_a")).toBeNull();
    expect(localStorage.getItem("rim-shell")).toBe("kept");
  });
});
