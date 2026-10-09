/**
 * Signed statements of key identity in the browser: signing a login proof with a WebCrypto
 * device key, and verifying a key log and a device certificate the way the Tauri side's
 * `statement.rs` does.
 *
 * Reads statement versions 1 and 2 and writes version 2, where every key and signature names
 * its algorithm (`ed25519:<base64url>`). A payload is the exact JSON text that was signed:
 * nothing here re-serializes a payload it did not build, and fields are written in the order
 * the known-answer vectors fix.
 *
 * `JSON.parse` keeps the last of two fields with one name, where the Tauri side refuses the
 * payload. Every statement read here was already accepted by a server that refuses duplicates,
 * and its signature still has to verify. Key log entries and revocations with fields the spec
 * does not name are refused, as the server and the Tauri side refuse them.
 */

import { b64, concat, sameBytes, sha256, unb64, utf8 } from "./bytes";

/** Context bytes that prefix every signed payload, one per purpose. */
export const CONTEXT = {
  keyLog: utf8("rim.keylog.v1\0"),
  device: utf8("rim.device.v1\0"),
  deviceRevoke: utf8("rim.device-revoke.v1\0"),
  login: utf8("rim.login.v1\0"),
  pluginManifest: utf8("rim.plugin-manifest.v1\0"),
  mlsKey: utf8("rim.mls-key.v1\0"),
  mlsReadd: utf8("rim.mls-readd.v1\0"),
} as const;

const PRINCIPAL_DOMAIN = utf8("rim.principal.v1\0");
const PRINCIPAL_PREFIX = "rimp1_";

/** The statement format version this device writes. */
export const WRITE_VERSION = 2;

const ED25519 = "ed25519";
const ED25519_TAG = "ed25519:";

/** A statement as it travels: the signed JSON text and its signature. */
export interface Statement {
  payload: string;
  signature: string;
}

/** A statement this module refused; its message says why. */
export class StatementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementError";
  }
}

// ─── Ed25519 encodings ──────────────────────────────────────────────────────

/** The encodings of the 8 points of small order, sign bit cleared (the order-1, 2, 4 and 8 points). */
const SMALL_ORDER_Y = [
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
].map((hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)));

/** The group order L, little-endian. */
const ORDER = Uint8Array.from(
  "edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010"
    .match(/../g)
    ?.map((h) => parseInt(h, 16)) ?? [],
);

/** A point encoding of small order ("weak"), whichever its sign bit. */
function smallOrder(point: Uint8Array): boolean {
  const y = Uint8Array.from(point);
  y[31] &= 0x7f;
  return SMALL_ORDER_Y.some((weak) => sameBytes(weak, y));
}

/** `y` at or above the field prime 2^255 - 19: a non-canonical point encoding. */
function nonCanonicalPoint(point: Uint8Array): boolean {
  if ((point[31] & 0x7f) !== 0x7f || point[0] < 0xed) return false;
  return point.subarray(1, 31).every((b) => b === 0xff);
}

/** The scalar half of a signature is below the group order. */
function canonicalScalar(s: Uint8Array): boolean {
  for (let i = 31; i >= 0; i--) {
    if (s[i] !== ORDER[i]) return s[i] < ORDER[i];
  }
  return false;
}

/** A public key WebCrypto may verify with: canonical and not of small order. */
function usablePublicKey(key: Uint8Array): boolean {
  return key.length === 32 && !smallOrder(key) && !nonCanonicalPoint(key);
}

/**
 * A key or signature split into its algorithm and bytes. Version 1 spells bare base64url
 * (Ed25519 implied); version 2 spells `<algorithm>:<base64url>`, the algorithm 1 to 32
 * characters of `a-z`, `0-9` and `-`. Any other version is refused.
 */
function splitTagged(text: string, version: number): { algorithm: string; bytes: Uint8Array } {
  const malformed = () => new StatementError("a key or signature is malformed");
  if (version === 1) {
    const bytes = unb64(text);
    if (!bytes) throw malformed();
    return { algorithm: ED25519, bytes };
  }
  if (version === 2) {
    const colon = text.indexOf(":");
    if (colon < 0) throw malformed();
    const algorithm = text.slice(0, colon);
    if (!/^[a-z0-9-]{1,32}$/.test(algorithm)) throw malformed();
    const bytes = unb64(text.slice(colon + 1));
    if (!bytes) throw malformed();
    return { algorithm, bytes };
  }
  throw new StatementError(`statement version ${version} is not supported`);
}

