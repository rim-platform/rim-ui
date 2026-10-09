/**
 * Device keys of the web app, a linked device (`rim-server/docs/specs/device-linking-v1.md`,
 * "Web client"): an Ed25519 key made by WebCrypto as **non-extractable** and kept in IndexedDB,
 * one per account and server. Script on the page can have it sign while the page is open, but
 * cannot read it out. The desktop keeps its keys on the Tauri side instead.
 *
 * A key is made when this browser joins an account through a device link and held in memory
 * until the answer arrives; it is stored only once the answer's certificate names this device's
 * id and key. Unlike the desktop, the web app does not replay the account's key log: its code
 * comes from the server it joins through, so a check in that code could not protect it from
 * that server (the spec's web client amendment).
 */

import type { SignedStatementInput } from "../../../core/graphql/generated/schema-types";
import { detectOs } from "../../../core/runtime/runtime";
import {
  audienceOf,
  b64url,
  fingerprint,
  offerJson,
  open,
  openChannel,
  parseLinkCode,
  readAnswer,
  sameEndpoint,
  seal,
  uuidV7,
  type Channel,
  type SealedMessage,
} from "./linkChannel";

const ED25519 = { name: "Ed25519" } as const;
const ED25519_TAG = "ed25519:";
const LOGIN_CONTEXT = "rim.login.v1\0";
const PRINCIPAL_RE = /^rimp1_[A-Za-z0-9_-]{43}$/;

/** A key this browser holds for an account on a server. */
export interface BrowserKeyRecord {
  /** `<audience> <principalId>`. */
  id: string;
  endpoint: string;
  principalId: string;
  deviceId: string;
  deviceName: string;
  /** Tagged public key. */
  deviceKey: string;
  /** Non-extractable: signs, never leaves. */
  privateKey: CryptoKey;
  userId: string | null;
  username: string | null;
}

/** Where records live: IndexedDB in the app, memory in tests. */
export interface BrowserKeyStore {
  all(): Promise<BrowserKeyRecord[]>;
  put(record: BrowserKeyRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB_NAME = "rim-device-keys";
const STORE = "keys";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

class IndexedDbKeyStore implements BrowserKeyStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        this.db = null;
        reject(req.error ?? new Error("Could not open the key store"));
      };
    });
    return this.db;
  }

  async all(): Promise<BrowserKeyRecord[]> {
    const store = (await this.open()).transaction(STORE, "readonly").objectStore(STORE);
    return request(store.getAll() as IDBRequest<BrowserKeyRecord[]>);
  }

  /**
   * Resolves once the transaction commits, not when its request succeeds: a transaction can
   * still abort after that (a full disk), and a key must not be reported stored when it is not.
   */
  private async write(change: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    const tx = (await this.open()).transaction(STORE, "readwrite");
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("Could not save the key"));
      tx.onerror = () => reject(tx.error ?? new Error("Could not save the key"));
    });
    change(tx.objectStore(STORE));
    await done;
  }

  put(record: BrowserKeyRecord): Promise<void> {
    return this.write((store) => store.put(record));
  }

  remove(id: string): Promise<void> {
    return this.write((store) => store.delete(id));
  }
}

/** A store in memory, for tests. */
export class MemoryKeyStore implements BrowserKeyStore {
  records = new Map<string, BrowserKeyRecord>();
  all() {
    return Promise.resolve([...this.records.values()]);
  }
  put(record: BrowserKeyRecord) {
    this.records.set(record.id, record);
    return Promise.resolve();
  }
  remove(id: string) {
    this.records.delete(id);
    return Promise.resolve();
  }
}

let keyStore: BrowserKeyStore | null = null;

function store(): BrowserKeyStore {
  keyStore ??= new IndexedDbKeyStore();
  return keyStore;
}

/** Replace the store (tests). */
export function setBrowserKeyStore(next: BrowserKeyStore): void {
  keyStore = next;
}

