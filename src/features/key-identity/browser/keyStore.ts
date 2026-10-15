/**
 * Where the web app keeps its keys: one IndexedDB record per account on a server (endpoint and
 * principal id), holding the device key and, on the browser that holds the identity, the
 * identity key, as non-extractable WebCrypto `CryptoKey`s (stored by structured clone, so their
 * secrets never exist as bytes in the page), the device id and name, and which account it signs
 * in to. A second store holds the device links this browser confirmed as the old device.
 */

import type { Sealed } from "./channel";
import type { Statement } from "./statements";

const DB_NAME = "rim-key-identity";
const DB_VERSION = 2;
const STORE = "deviceKeys";
const LINKS = "deviceLinks";

/** A private key and its tagged public key. */
export interface StoredKey {
  /** Ed25519; non-extractable. */
  privateKey: CryptoKey;
  /** `ed25519:<base64url>`. */
  publicKey: string;
}

/** One account's keys in this browser. */
export interface BrowserKeyRecord {
  v: 1;
  /** The GraphQL endpoint, trimmed and without a trailing `/`. */
  endpoint: string;
  principalId: string;
  deviceId: string;
  deviceName: string;
  /** The Ed25519 private key; non-extractable. */
  deviceKey: CryptoKey;
  /** The server has shown this principal on the account. */
  confirmed: boolean;
  /** Unknown right after linking, until the first sign-in. */
  userId: string | null;
  username: string | null;
  /** The identity key, on the browser that created or recovered the identity. */
  identity?: StoredKey;
  /**
   * A new identity key sent in a rotation the server has not confirmed yet, and the key log
   * seq that rotation creates.
   */
  pendingIdentity?: StoredKey & { seq: number };
  /** The recovery kit's 16 entropy bytes, kept only until the person confirms the kit is saved. */
  recoveryEntropy?: Uint8Array;
  /** Whether the person confirmed they saved the recovery kit; set where `identity` was created. */
  kitConfirmed?: boolean;
  /** The confirmed keys an unconfirmed recovery replaced, put back if the server refuses it. */
  replaced?: BrowserKeyRecord;
}

/**
 * A device link this browser confirmed as the old device, written before `addDeviceKey`: the
 * certificate and the sealed answer, resent byte for byte, and the device to revoke if nobody
 * used it. The link secret is not kept: the answer is already sealed.
 */
export interface BrowserPendingLink {
  v: 1;
  linkId: string;
  /** As `storedEndpoint` writes it. */
  endpoint: string;
  principalId: string;
  deviceId: string;
  deviceKey: string;
  certificate: Statement;
  answer: Sealed;
}

/** The endpoint as stored and compared: surrounding whitespace and trailing `/` dropped. */
export function storedEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

let opened: { factory: IDBFactory; db: Promise<IDBDatabase> } | null = null;

function database(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(new Error("this browser cannot store keys"));
  if (opened?.factory === factory) return opened.db;
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion < 1) {
        request.result.createObjectStore(STORE, { keyPath: ["endpoint", "principalId"] });
      }
      if (event.oldVersion < 2) request.result.createObjectStore(LINKS, { keyPath: "linkId" });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema gets the database; this one reopens on next use.
      db.onversionchange = () => {
        db.close();
        if (opened?.factory === factory) opened = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("the key store did not open"));
    request.onblocked = () => reject(new Error("the key store is blocked by another tab"));
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
    request.onerror = () => reject(request.error ?? new Error("key store request failed"));
  });
}

/** A write transaction that completes only once the browser says the data is on disk. */
async function writing(store: string): Promise<IDBTransaction> {
  return (await database()).transaction(store, "readwrite", { durability: "strict" });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("key store write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("key store write was aborted"));
  });
}

/** Every record, of every endpoint. */
async function allRecords(): Promise<BrowserKeyRecord[]> {
  const tx = (await database()).transaction(STORE, "readonly");
  return done(tx.objectStore(STORE).getAll() as IDBRequest<BrowserKeyRecord[]>);
}

