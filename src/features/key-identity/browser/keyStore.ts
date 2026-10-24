/**
 * Where the web app keeps its keys: IndexedDB `rim-key-identity`, one record per account on a
 * server (endpoint and principal id) in `deviceKeys`, the device links this browser confirmed as
 * the old device in `deviceLinks`, and the wraps of each account's data key in `dataKeys`
 * (`core/accountVault/dkWraps`).
 *
 * A record's keys are sealed under the account's data key (the account vault): the device key,
 * the identity key, a pending one, the recovery kit's entropy and the keys a recovery replaced
 * go into one sealed `data` field, each private key wrapped as pkcs8 and unwrapped as a
 * non-extractable `CryptoKey`. What names the keys stays plain, for the sign-in list: the
 * endpoint, principal, device id and name, user id and name, and whether the server and the
 * person confirmed them. The record also holds `deviceWrap`, the device key's seed wrapped under
 * a key of the server share, so a new data key does not lose the device key.
 *
 * A record written before the account's first unlock in this browser (a signup, a recovery, a
 * newly linked device) keeps its keys unsealed, as extractable `CryptoKey`s, until that unlock
 * seals it. While the account is locked, a sealed record reads with its keys absent and is
 * written back with its sealed field unchanged. A pending device link is sealed whole, but for
 * what finds it, and is written only while its account is unlocked.
 */

import {
  isSealed,
  openValue,
  sealValue,
  unwrapCryptoKey,
  vaultAccount,
  vaultHolds,
  VaultLockedError,
  wrapCryptoKey,
  type SealedValue,
} from "../../../core/accountVault/accountVault";
import {
  openRecord,
  recordAad,
  sealRecord,
  type SealedStore,
} from "../../../core/accountVault/sealedRecords";
import { b64, unb64 } from "./bytes";
import type { Sealed } from "./channel";
import { exclusive } from "./persistence";
import type { Statement } from "./statements";

export const DB_NAME = "rim-key-identity";
const DB_VERSION = 3;
const STORE = "deviceKeys";
const LINKS = "deviceLinks";
/** The store of the data key wraps, keyed `[endpoint, principalId]`. */
export const DATA_KEYS = "dataKeys";

/** A private key and its tagged public key. */
export interface StoredKey {
  /** Ed25519; extractable until the record is sealed, non-extractable once unwrapped. */
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
  /** The Ed25519 private key; `null` while the account is locked, or once lost. */
  deviceKey: CryptoKey | null;
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
  /**
   * The sealed keys of a record read while its account is locked: the keys above read as
   * absent, and the record is written back with these unchanged.
   */
  locked?: SealedValue;
  /** base64url of the device key's seed wrapped under the server share's device key wrap key. */
  deviceWrap?: string;
  /** Its keys were opened from a sealed record: they are written back only sealed. */
  fromSealed?: true;
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

/** A record as `deviceKeys` holds it. */
interface StoredRecord {
  v: 1;
  endpoint: string;
  principalId: string;
  deviceId: string;
  deviceName: string;
  confirmed: boolean;
  userId: string | null;
  username: string | null;
  kitConfirmed?: boolean;
  /** The sealed {@link SecretFields}. */
  data?: SealedValue;
  deviceWrap?: string;
  // Before the first unlock: the keys as they are.
  deviceKey?: CryptoKey;
  identity?: StoredKey;
  pendingIdentity?: StoredKey & { seq: number };
  recoveryEntropy?: Uint8Array;
  replaced?: StoredRecord;
}

/** The sealed part of a record, as JSON: each private key wrapped on its own. */
interface SecretFields {
  deviceKey?: SealedValue;
  identity?: { key: SealedValue; publicKey: string };
  pendingIdentity?: { key: SealedValue; publicKey: string; seq: number };
  recoveryEntropy?: string;
  replaced?: SecretRecord;
}

/** A replaced record inside the sealed part: its plain fields and its secret ones. */
interface SecretRecord {
  plain: Omit<StoredRecord, "data" | "deviceWrap" | "replaced">;
  secret: SecretFields;
}

/** The endpoint as stored and compared: surrounding whitespace and trailing `/` dropped. */
export function storedEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

let opened: { factory: IDBFactory; db: Promise<IDBDatabase> } | null = null;

/**
 * The key store's database, opened once per page. Opening it empties the stores of a version
 * whose keys were not sealed.
 */
export function keyIdentityDatabase(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.reject(new Error("this browser cannot store keys"));
  if (opened?.factory === factory) return opened.db;
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        db.createObjectStore(STORE, { keyPath: ["endpoint", "principalId"] });
      }
      if (event.oldVersion < 2) db.createObjectStore(LINKS, { keyPath: "linkId" });
      if (event.oldVersion < 3) {
        db.createObjectStore(DATA_KEYS, { keyPath: ["endpoint", "principalId"] });
        if (event.oldVersion >= 1) request.transaction?.objectStore(STORE).clear();
        if (event.oldVersion >= 2) request.transaction?.objectStore(LINKS).clear();
      }
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

/** The result of `request`, once it succeeds. */
export function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("key store request failed"));
  });
}