/** A key as `version` spells it, in canonical tagged text. */
export function canonicalKey(text: string, version: number): string {
  const { algorithm, bytes } = splitTagged(text, version);
  return `${algorithm}:${b64(bytes)}`;
}

/** The tagged text of a WebCrypto Ed25519 public key. */
export async function publicKeyText(publicKey: CryptoKey): Promise<string> {
  return ED25519_TAG + b64(new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)));
}

/**
 * Whether `statement`, a statement of `version`, is signed by `publicKey` (canonical tagged
 * text) for `context`. A signature only verifies under a key of its own algorithm. Strict:
 * weak or non-canonical keys, small-order `R` and a scalar at or above the group order fail.
 */
export async function verify(
  statement: Statement,
  context: Uint8Array,
  publicKey: string,
  version: number,
): Promise<boolean> {
  let key: { algorithm: string; bytes: Uint8Array };
  let signature: { algorithm: string; bytes: Uint8Array };
  try {
    key = splitTagged(publicKey, 2);
    signature = splitTagged(statement.signature, version);
  } catch {
    return false;
  }
  if (key.algorithm !== signature.algorithm || key.algorithm !== ED25519) return false;
  const sig = signature.bytes;
  if (!usablePublicKey(key.bytes) || sig.length !== 64) return false;
  if (smallOrder(sig.subarray(0, 32)) || !canonicalScalar(sig.subarray(32))) return false;
  try {
    const verifier = await crypto.subtle.importKey("raw", key.bytes, { name: "Ed25519" }, false, [
      "verify",
    ]);
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      verifier,
      sig,
      concat(context, utf8(statement.payload)),
    );
  } catch {
    return false;
  }
}

/** Sign `payload` for `context` with a device key, as a version 2 (tagged) signature. */
export async function sign(
  privateKey: CryptoKey,
  context: Uint8Array,
  payload: string,
): Promise<Statement> {
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    concat(context, utf8(payload)),
  );
  return { payload, signature: ED25519_TAG + b64(new Uint8Array(signature)) };
}

/** base64url(SHA-256(payload)), the `prev` link of a rotation. */
export async function payloadHash(payload: string): Promise<string> {
  return b64(await sha256(utf8(payload)));
}

/** The principal id an inception payload fixes forever. */
export async function principalId(inceptionPayload: string): Promise<string> {
  return PRINCIPAL_PREFIX + b64(await sha256(concat(PRINCIPAL_DOMAIN, utf8(inceptionPayload))));
}

// ─── Login proof ────────────────────────────────────────────────────────────

export interface LoginInput {
  challengeId: string;
  nonce: string;
  audience: string;
  principalId: string;
  deviceId: string;
}

/** A version 2 login proof, signed by the device key. */
export function signLogin(deviceKey: CryptoKey, input: LoginInput): Promise<Statement> {
  const payload = JSON.stringify({
    v: WRITE_VERSION,
    type: "login",
    challengeId: input.challengeId,
    nonce: input.nonce,
    audience: input.audience,
    principalId: input.principalId,
    deviceId: input.deviceId,
  });
  return sign(deviceKey, CONTEXT.login, payload);
}

// ─── Reading payloads ───────────────────────────────────────────────────────

/** A JSON object's fields, read before anything in them is trusted. */
export type Fields = Record<string, unknown>;

/** `payload` as a JSON object, or `null` when it is not one. */
export function parseObject(payload: string): Fields | null {
  try {
    const value: unknown = JSON.parse(payload);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Fields) : null;
  } catch {
    return null;
  }
}

/** An unsigned integer field of at most `max`. */
export function uint(fields: Fields, name: string, max: number): number | null {
  const value = fields[name];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : null;
}

/** A string field. */
export function text(fields: Fields, name: string): string | null {
  const value = fields[name];
  return typeof value === "string" ? value : null;
}

/** An optional string field: absent and `null` both read as absent. */
function optionalText(fields: Fields, name: string): string | null | undefined {
  const value = fields[name];
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : null;
}

/** Whether `fields` has a field outside `allowed`. */
export function unknownField(fields: Fields, allowed: readonly string[]): boolean {
  return Object.keys(fields).some((name) => !allowed.includes(name));
}

/** An RFC 3339 timestamp field. */
export function timestamp(fields: Fields, name: string): string | null {
  const value = text(fields, name);
  return value !== null && !Number.isNaN(Date.parse(value)) ? value : null;
}

