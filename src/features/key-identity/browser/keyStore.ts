/**
 * Where the web app keeps its device keys: one IndexedDB record per account on a server
 * (endpoint and principal id), holding the device key as a non-extractable WebCrypto
 * `CryptoKey` (stored by structured clone, so its secret never exists as bytes in the page),
 * the device id and name, and which account it signs in to.
 */

const DB_NAME = "rim-key-identity";
const DB_VERSION = 1;
const STORE = "deviceKeys";

/** One account's device key in this browser. */
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
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: ["endpoint", "principalId"] });
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
  const tx = (await database()).transaction(STORE, "readwrite");
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
  const tx = (await database()).transaction(STORE, "readwrite");
  const finished = committed(tx);
  const store = tx.objectStore(STORE);
  for (const r of (await done(store.getAll())) as BrowserKeyRecord[]) {
    if (r.principalId === principalId && which(r)) store.delete([r.endpoint, r.principalId]);
  }
  await finished;
}