/** A write transaction that completes only once the browser says the data is on disk. */
export async function writing(store: string): Promise<IDBTransaction> {
  return (await keyIdentityDatabase()).transaction(store, "readwrite", { durability: "strict" });
}

/** Settles when `tx` completes, or rejects when it fails. */
export function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("key store write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("key store write was aborted"));
  });
}

// ─── Sealing a record ───────────────────────────────────────────────────────

function aadOf(endpoint: string, principalId: string): string {
  return recordAad(DB_NAME, STORE, [endpoint, principalId]);
}

function plainOf(r: BrowserKeyRecord | StoredRecord): SecretRecord["plain"] {
  return {
    v: 1,
    endpoint: r.endpoint,
    principalId: r.principalId,
    deviceId: r.deviceId,
    deviceName: r.deviceName,
    confirmed: r.confirmed,
    userId: r.userId,
    username: r.username,
    ...(r.kitConfirmed !== undefined && { kitConfirmed: r.kitConfirmed }),
  };
}

function hasSecrets(r: BrowserKeyRecord): boolean {
  return Boolean(r.deviceKey || r.identity || r.pendingIdentity || r.recoveryEntropy || r.replaced);
}

async function secretsOf(r: BrowserKeyRecord, aad: string): Promise<SecretFields> {
  const out: SecretFields = {};
  if (r.deviceKey) out.deviceKey = await wrapCryptoKey(r.deviceKey, aad);
  if (r.identity) {
    out.identity = {
      key: await wrapCryptoKey(r.identity.privateKey, aad),
      publicKey: r.identity.publicKey,
    };
  }
  if (r.pendingIdentity) {
    out.pendingIdentity = {
      key: await wrapCryptoKey(r.pendingIdentity.privateKey, aad),
      publicKey: r.pendingIdentity.publicKey,
      seq: r.pendingIdentity.seq,
    };
  }
  if (r.recoveryEntropy) out.recoveryEntropy = b64(r.recoveryEntropy);
  if (r.replaced) {
    out.replaced = { plain: plainOf(r.replaced), secret: await secretsOf(r.replaced, aad) };
  }
  return out;
}

async function storedKeyOf(
  sealed: { key: SealedValue; publicKey: string },
  aad: string,
): Promise<StoredKey | null> {
  const privateKey = await unwrapCryptoKey(sealed.key, aad, ["sign"]);
  return privateKey ? { privateKey, publicKey: sealed.publicKey } : null;
}

/** The record of `plain` with `secret` opened; keys that do not open are left out. */
async function withSecrets(
  plain: SecretRecord["plain"],
  secret: SecretFields,
  aad: string,
): Promise<BrowserKeyRecord> {
  const record: BrowserKeyRecord = { ...plain, deviceKey: null, fromSealed: true };
  if (secret.deviceKey) record.deviceKey = await unwrapCryptoKey(secret.deviceKey, aad, ["sign"]);
  const identity = secret.identity && (await storedKeyOf(secret.identity, aad));
  if (identity) record.identity = identity;
  const pending = secret.pendingIdentity && (await storedKeyOf(secret.pendingIdentity, aad));
  if (pending && secret.pendingIdentity) {
    record.pendingIdentity = { ...pending, seq: secret.pendingIdentity.seq };
  }
  const entropy = secret.recoveryEntropy ? unb64(secret.recoveryEntropy) : null;
  if (entropy) record.recoveryEntropy = entropy;
  if (secret.replaced) {
    record.replaced = await withSecrets(secret.replaced.plain, secret.replaced.secret, aad);
  }
  return record;
}

function unsealed(stored: StoredRecord): BrowserKeyRecord {
  const record: BrowserKeyRecord = { ...plainOf(stored), deviceKey: stored.deviceKey ?? null };
  if (stored.identity) record.identity = stored.identity;
  if (stored.pendingIdentity) record.pendingIdentity = stored.pendingIdentity;
  if (stored.recoveryEntropy) record.recoveryEntropy = stored.recoveryEntropy;
  if (stored.replaced) record.replaced = unsealed(stored.replaced);
  return record;
}

