/**
 * The web app's encrypted store: one IndexedDB database, `rim-e2ee`, every record keyed by the
 * account first (`endpoint`, `principalId`).
 *
 * - `mls`: the MLS state entries `rim_mls` keeps (OpenMLS state, the MLS signature key, HPKE
 *   private keys), `[endpoint, principalId, label, key]`, key and value base64url.
 * - `messages`: the conversation's messages as this browser can show them: decrypted plaintext,
 *   placeholders, messages that could not be verified, messages being sent, and the plaintext
 *   rows of an encrypted conversation from before it was encrypted.
 * - `groups`: per conversation, the group this browser holds (incarnation, join epoch, removal,
 *   leaves to verify, devices that failed, a re-add wait, resets, re-adds honored).
 * - `sync`: per conversation, the change feed's cursor and whether more is pending.
 * - `outgoing`: messages and edits until the server acknowledges them.
 * - `devices`: devices whose certificate verified, with the certified key.
 * - `accounts`: when this browser last used the account, and this device's public key.
 * - `pins`: conversations this browser knows are encrypted, kept whatever the server says
 *   later and when their group state goes; a direct message's two principals.
 * - `peers`: per principal, the head of the longest key log verified here and the devices seen
 *   revoked.
 *
 * Every record is sealed under the account's data key (the account vault): its key fields and
 * the messages' index fields (conversation, thread, time) stay plain, the rest is sealed in one
 * `data` field. A record that does not open under the unlocked account reads as absent.
 */

import {
  openRecord,
  openRecords,
  sealRecord,
  type SealedStore,
} from "../../../core/accountVault/sealedRecords";

export const DB_NAME = "rim-e2ee";
const DB_VERSION = 3;

export type StoreName =
  "mls" | "messages" | "groups" | "sync" | "outgoing" | "devices" | "accounts" | "pins" | "peers";

/** Each store's key path. */
export const KEY_PATHS: Record<StoreName, string[]> = {
  mls: ["endpoint", "principalId", "label", "key"],
  messages: ["endpoint", "principalId", "id"],
  groups: ["endpoint", "principalId", "workspaceId", "conversationId"],
  sync: ["endpoint", "principalId", "workspaceId", "conversationId"],
  outgoing: ["endpoint", "principalId", "messageId"],
  devices: ["endpoint", "principalId", "peerPrincipalId", "deviceId"],
  accounts: ["endpoint", "principalId"],
  pins: ["endpoint", "principalId", "workspaceId", "conversationId"],
  peers: ["endpoint", "principalId", "peerPrincipalId"],
};

/** Index of the timeline: a conversation's messages by `(sentAtUs, id)`. */
export const BY_TIME = "byTime";
/** Index of threads: a thread's replies by `(sentAtUs, id)`; rows outside threads are not in it. */
export const BY_THREAD = "byThread";
/** Index of every record of one account. */
export const BY_ACCOUNT = "byAccount";

/** The fields each store keeps plain: its key, and what its indexes read. */
const PLAIN: Record<StoreName, string[]> = {
  ...KEY_PATHS,
  messages: [...KEY_PATHS.messages, "workspaceId", "conversationId", "threadId", "sentAtUs"],
};

/** Where `store`'s sealed records live. */
export function sealedStore(store: StoreName): SealedStore {
  return { db: DB_NAME, store, keyPath: KEY_PATHS[store], plain: PLAIN[store] };
}

/**
 * The record as `store` keeps it, sealed.
 *
 * @throws VaultLockedError while the vault is locked.
 */
export function seal(store: StoreName, record: object): Promise<Record<string, unknown>> {
  return sealRecord(sealedStore(store), record);
}

/** The record a stored one of `store` holds, or `undefined` when there is none or it does not open. */
export async function unseal<T>(store: StoreName, stored: unknown): Promise<T | undefined> {
  if (stored === undefined) return undefined;
  return (await openRecord<T>(sealedStore(store), stored)) ?? undefined;
}

/** The records of `store` that open, of those stored, in order. */
export function unsealAll<T>(store: StoreName, stored: unknown[]): Promise<T[]> {
  return openRecords<T>(sealedStore(store), stored);
}

/** The record of `store` under `key`, opened; `undefined` when there is none or it does not open. */
export async function readRecord<T>(
  db: IDBDatabase,
  store: StoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  const tx = db.transaction(store, "readonly");
  return unseal<T>(store, await done(tx.objectStore(store).get(key)));
}

/** The records of `store` from `index` within `range`, opened. */
export async function readIndex<T>(
  db: IDBDatabase,
  store: StoreName,
  index: string,
  range: IDBKeyRange,
): Promise<T[]> {
  const tx = db.transaction(store, "readonly");
  return unsealAll<T>(store, await done(tx.objectStore(store).index(index).getAll(range)));
}

let opened: { factory: IDBFactory; db: Promise<IDBDatabase> } | null = null;

/**
 * Create the stores a database of an older version lacks, and empty those it wrote unsealed.
 */
function upgrade(db: IDBDatabase, tx: IDBTransaction | null, oldVersion: number) {
  const stores = new Map<string, IDBObjectStore>();
  for (const [name, keyPath] of Object.entries(KEY_PATHS)) {
    if (db.objectStoreNames.contains(name)) {
      if (oldVersion < 3) tx?.objectStore(name).clear();
      continue;
    }
    const store = db.createObjectStore(name, { keyPath });
    store.createIndex(BY_ACCOUNT, ["endpoint", "principalId"]);
    stores.set(name, store);
  }
  const messages = stores.get("messages");
  const conversation = ["endpoint", "principalId", "workspaceId", "conversationId"];
  messages?.createIndex(BY_TIME, [...conversation, "sentAtUs", "id"]);
  messages?.createIndex(BY_THREAD, [...conversation, "threadId", "sentAtUs", "id"]);
}

/** The database, opened once per page. */
export function database(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(new Error("this browser has no IndexedDB"));
  if (opened?.factory === factory) return opened.db;
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) =>
      upgrade(request.result, request.transaction, event.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (opened?.factory === factory) opened = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("the encrypted store did not open"));
    request.onblocked = () => reject(new Error("the encrypted store is blocked by another tab"));
  });
  opened = { factory, db };
  db.catch(() => {
    if (opened?.db === db) opened = null;
  });
  return db;
}

export function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("encrypted store request failed"));
  });
}

export function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("encrypted store write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("encrypted store write was aborted"));
  });
}

/**
 * Delete every record of the account (`endpoint`, `principalId`) from every store, in one
 * transaction.
 *
 * @param endpoint - The endpoint as the store keeps it, as `storedEndpoint` writes it.
 */
export async function deleteAccount(endpoint: string, principalId: string): Promise<void> {
  const names = Object.keys(KEY_PATHS) as StoreName[];
  const tx = (await database()).transaction(names, "readwrite");
  const finished = committed(tx);
  const account = IDBKeyRange.only([endpoint, principalId]);
  await Promise.all(
    names.map(async (name) => {
      const store = tx.objectStore(name);
      for (const key of await done(store.index(BY_ACCOUNT).getAllKeys(account))) {
        store.delete(key);
      }
    }),
  );
  await finished;
}

/** The key of a record of `store`, from its key path. */
export function keyOf(store: StoreName, value: Record<string, unknown>): IDBValidKey {
  return KEY_PATHS[store].map((field) => value[field] as IDBValidKey);
}

/** A key as text, to find pending writes by key. */
export function keyText(key: IDBValidKey): string {
  return JSON.stringify(key);
}