/**
 * Records are keyed by the server's audience (`host[:port]`), as login proofs name it, so http and
 * https, or two API paths on one host, share a record. That is the audience rule, and fine for v1.
 */
function recordId(endpoint: string, principalId: string): string {
  return `${audienceOf(endpoint)} ${principalId}`;
}

// ─── Support ────────────────────────────────────────────────────────────────

let support: Promise<boolean> | null = null;

/** Whether this browser makes Ed25519 keys and can store them (older browsers cannot). */
export function browserKeysSupported(): Promise<boolean> {
  support ??= (async () => {
    if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) return false;
    try {
      await crypto.subtle.generateKey(ED25519, false, ["sign", "verify"]);
      return true;
    } catch {
      return false;
    }
  })();
  return support;
}

/** "Firefox on Linux", as the default name of this browser as a device. */
export function browserDeviceName(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = { macos: "macOS", windows: "Windows", linux: "Linux", unknown: "" }[detectOs()];
  return os ? `${browser} on ${os}` : browser;
}

/** A device name as certificates allow it: trimmed, 1 to 64 characters, no control characters. */
export function deviceName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = Array.from(name.trim().replace(/[\u0000-\u001f\u007f-\u009f]/g, ""))
    .slice(0, 64)
    .join("")
    .trim();
  if (!clean) throw new Error("Give this device a name.");
  return clean;
}

// ─── Joining an account ─────────────────────────────────────────────────────

/** A started join: the sealed offer to send and the fingerprint to show. */
export interface JoinStarted {
  linkId: string;
  offer: SealedMessage;
  fingerprint: string;
}

interface BrowserJoin {
  endpoint: string;
  channel: Channel;
  deviceId: string;
  deviceKey: string;
  deviceName: string;
  privateKey: CryptoKey;
}

const joins = new Map<string, BrowserJoin>();

/**
 * Read a pasted or scanned code for `endpoint` (this app's server), make this browser's key in
 * memory, and seal the offer.
 */