const INCEPTION_FIELDS = ["v", "type", "seq", "identityKey", "recoveryKey", "createdAt"];
const ROTATION_FIELDS = [...INCEPTION_FIELDS, "principalId", "prev", "signer"];
const REVOCATION_FIELDS = ["v", "type", "principalId", "deviceId", "signer", "issuedAt"];

const U8 = 0xff;
const U32 = 0xffffffff;

// ─── Replaying a key log ────────────────────────────────────────────────────

/** Where a verified key log ends. */
export interface KeyHead {
  principalId: string;
  seq: number;
  identityKey: string;
  recoveryKey: string;
  /** `prev` for the next rotation: base64url(SHA-256(head payload)). */
  hash: string;
  /** The identity key at every seq, oldest first, to check device certificates against. */
  identityKeys: string[];
  /** Who signed the entry at every seq, oldest first; `null` for the inception. */
  signers: (RotationSigner | null)[];
  /** base64url(SHA-256(payload)) of the entry at every seq, oldest first. */
  hashes: string[];
}

/** Whether a recovery rotation follows the entry at `seq`: what its identity key signed is void. */
export function recoveredAfter(head: KeyHead, seq: number): boolean {
  return head.signers.slice(seq + 1).some((signer) => signer === "recovery");
}

/** Who signed a rotation. */
export type RotationSigner = "identity" | "recovery";

interface LogEntry {
  v: number;
  kind: string;
  seq: number;
  principalId?: string;
  prev?: string;
  identityKey: string;
  recoveryKey: string;
  signer?: string;
}

function logError(message: string): StatementError {
  return new StatementError(`key log: ${message}`);
}

function readLogEntry(payload: string, at: number): LogEntry {
  const fields = parseObject(payload);
  const unreadable = () => logError(`entry ${at} is not a key log entry`);
  if (!fields) throw unreadable();
  const v = uint(fields, "v", U8);
  const kind = text(fields, "type");
  const seq = uint(fields, "seq", U32);
  const identityKey = text(fields, "identityKey");
  const recoveryKey = text(fields, "recoveryKey");
  const principal = optionalText(fields, "principalId");
  const prev = optionalText(fields, "prev");
  const signer = optionalText(fields, "signer");
  if (
    v === null ||
    kind === null ||
    seq === null ||
    identityKey === null ||
    recoveryKey === null ||
    principal === null ||
    prev === null ||
    signer === null ||
    timestamp(fields, "createdAt") === null ||
    unknownField(fields, at === 0 ? INCEPTION_FIELDS : ROTATION_FIELDS)
  ) {
    throw unreadable();
  }
  return { v, kind, seq, principalId: principal, prev, identityKey, recoveryKey, signer };
}