/** The records on `endpoint`. */
export async function records(endpoint: string): Promise<BrowserKeyRecord[]> {
  const at = storedEndpoint(endpoint);
  return (await allRecords()).filter((r) => r.endpoint === at);
}

export async function record(
  endpoint: string,
  principalId: string,
): Promise<BrowserKeyRecord | null> {
  const tx = (await database()).transaction(STORE, "readonly");
  const found = await done(tx.objectStore(STORE).get([storedEndpoint(endpoint), principalId]));
  return (found as BrowserKeyRecord | undefined) ?? null;
}

/**
 * Read, change and write records in one transaction: `change` gets the records on `endpoint`
 * and returns those to write and the principal ids to delete there.
 */
export async function update(
  endpoint: string,
  change: (current: BrowserKeyRecord[]) => { put?: BrowserKeyRecord[]; remove?: string[] },
): Promise<void> {
  const at = storedEndpoint(endpoint);
  const tx = await writing(STORE);
  const finished = committed(tx);
  const store = tx.objectStore(STORE);
  const current = ((await done(store.getAll())) as BrowserKeyRecord[]).filter(
    (r) => r.endpoint === at,
  );
  const { put = [], remove = [] } = change(current);
  for (const r of put) store.put({ ...r, endpoint: at });
  for (const principalId of remove) store.delete([at, principalId]);
  await finished;
}

/** Store a new record unless one exists for its account; `false` when one does. */
export async function insert(record: BrowserKeyRecord): Promise<boolean> {
  let inserted = false;
  await update(record.endpoint, (current) => {
    if (current.some((r) => r.principalId === record.principalId)) return {};
    inserted = true;
    return { put: [record] };
  });
  return inserted;
}

/** Delete the records of `principalId` (on every endpoint) that `which` selects. */
export async function removeWhere(
  principalId: string,
  which: (record: BrowserKeyRecord) => boolean = () => true,
): Promise<void> {
  const tx = await writing(STORE);
  const finished = committed(tx);
  const store = tx.objectStore(STORE);
  for (const r of (await done(store.getAll())) as BrowserKeyRecord[]) {
    if (r.principalId === principalId && which(r)) store.delete([r.endpoint, r.principalId]);
  }
  await finished;
}

/** Change the records of `principalId` (on every endpoint) in one transaction. */
export async function updatePrincipal(
  principalId: string,
  change: (record: BrowserKeyRecord) => BrowserKeyRecord | null | undefined,
): Promise<void> {
  const tx = await writing(STORE);
  const finished = committed(tx);
  const store = tx.objectStore(STORE);
  for (const r of (await done(store.getAll())) as BrowserKeyRecord[]) {
    if (r.principalId !== principalId) continue;
    const next = change(r);
    if (next === null) store.delete([r.endpoint, r.principalId]);
    else if (next !== undefined) store.put(next);
  }
  await finished;
}

/** Every record of `principalId`, on any endpoint. */
export async function principalRecords(principalId: string): Promise<BrowserKeyRecord[]> {
  return (await allRecords()).filter((r) => r.principalId === principalId);
}

// ─── Pending device links ───────────────────────────────────────────────────

/** The pending device links this browser confirmed as the old device. */
export async function pendingLinks(): Promise<BrowserPendingLink[]> {
  const tx = (await database()).transaction(LINKS, "readonly");
  return done(tx.objectStore(LINKS).getAll() as IDBRequest<BrowserPendingLink[]>);
}

export async function putPendingLink(link: BrowserPendingLink): Promise<void> {
  const tx = await writing(LINKS);
  const finished = committed(tx);
  tx.objectStore(LINKS).put(link);
  await finished;
}

/** Deleting what is not there is not an error. */
export async function deletePendingLink(linkId: string): Promise<void> {
  const tx = await writing(LINKS);
  const finished = committed(tx);
  tx.objectStore(LINKS).delete(linkId);
  await finished;
}
