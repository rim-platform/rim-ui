/**
 * Small values this app keeps per account (drafts, removal notices, pending join requests, the
 * agent's conversations and switches), sealed under the account vault in IndexedDB
 * `rim-account`: one `kv` record per account and name, keyed `[endpoint, principalId, name]`,
 * its value sealed in `data`.
 *
 * At unlock the account's values are read into memory and the stores that keep their state here
 * hydrate; reads are synchronous from memory and writes go to IndexedDB in order. While locked,
 * nothing is read or kept, and the stores are back at their initial state.
 */

import type { StateStorage } from "zustand/middleware";

import { logger } from "../logger";
import { onVaultLock, onVaultUnlock, vaultHolds, type VaultAccount } from "./accountVault";
import { openRecords, sealRecord, type SealedStore } from "./sealedRecords";

const DB_NAME = "rim-account";
const DB_VERSION = 1;
const KV = "kv";

const KV_RECORDS: SealedStore = {
  db: DB_NAME,
  store: KV,
  keyPath: ["endpoint", "principalId", "name"],
  plain: ["endpoint", "principalId", "name"],
};

/** What this app kept in localStorage per account before these values were sealed. */
const LEGACY_KEYS = [
  "rim-drafts",
  "rim-workspace-removals",
  "rim.e2ee.plaintextNoticeSeen",
  "rim-agent-store",
  "rim-agent-encrypted",
];
const LEGACY_PREFIXES = ["rim:remote-join-requests:"];

interface KvRecord {
  endpoint: string;
  principalId: string;
  name: string;
  value: string;
}

/** A zustand store that keeps its state here. */
export interface SealedPersistedStore {
  persist: { rehydrate: () => Promise<void> | void };
  setState: (state: never, replace: true) => void;
  getInitialState: () => unknown;
}

let account: VaultAccount | null = null;
const memory = new Map<string, string>();
const stores = new Set<SealedPersistedStore>();
let writes: Promise<void> = Promise.resolve();
let opened: { factory: IDBFactory; db: Promise<IDBDatabase> } | null = null;

/** The database, opened once per page; `null` where the browser has no IndexedDB. */
function database(): Promise<IDBDatabase> | null {
  const factory = globalThis.indexedDB;
  if (!factory) return null;
  if (opened?.factory === factory) return opened.db;
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KV, { keyPath: [...KV_RECORDS.keyPath] });
    };
    request.onsuccess = () => {
      const handle = request.result;
      handle.onversionchange = () => {
        handle.close();
        if (opened?.factory === factory) opened = null;
      };
      resolve(handle);
    };
    request.onerror = () => reject(request.error ?? new Error("the account store did not open"));
    request.onblocked = () => reject(new Error("the account store is blocked by another tab"));
  });
  opened = { factory, db };
  db.catch(() => {
    if (opened?.db === db) opened = null;
  });
  return db;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("account store request failed"));
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("account store write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("account store write was aborted"));
  });
}

function accountRange(endpoint: string, principalId: string): IDBKeyRange {
  return IDBKeyRange.bound([endpoint, principalId, ""], [endpoint, principalId, "￿"]);
}

/**
 * Reads the account's values into memory and hydrates the stores. Where IndexedDB cannot be
 * read, the values live in memory for this page only.
 */
async function load(next: VaultAccount): Promise<void> {
  memory.clear();
  account = next;
  const db = database();
  try {
    if (!db) return;
    const tx = (await db).transaction(KV, "readonly");
    const stored = await done(
      tx.objectStore(KV).getAll(accountRange(next.endpoint, next.principalId)),
    );
    for (const r of await openRecords<KvRecord>(KV_RECORDS, stored)) memory.set(r.name, r.value);
  } catch (err) {
    logger.warn("[RIM:vault] the account's values could not be read:", err);
  } finally {
    for (const store of stores) await store.persist.rehydrate();
  }
}

function reset(): void {
  account = null;
  memory.clear();
  for (const store of stores) store.setState(store.getInitialState() as never, true);
}

onVaultUnlock(load);
onVaultLock(reset);

function write(name: string, value: string | null): void {
  const at = account;
  if (!at) return;
  writes = writes
    .then(async () => {
      const db = database();
      if (!db || !vaultHolds(at.endpoint, at.principalId)) return;
      const key = [at.endpoint, at.principalId, name];
      const sealed =
        value === null
          ? null
          : await sealRecord(KV_RECORDS, { ...at, name, value } satisfies KvRecord);
      const tx = (await db).transaction(KV, "readwrite");
      const finished = committed(tx);
      if (sealed) tx.objectStore(KV).put(sealed);
      else tx.objectStore(KV).delete(key);
      await finished;
    })
    .catch((err: unknown) => {
      logger.warn("[RIM:vault] keeping an account value failed:", err);
    });
}

/**
 * The unlocked account's value `name`.
 *
 * @returns The value, or `null` when it has none or nothing is unlocked.
 */
export function readSealedItem(name: string): string | null {
  return account ? (memory.get(name) ?? null) : null;
}

/** Keeps `value` as the unlocked account's `name`; nothing while locked. */
export function writeSealedItem(name: string, value: string): void {
  if (!account) return;
  memory.set(name, value);
  write(name, value);
}

/** Forgets the unlocked account's `name`; nothing while locked. */
export function removeSealedItem(name: string): void {
  if (!account) return;
  memory.delete(name);
  write(name, null);
}

/** Settles once every write asked for so far is stored. */
export function flushSealedStorage(): Promise<void> {
  return writes;
}

/** The storage of a zustand `persist` store kept per account under the vault. */
export const sealedStateStorage: StateStorage = {
  getItem: readSealedItem,
  setItem: writeSealedItem,
  removeItem: removeSealedItem,
};

/**
 * Hydrates `store` at each unlock and puts it back at its initial state at each lock. Its
 * `persist` options name {@link sealedStateStorage} and skip hydration at start.
 */
export function registerSealedStore(store: SealedPersistedStore): void {
  stores.add(store);
}

/**
 * Deletes every value of an account, locked or not, as removing it from this device does.
 *
 * @param endpoint - The endpoint as the key store writes it.
 */
export async function deleteSealedAccount(endpoint: string, principalId: string): Promise<void> {
  if (account?.endpoint === endpoint && account.principalId === principalId) memory.clear();
  await writes;
  const db = database();
  if (!db) return;
  const tx = (await db).transaction(KV, "readwrite");
  const finished = committed(tx);
  tx.objectStore(KV).delete(accountRange(endpoint, principalId));
  await finished;
}

/** Removes what earlier versions kept per account in localStorage, unsealed. */
export function dropLegacyLocalStorage(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (LEGACY_KEYS.includes(key) || LEGACY_PREFIXES.some((p) => key.startsWith(p)))) {
        stale.push(key);
      }
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing was kept there either.
  }
}