export async function beginBrowserJoin(
  code: string,
  endpoint: string,
  name: string,
): Promise<JoinStarted> {
  const link = parseLinkCode(code);
  if (!sameEndpoint(link.endpoint, endpoint)) {
    throw new Error(
      `This code is for the server at ${link.endpoint}, and this app uses ` +
        `${endpoint.replace(/\/+$/, "")}. Make the code on a device signed in to the same server.`,
    );
  }
  const clean = deviceName(name);
  const pair = (await crypto.subtle.generateKey(ED25519, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const join: BrowserJoin = {
    endpoint: link.endpoint,
    channel: await openChannel(link),
    deviceId: uuidV7(),
    deviceKey: ED25519_TAG + b64url(raw),
    deviceName: clean,
    privateKey: pair.privateKey,
  };
  const plaintext = offerJson({
    deviceId: join.deviceId,
    deviceKey: join.deviceKey,
    name: clean,
    platform: "web",
  });
  const offer = await seal(join.channel, "offer", plaintext);
  joins.set(link.linkId, join);
  return { linkId: link.linkId, offer, fingerprint: await fingerprint(plaintext) };
}

/** A device key as a certificate of `version` spells it, in tagged form. */
function taggedKey(key: unknown, version: unknown): string | null {
  if (typeof key !== "string") return null;
  if (version === 1) return ED25519_TAG + key;
  return version === 2 ? key : null;
}

/**
 * Open the answer and store this browser's key for the account its certificate names. The
 * certificate must name this device's id and key; anything else is refused and nothing is
 * stored. Returns the account's principal id.
 */
export async function acceptBrowserJoin(linkId: string, answer: SealedMessage): Promise<string> {
  const join = joins.get(linkId);
  if (!join) throw new Error("This link was cancelled or already finished; start again.");
  const notForUs = new Error("The answer is not for this device; start again.");
  const plaintext = await open(join.channel, "answer", answer);
  const certificate = plaintext === null ? null : readAnswer(plaintext);
  if (!certificate) throw notForUs;
  let cert: Record<string, unknown>;
  try {
    cert = JSON.parse(certificate.payload) as Record<string, unknown>;
  } catch {
    throw notForUs;
  }
  const principalId = cert.principalId;
  if (
    cert.type !== "device" ||
    typeof principalId !== "string" ||
    !PRINCIPAL_RE.test(principalId) ||
    cert.deviceId !== join.deviceId ||
    taggedKey(cert.deviceKey, cert.v) !== join.deviceKey
  ) {
    throw notForUs;
  }
  const id = recordId(join.endpoint, principalId);
  if ((await store().all()).some((r) => r.id === id)) {
    throw new Error(
      "This browser already holds a key for that account. Sign in with it from the sign-in screen.",
    );
  }
  let name = join.deviceName;
  try {
    name = deviceName(typeof cert.name === "string" ? cert.name : "");
  } catch {
    // The offered name stays.
  }
  await store().put({
    id,
    endpoint: join.endpoint,
    principalId,
    deviceId: join.deviceId,
    deviceName: name,
    deviceKey: join.deviceKey,
    privateKey: join.privateKey,
    userId: null,
    username: null,
  });
  joins.delete(linkId);
  return principalId;
}

/** Drop a join that ended; nothing of it was stored. */
export function discardBrowserJoin(linkId: string): void {
  joins.delete(linkId);
}

// ─── Accounts and sign-in ───────────────────────────────────────────────────

/** An account this browser holds a key for, in the desktop's shape. */
export interface BrowserAccount {
  principalId: string;
  userId: string | null;
  username: string | null;
  deviceId: string;
  deviceName: string;
  hasIdentityKey: false;
  confirmed: boolean;
}

function account(record: BrowserKeyRecord): BrowserAccount {
  return {
    principalId: record.principalId,
    userId: record.userId,
    username: record.username,
    deviceId: record.deviceId,
    deviceName: record.deviceName,
    hasIdentityKey: false,
    confirmed: record.userId !== null,
  };
}

async function recordsFor(endpoint: string): Promise<BrowserKeyRecord[]> {
  const audience = audienceOf(endpoint);
  return (await store().all()).filter((r) => r.id.startsWith(`${audience} `));
}

export async function browserAccounts(endpoint: string): Promise<BrowserAccount[]> {
  return (await recordsFor(endpoint)).map(account);
}

/** Sign a login proof (statement version 2) with this browser's key for `principalId`. */
export async function signBrowserLogin(
  endpoint: string,
  principalId: string,
  challenge: { challengeId: string; nonce: string },
): Promise<SignedStatementInput> {
  const record = (await recordsFor(endpoint)).find((r) => r.principalId === principalId);
  if (!record) throw new Error("This browser has no key for that account.");
  const payload = JSON.stringify({
    v: 2,
    type: "login",
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    audience: audienceOf(endpoint),
    principalId,
    deviceId: record.deviceId,
  });
  const message = new TextEncoder().encode(LOGIN_CONTEXT + payload);
  const signature = await crypto.subtle.sign(ED25519, record.privateKey, message);
  return { payload, signature: ED25519_TAG + b64url(new Uint8Array(signature)) };
}

/** Link this browser's key for `principalId` to the signed-in account the server named. */
export async function settleBrowserKeys(
  endpoint: string,
  user: { userId: string; username: string },
  principalId: string | null,
): Promise<BrowserAccount | null> {
  if (!principalId) return null;
  const record = (await recordsFor(endpoint)).find((r) => r.principalId === principalId);
  if (!record) return null;
  const next = { ...record, userId: user.userId, username: user.username };
  if (record.userId !== user.userId || record.username !== user.username) {
    await store().put(next);
  }
  return account(next);
}

/** Remove this browser's keys for `principalId` on `endpoint`. */
export async function forgetBrowserKeys(endpoint: string, principalId: string): Promise<void> {
  for (const record of await recordsFor(endpoint)) {
    if (record.principalId === principalId) await store().remove(record.id);
  }
}