function logKey(text: string, version: number): string {
  try {
    return canonicalKey(text, version);
  } catch (err) {
    throw logError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Verify a key log from its inception and return its head. Entries may be version 1 or 2, and
 * a log never goes back from 2 to 1; the head's keys are in canonical tagged text whichever
 * version spelled them.
 */
export async function replay(log: Statement[]): Promise<KeyHead> {
  const [first, ...rest] = log;
  if (!first) throw logError("empty");
  const entry = readLogEntry(first.payload, 0);
  const identityKey = logKey(entry.identityKey, entry.v);
  const recoveryKey = logKey(entry.recoveryKey, entry.v);
  if (entry.kind !== "inception" || entry.seq !== 0) {
    throw logError("entry 0 is not an inception");
  }
  if (identityKey === recoveryKey) throw logError("the identity and recovery keys must differ");
  if (!(await verify(first, CONTEXT.keyLog, identityKey, entry.v))) {
    throw logError("inception signature does not verify");
  }
  let version = entry.v;
  let head: KeyHead = {
    principalId: await principalId(first.payload),
    seq: 0,
    identityKey,
    recoveryKey,
    hash: await payloadHash(first.payload),
    identityKeys: [identityKey],
    signers: [null],
    hashes: [await payloadHash(first.payload)],
  };
  for (const statement of rest) {
    const at = head.seq + 1;
    const next = readLogEntry(statement.payload, at);
    const nextIdentity = logKey(next.identityKey, next.v);
    const nextRecovery = logKey(next.recoveryKey, next.v);
    if (next.v < version) {
      throw logError(`entry ${at} goes back to statement version ${next.v}`);
    }
    if (next.kind !== "rotate") throw logError(`entry ${at} is not a rotation`);
    if (next.principalId !== head.principalId || next.seq !== at || next.prev !== head.hash) {
      throw logError(`entry ${at} does not extend the log`);
    }
    if (nextIdentity === head.identityKey) {
      throw logError("a rotation must change the identity key");
    }
    if (nextIdentity === nextRecovery) {
      throw logError("the identity and recovery keys must differ");
    }
    let signerKey: string;
    let signer: RotationSigner;
    if (next.signer === "identity") {
      if (nextRecovery !== head.recoveryKey) {
        throw logError("only recovery may change the recovery key");
      }
      signerKey = head.identityKey;
      signer = "identity";
    } else if (next.signer === "recovery") {
      signerKey = head.recoveryKey;
      signer = "recovery";
    } else {
      throw logError("unknown rotation signer");
    }
    if (!(await verify(statement, CONTEXT.keyLog, signerKey, next.v))) {
      throw logError(`entry ${at} signature does not verify`);
    }
    version = next.v;
    const hash = await payloadHash(statement.payload);
    head = {
      principalId: head.principalId,
      seq: next.seq,
      identityKey: nextIdentity,
      recoveryKey: nextRecovery,
      hash,
      identityKeys: [...head.identityKeys, nextIdentity],
      signers: [...head.signers, signer],
      hashes: [...head.hashes, hash],
    };
  }
  return head;
}

// ─── Device certificates ────────────────────────────────────────────────────

/** What a device certificate says, read before it is verified. Never trusted on its own. */
export interface CertificateClaim {
  principalId: string;
  deviceId: string;
  /** Canonical tagged text. */
  deviceKey: string;
  name: string;
}

interface CertEntry {
  v: number;
  kind: string;
  principalId: string;
  deviceId: string;
  deviceKey: string;
  name: string;
  keySeq: number;
}

function readCertificate(payload: string): CertEntry | null {
  const fields = parseObject(payload);
  if (!fields) return null;
  const entry = {
    v: uint(fields, "v", U8),
    kind: text(fields, "type"),
    principalId: text(fields, "principalId"),
    deviceId: text(fields, "deviceId"),
    deviceKey: text(fields, "deviceKey"),
    name: text(fields, "name"),
    keySeq: uint(fields, "keySeq", U32),
  };
  return Object.values(entry).some((value) => value === null) ? null : (entry as CertEntry);
}

/** Read what a device certificate claims, without verifying it. */
export function certificateClaim(certificate: Statement): CertificateClaim {
  const refused = () => new StatementError("not a device certificate");
  const entry = readCertificate(certificate.payload);
  if (!entry || entry.kind !== "device") throw refused();
  let deviceKey: string;
  try {
    deviceKey = canonicalKey(entry.deviceKey, entry.v);
  } catch {
    throw refused();
  }
  return {
    principalId: entry.principalId,
    deviceId: entry.deviceId,
    deviceKey,
    name: entry.name,
  };
}

/** A device as a verified certificate names it. */
export interface CertifiedDevice {
  deviceId: string;
  /** Canonical tagged text. */
  deviceKey: string;
}

/**
 * The device a certificate vouches for, once it verifies against the log: it names this log's
 * principal, is signed by the identity key at its `keySeq`, and no recovery rotation follows that
 * `keySeq` (a recovery voids what the lost key signed).
 */
export async function certifiedDevice(
  certificate: Statement,
  head: KeyHead,
): Promise<CertifiedDevice> {
  const refused = () => new StatementError("a device certificate does not verify");
  const entry = readCertificate(certificate.payload);
  if (!entry || entry.kind !== "device" || entry.principalId !== head.principalId) throw refused();
  const signer = head.identityKeys[entry.keySeq];
  if (signer === undefined) throw refused();
  if (recoveredAfter(head, entry.keySeq)) {
    throw new StatementError("a device certificate predates a recovery");
  }
  if (!(await verify(certificate, CONTEXT.device, signer, entry.v))) throw refused();
  let deviceKey: string;
  try {
    deviceKey = canonicalKey(entry.deviceKey, entry.v);
  } catch {
    throw refused();
  }
  return { deviceId: entry.deviceId, deviceKey };
}

// ─── Device revocations ─────────────────────────────────────────────────────

/**
 * Whether `revocation` is a signed revocation of `deviceId` of the log's principal: by an
 * identity key of the log (the key current when it was signed), or by the revoked device's own
 * key `deviceKey` (canonical tagged text).
 */
export async function verifiedRevocation(
  revocation: Statement,
  head: KeyHead,
  deviceId: string,
  deviceKey: string,
): Promise<boolean> {
  const fields = parseObject(revocation.payload);
  if (!fields || unknownField(fields, REVOCATION_FIELDS)) return false;
  const v = uint(fields, "v", U8);
  const named = text(fields, "deviceId");
  const signer = text(fields, "signer");
  if (
    v === null ||
    text(fields, "type") !== "device-revoke" ||
    text(fields, "principalId") !== head.principalId ||
    named === null ||
    named.toLowerCase() !== deviceId.toLowerCase() ||
    timestamp(fields, "issuedAt") === null
  ) {
    return false;
  }
  if (signer === "device") return verify(revocation, CONTEXT.deviceRevoke, deviceKey, v);
  if (signer !== "identity") return false;
  for (const key of head.identityKeys) {
    if (await verify(revocation, CONTEXT.deviceRevoke, key, v)) return true;
  }
  return false;
}

// ─── Profile cards ──────────────────────────────────────────────────────────

const CARD_FIELDS = [
  "v",
  "type",
  "principalId",
  "version",
  "keySeq",
  "displayName",
  "relays",
  "devices",
  "issuedAt",
];

const CARD_CONTEXT = utf8("rim.profile-card.v1\0");

/** What a verified profile card says. */
export interface VerifiedCard {
  version: number;
  keySeq: number;
  displayName: string;
  /** Relay origins, preferred first. */
  relays: string[];
  /** Devices as the card lists them; each still needs its certificate to be trusted. */
  devices: CertifiedDevice[];
}

/** A relay URL a card may list: `http(s)`, at most 256 bytes. */
function cardRelay(value: unknown): string | null {
  if (typeof value !== "string" || utf8(value).length > 256) return null;
  return /^https?:\/\/[^\s]+$/.test(value) ? value : null;
}

/**
 * The profile card `card` of the log's principal, once it verifies: signed by the identity key
 * at its `keySeq` with no recovery after it, 1 to 80 characters of name, at most 8 unique
 * `http(s)` relays and 32 unique devices.
 */
export async function verifiedCard(card: Statement, head: KeyHead): Promise<VerifiedCard> {
  const refused = (why: string) => new StatementError(`profile card: ${why}`);
  const fields = parseObject(card.payload);
  if (!fields || unknownField(fields, CARD_FIELDS)) throw refused("not a profile card");
  const v = uint(fields, "v", U8);
  const version = uint(fields, "version", 0x7fffffff);
  const keySeq = uint(fields, "keySeq", U32);
  const displayName = text(fields, "displayName");
  if (
    (v !== 1 && v !== 2) ||
    text(fields, "type") !== "profile-card" ||
    version === null ||
    version < 1 ||
    keySeq === null ||
    displayName === null ||
    timestamp(fields, "issuedAt") === null
  ) {
    throw refused("not a profile card");
  }
  if (text(fields, "principalId") !== head.principalId) throw refused("names another account");
  const signer = head.identityKeys[keySeq];
  if (signer === undefined || recoveredAfter(head, keySeq)) throw refused("signed by a lost key");
  if (!(await verify(card, CARD_CONTEXT, signer, v))) throw refused("signature does not verify");
  const name = displayName.trim();
  if (name.length === 0 || Array.from(name).length > 80) throw refused("name is not allowed");
  const relays = Array.isArray(fields.relays) ? fields.relays.map(cardRelay) : null;
  if (!relays || relays.length > 8 || relays.some((r) => r === null)) {
    throw refused("relays are not allowed");
  }
  if (new Set(relays).size !== relays.length) throw refused("relays repeat");
  const devices: CertifiedDevice[] = [];
  const listed = Array.isArray(fields.devices) ? (fields.devices as unknown[]) : null;
  if (!listed || listed.length > 32) throw refused("devices are not allowed");
  for (const entry of listed) {
    const device = entry && typeof entry === "object" ? (entry as Fields) : null;
    const deviceId = device ? text(device, "deviceId") : null;
    const deviceKey = device ? text(device, "deviceKey") : null;
    if (!deviceId || !deviceKey) throw refused("devices are not allowed");
    devices.push({ deviceId, deviceKey: canonicalKey(deviceKey, v) });
  }
  if (new Set(devices.map((d) => d.deviceId.toLowerCase())).size !== devices.length) {
    throw refused("devices repeat");
  }
  return { version, keySeq, displayName: name, relays: relays as string[], devices };
}