/**
 * A stored record as the key backend reads it: sealed keys opened while the vault holds its
 * account, absent (with `locked` set) while it does not, and lost when sealed under another data
 * key; unsealed keys as they are.
 */
async function fromStored(raw: unknown): Promise<BrowserKeyRecord> {
  const stored = raw as StoredRecord;
  let record: BrowserKeyRecord;
  if (!isSealed(stored.data)) {
    record = unsealed(stored);
  } else if (!vaultHolds(stored.endpoint, stored.principalId)) {
    record = { ...plainOf(stored), deviceKey: null, locked: stored.data };
  } else {
    const aad = aadOf(stored.endpoint, stored.principalId);
    const secret = await openValue<SecretFields>(stored.data, aad);
    record = secret
      ? await withSecrets(plainOf(stored), secret, aad)
      : { ...plainOf(stored), deviceKey: null };
  }
  if (stored.deviceWrap) record.deviceWrap = stored.deviceWrap;
  return record;
}

function rawUnsealed(r: BrowserKeyRecord): StoredRecord {
  const stored: StoredRecord = plainOf(r);
  if (r.deviceKey) stored.deviceKey = r.deviceKey;
  if (r.identity) stored.identity = r.identity;
  if (r.pendingIdentity) stored.pendingIdentity = r.pendingIdentity;
  if (r.recoveryEntropy) stored.recoveryEntropy = r.recoveryEntropy;
  if (r.replaced) stored.replaced = rawUnsealed(r.replaced);
  return stored;
}

function openedFromSealed(r: BrowserKeyRecord): boolean {
  return r.fromSealed === true || (r.replaced !== undefined && openedFromSealed(r.replaced));
}

/**
 * A record as `deviceKeys` stores it: sealed while the vault holds its account, its sealed field
 * unchanged when it was read locked, its keys as they are before the first unlock.
 *
 * @throws VaultLockedError for a record read locked that was given keys, or keys opened from a
 *   sealed record once the vault no longer holds their account.
 */
async function toStored(r: BrowserKeyRecord): Promise<StoredRecord> {
  let stored: StoredRecord;
  if (r.locked) {
    if (hasSecrets(r)) throw new VaultLockedError();
    stored = { ...plainOf(r), data: r.locked };
  } else if (hasSecrets(r) && vaultHolds(r.endpoint, r.principalId)) {
    const aad = aadOf(r.endpoint, r.principalId);
    stored = { ...plainOf(r), data: await sealValue(await secretsOf(r, aad), aad) };
  } else if (hasSecrets(r) && openedFromSealed(r)) {
    throw new VaultLockedError();
  } else {
    stored = rawUnsealed(r);
  }
  if (r.deviceWrap) stored.deviceWrap = r.deviceWrap;
  return stored;
}

// ─── Records ────────────────────────────────────────────────────────────────

async function rawRecords(): Promise<unknown[]> {
  const tx = (await keyIdentityDatabase()).transaction(STORE, "readonly");
  return done(tx.objectStore(STORE).getAll());
}

/** Every record, of every endpoint. */
async function allRecords(): Promise<BrowserKeyRecord[]> {
  return Promise.all((await rawRecords()).map(fromStored));
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
  const tx = (await keyIdentityDatabase()).transaction(STORE, "readonly");
  const found: unknown = await done(
    tx.objectStore(STORE).get([storedEndpoint(endpoint), principalId]),
  );
  return found ? fromStored(found) : null;
}

/** The record of an account as stored, sealed or not; `null` when there is none. */
export async function storedRecord(endpoint: string, principalId: string): Promise<unknown> {
  const tx = (await keyIdentityDatabase()).transaction(STORE, "readonly");
  return (await done(tx.objectStore(STORE).get([storedEndpoint(endpoint), principalId]))) ?? null;
}

/**
 * Write what `change` decided about the records it was given, in one transaction, after the
 * records to put are sealed.
 */
async function apply(put: BrowserKeyRecord[], remove: IDBValidKey[]): Promise<void> {
  const stored = await Promise.all(put.map(toStored));
  const tx = await writing(STORE);
  const finished = committed(tx);
  const store = tx.objectStore(STORE);
  for (const r of stored) store.put(r);
  for (const key of remove) store.delete(key);
  await finished;
}

/**
 * Read, change and write records: `change` gets the records on `endpoint` and returns those to
 * write and the principal ids to delete there. Changes of records run one at a time across this
 * origin's tabs.
 */
