import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDraftStore } from "../../features/messages/state/useDraftStore";
import { failingIndexedDb } from "../../test/failingIndexedDb";
import { logger } from "../logger";
import { storageFailed, useStorageHealthStore } from "../storageHealth";
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
  useStorageHealthStore.setState({ failures: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("keep working from memory and report it when the database does not open", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    globalThis.indexedDB = failingIndexedDb();
    await unlock(ALICE);
    expect(storageFailed("account")).toBe(true);
    expect(useStorageHealthStore.getState().failures.account).toBe(
      "UnknownError: the database could not be opened",
    );
    writeSealedItem("note", "kept for now");
    expect(readSealedItem("note")).toBe("kept for now");
    await flushSealedStorage();
  });

  it("report a write that fails", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    await unlock(ALICE);
    expect(storageFailed("account")).toBe(false);
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("the disk is full", "QuotaExceededError");
    });
    writeSealedItem("note", "lost at restart");
    await flushSealedStorage();
    expect(storageFailed("account")).toBe(true);
    expect(useStorageHealthStore.getState().failures.account).toBe(
      "QuotaExceededError: the disk is full",
    );
  });

  it("do not count a lock while they are read as a failure", async () => {
    await unlock(ALICE);
    writeSealedItem("note", "alice");
    await flushSealedStorage();
    const getAll = IDBObjectStore.prototype.getAll;
    vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["getAll"]>
    ) {
      lockVault();
      return getAll.apply(this, args);
    });
    await unlock(ALICE).catch(() => undefined);
    expect(storageFailed("account")).toBe(false);
  });
});
