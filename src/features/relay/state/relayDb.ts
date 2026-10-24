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
 * - `delegations`: per account and workspace elsewhere, the delegation this device signed for
 *   the relay, and when it expires.
 *
 * Every store but `servers`, whose pins are public and the app's, is sealed under the signed-in
 * account's data key (the account vault): a record's key fields stay plain and the rest is
 * sealed. Records that do not open under the unlocked account read as absent, and reading or
 * writing a sealed store while locked throws `VaultLockedError`.
 */

import {
  openRecord,
  openRecords,
  sealRecord,
  type SealedStore,
} from "../../../core/accountVault/sealedRecords";
import { exclusive } from "../../key-identity/browser/persistence";
import type { Statement } from "../../key-identity/browser/statements";
import type { ServerRotationSigner } from "../crypto/serverStatements";

const DB_NAME = "rim-relay";
const DB_VERSION = 3;

export type RelayStore =
  "servers" | "spaces" | "requestSeq" | "streams" | "aliases" | "meta" | "delegations";

const KEY_PATHS: Record<RelayStore, string | string[]> = {
  servers: "serverId",
  spaces: ["account", "spaceId"],
  requestSeq: ["deviceId", "host"],
  streams: ["account", "host", "workspaceId", "stream"],
  aliases: ["account", "principalId"],
  meta: ["account", "name"],
  delegations: ["account", "workspaceId"],
};

/** Where each sealed store's records live; `null` for the plain `servers`. */
function sealedStore(store: RelayStore): SealedStore | null {
  if (store === "servers") return null;
  const keyPath = KEY_PATHS[store];
  return { db: DB_NAME, store, keyPath, plain: typeof keyPath === "string" ? [keyPath] : keyPath };
}

function toStored<T>(store: RelayStore, value: T): Promise<unknown> | T {
  const where = sealedStore(store);
  return where ? sealRecord(where, value as object) : value;
}

async function fromStored<T>(store: RelayStore, stored: unknown): Promise<T | null> {
  if (stored === undefined || stored === null) return null;
  const where = sealedStore(store);
  return where ? openRecord<T>(where, stored) : (stored as T);
}

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
  /** Where the server answers its own clients, from its verified descriptor. */
  endpoints?: { graphql: string; websocket: string };
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
  /** A workspace's name, as its host last answered. */
  name?: string;
  /** A workspace owner's name as shown, as its host last answered; null when it has none. */
  ownerName?: string | null;
}

/** The delegation this device signed for its relay, for one workspace elsewhere. */
export interface DelegationRecord {
  account: string;
  workspaceId: string;
  host: string;
  relay: string;
  issuedAt: number;
  expiresAt: number;
  statement: Statement;
}

let opened: { factory: IDBFactory; db: Promise<IDBDatabase> } | null = null;

function database(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(new Error("this browser cannot store relay state"));
  if (opened?.factory === factory) return opened.db;
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      for (const [name, keyPath] of Object.entries(KEY_PATHS)) {
        if (!request.result.objectStoreNames.contains(name)) {
          request.result.createObjectStore(name, { keyPath });
        } else if (event.oldVersion < 3 && name !== "servers") {
          // Written unsealed: dropped rather than carried over.
          request.transaction?.objectStore(name).clear();
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
  return fromStored<T>(store, await done(tx.objectStore(store).get(key)));
}

/** Every record of `store` that opens under the unlocked account. */
export async function allRecords<T>(store: RelayStore): Promise<T[]> {
  const tx = (await database()).transaction(store, "readonly");
  const stored = await done(tx.objectStore(store).getAll());
  const where = sealedStore(store);
  return where ? openRecords<T>(where, stored) : (stored as T[]);
}

export async function putRecord<T>(store: RelayStore, value: T): Promise<void> {
  const stored = await toStored(store, value);
  const tx = (await database()).transaction(store, "readwrite");
  const finished = committed(tx);
  tx.objectStore(store).put(stored);
  await finished;
}

export async function deleteRecord(store: RelayStore, key: IDBValidKey): Promise<void> {
  const tx = (await database()).transaction(store, "readwrite");
  const finished = committed(tx);
  tx.objectStore(store).delete(key);
  await finished;
}

/** The stores keyed by account first. */
const ACCOUNT_STORES: RelayStore[] = ["spaces", "streams", "aliases", "meta", "delegations"];

/**
 * Delete every record of `account` and the request seqs `deviceId` signed, in one transaction.
 * The pinned servers stay: they are not any account's.
 *
 * @param account - The account's key, `endpoint|principalId`.
 * @param deviceId - The account's device on this app, or `null` when it has none here.
 */
export async function deleteAccountRecords(
  account: string,
  deviceId: string | null,
): Promise<void> {
  const stores: [RelayStore, string][] = ACCOUNT_STORES.map((store) => [store, account]);
  if (deviceId !== null) stores.push(["requestSeq", deviceId]);
  const tx = (await database()).transaction(
    stores.map(([store]) => store),
    "readwrite",
  );
  const finished = committed(tx);
  await Promise.all(
    stores.map(async ([name, first]) => {
      const store = tx.objectStore(name);
      for (const key of await done(store.getAllKeys())) {
        if ((key as IDBValidKey[])[0] === first) store.delete(key);
      }
    }),
  );
  await finished;
}

/**
 * Read a record, change it and write it back, one change of the store at a time across this
 * origin's tabs: `change` gets the stored value (or `null`) and returns the one to write, or
 * `null` to leave it.
 */
export function updateRecord<T>(
  store: RelayStore,
  key: IDBValidKey,
  change: (current: T | null) => T | null,
): Promise<T | null> {
  return exclusive(`rim-relay:${store}`, async () => {
    const current = await getRecord<T>(store, key);
    const next = change(current);
    if (next !== null) await putRecord(store, next);
    return next ?? current;
  });
}