export function update(
  endpoint: string,
  change: (current: BrowserKeyRecord[]) => { put?: BrowserKeyRecord[]; remove?: string[] },
): Promise<void> {
  const at = storedEndpoint(endpoint);
  return exclusive("rim-key-identity-records", async () => {
    const current = (await allRecords()).filter((r) => r.endpoint === at);
    const { put = [], remove = [] } = change(current);
    await apply(
      put.map((r) => ({ ...r, endpoint: at })),
      remove.map((principalId) => [at, principalId]),
    );
  });
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
export function removeWhere(
  principalId: string,
  which: (record: BrowserKeyRecord) => boolean = () => true,
): Promise<void> {
  return updatePrincipal(principalId, (r) => (which(r) ? null : undefined));
}

/** Change the records of `principalId` (on every endpoint), one change of records at a time. */
export function updatePrincipal(
  principalId: string,
  change: (record: BrowserKeyRecord) => BrowserKeyRecord | null | undefined,
): Promise<void> {
  return exclusive("rim-key-identity-records", async () => {
    const put: BrowserKeyRecord[] = [];
    const remove: IDBValidKey[] = [];
    for (const r of await allRecords()) {
      if (r.principalId !== principalId) continue;
      const next = change(r);
      if (next === null) remove.push([r.endpoint, r.principalId]);
      else if (next !== undefined) put.push(next);
    }
    await apply(put, remove);
  });
}

/**
 * Change one record, one change of records at a time: `change` gets the record as read and as
 * stored, and returns the record to write, or `undefined` to leave it.
 */
export function changeRecord(
  endpoint: string,
  principalId: string,
  change: (record: BrowserKeyRecord, stored: unknown) => Promise<BrowserKeyRecord | undefined>,
): Promise<void> {
  return exclusive("rim-key-identity-records", async () => {
    const stored = await storedRecord(endpoint, principalId);
    if (!stored) return;
    const next = await change(await fromStored(stored), stored);
    if (next) await apply([next], []);
  });
}

/** Whether a record holds keys outside a sealed field. */
export function holdsUnsealedKeys(r: BrowserKeyRecord, stored: unknown): boolean {
  return !isSealed((stored as StoredRecord).data) && hasSecrets(r);
}

/** Whether a stored record is sealed. */
export function isSealedRecord(stored: unknown): boolean {
  return isSealed((stored as StoredRecord).data);
}

/** Every record of `principalId`, on any endpoint. */
export async function principalRecords(principalId: string): Promise<BrowserKeyRecord[]> {
  return (await allRecords()).filter((r) => r.principalId === principalId);
}

/**
 * The record's device key, to sign with.
 *
 * @throws VaultLockedError while the account is locked; Error when the key is lost.
 */
export function signingKey(r: BrowserKeyRecord): CryptoKey {
  if (r.deviceKey) return r.deviceKey;
  if (r.locked) throw new VaultLockedError();
  throw new Error("this browser lost the device key of that account: recover or link it again");
}

// ─── Pending device links ───────────────────────────────────────────────────

const LINK_RECORDS: SealedStore = {
  db: DB_NAME,
  store: LINKS,
  keyPath: "linkId",
  plain: ["v", "linkId", "endpoint", "principalId", "deviceId", "deviceKey"],
};

/** The pending device links this browser confirmed as the old device, of the unlocked account. */
export async function pendingLinks(): Promise<BrowserPendingLink[]> {
  const principalId = vaultAccount()?.principalId;
  if (!principalId) return [];
  const tx = (await keyIdentityDatabase()).transaction(LINKS, "readonly");
  const stored = (await done(tx.objectStore(LINKS).getAll())) as BrowserPendingLink[];
  const out: BrowserPendingLink[] = [];
  for (const raw of stored.filter((s) => s.principalId === principalId)) {
    const link = await openRecord<BrowserPendingLink>(LINK_RECORDS, raw);
    if (link) out.push(link);
  }
  return out;
}

/**
 * Write a pending link, sealed under its account's data key.
 *
 * @throws VaultLockedError unless its account is unlocked.
 */
export async function putPendingLink(link: BrowserPendingLink): Promise<void> {
  if (vaultAccount()?.principalId !== link.principalId) throw new VaultLockedError();
  const sealed = await sealRecord(LINK_RECORDS, link);
  const tx = await writing(LINKS);
  const finished = committed(tx);
  tx.objectStore(LINKS).put(sealed);
  await finished;
}

/** Deleting what is not there is not an error. */
export async function deletePendingLink(linkId: string): Promise<void> {
  const tx = await writing(LINKS);
  const finished = committed(tx);
  tx.objectStore(LINKS).delete(linkId);
  await finished;
}
