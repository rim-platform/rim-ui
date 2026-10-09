/**
 * What this app keeps about servers and spaces elsewhere, in one IndexedDB database
 * (`rim-relay`), on the desktop and in the web app alike:
 *
 * - `servers`: per server id, the pinned key log (entry hashes and keys), the origin it was
 *   fetched from, its descriptor, and whether it forked.
 * - `spaces`: per account, the spaces this account uses on other servers and their host.
 * - `requestSeq`: per device and host, the last device request `seq` signed.
 * - `streams`: per account, host, space and stream, the last event `seq` applied.
 * - `aliases`: per account, the name the person gave a contact.
 * - `meta`: per account, small values such as the last relay item applied.
 */

import type { Statement } from "../../key-identity/browser/statements";
import type { ServerRotationSigner } from "../crypto/serverStatements";

const DB_NAME = "rim-relay";
const DB_VERSION = 1;

export type RelayStore = "servers" | "spaces" | "requestSeq" | "streams" | "aliases" | "meta";

const KEY_PATHS: Record<RelayStore, string | string[]> = {
  servers: "serverId",
  spaces: ["account", "spaceId"],
  requestSeq: ["deviceId", "host"],
  streams: ["account", "host", "workspaceId", "stream"],
  aliases: ["account", "principalId"],
  meta: ["account", "name"],
};

/** A server pinned on first use. */
export interface ServerPin {
  serverId: string;
  origin: string;
  log: Statement[];
  /** Hash of every entry, oldest first. */
  hashes: string[];
  /** The server key at every seq. */
  keys: string[];
  signers: (ServerRotationSigner | null)[];
  /** Until when the key before the head still verifies, after a server rotation seen here. */
  previousKeyUntil: number | null;
  descriptorVersion: number;
  status: "active" | "forked";
  pinnedAt: number;
  fetchedAt: number;
}

/** A space this account uses on another server. */
export interface SpaceRecord {
  account: string;
  spaceId: string;
  hostServerId: string;
  kind: "direct" | "workspace";
}

let opened: { factory: IDBFactory; db: Promise<IDBDatabase> } | null = null;

function database(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(new Error("this browser cannot store relay state"));
  if (opened?.factory === factory) return opened.db;
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(KEY_PATHS)) {
        if (!request.result.objectStoreNames.contains(name)) {
          request.result.createObjectStore(name, { keyPath });
        }
      }
    };
    request.onsuccess = () => {
      const handle = request.result;
      handle.onversionchange = () => {
        handle.close();
        if (opened?.factory === factory) opened = null;
      };
      resolve(handle);
    };
    request.onerror = () => reject(request.error ?? new Error("the relay store did not open"));
    request.onblocked = () => reject(new Error("the relay store is blocked by another tab"));
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
    request.onerror = () => reject(request.error ?? new Error("relay store request failed"));
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("relay store write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("relay store write was aborted"));
  });
}

export async function getRecord<T>(store: RelayStore, key: IDBValidKey): Promise<T | null> {
  const tx = (await database()).transaction(store, "readonly");
  return ((await done(tx.objectStore(store).get(key))) as T | undefined) ?? null;
}

export async function allRecords<T>(store: RelayStore): Promise<T[]> {
  const tx = (await database()).transaction(store, "readonly");
  return (await done(tx.objectStore(store).getAll())) as T[];
}

export async function putRecord<T>(store: RelayStore, value: T): Promise<void> {
  const tx = (await database()).transaction(store, "readwrite");
  const finished = committed(tx);
  tx.objectStore(store).put(value);
  await finished;
}

export async function deleteRecord(store: RelayStore, key: IDBValidKey): Promise<void> {
  const tx = (await database()).transaction(store, "readwrite");
  const finished = committed(tx);
  tx.objectStore(store).delete(key);
  await finished;
}

/**
 * Read a record, change it and write it back in one transaction: `change` gets the stored
 * value (or `null`) and returns the one to write, or `null` to leave it.
 */
export async function updateRecord<T>(
  store: RelayStore,
  key: IDBValidKey,
  change: (current: T | null) => T | null,
): Promise<T | null> {
  const tx = (await database()).transaction(store, "readwrite");
  const finished = committed(tx);
  const objects = tx.objectStore(store);
  const current = ((await done(objects.get(key))) as T | undefined) ?? null;
  const next = change(current);
  if (next !== null) objects.put(next);
  await finished;
  return next ?? current;
}
