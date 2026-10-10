/**
 * Statements between this app, its relay and the hosts of spaces elsewhere, in the browser: a
 * server's key log and signed descriptor, the device-request statement this device signs for a
 * request to a space hosted elsewhere and the delegation it signs for its relay, and the
 * host-response, host-event and revocation-acknowledgement statements a host signs. All are statement version 2 only, read with the same strictness as the key log of a
 * person (`statements.ts`): unknown fields are refused and keys name their algorithm.
 */

import { b64, concat, sha256, unb64, utf8 } from "../../key-identity/browser/bytes";
import {
  canonicalKey,
  parseObject,
  sign,
  StatementError,
  text,
  timestamp,
  uint,
  unknownField,
  verify,
  type Fields,
  type Statement,
} from "../../key-identity/browser/statements";

/** Context bytes of the statements servers and devices sign here. */
export const RELAY_CONTEXT = {
  serverKey: utf8("rim.server-key.v1\0"),
  descriptor: utf8("rim.server-descriptor.v1\0"),
  deviceRequest: utf8("rim.device-request.v1\0"),
  hostResponse: utf8("rim.host-response.v1\0"),
  hostEvent: utf8("rim.host-event.v1\0"),
  delegation: utf8("rim.delegation.v1\0"),
  revocationAck: utf8("rim.revocation-ack.v1\0"),
} as const;

const SERVER_DOMAIN = utf8("rim.server.v1\0");
const SERVER_PREFIX = "rims1_";
const VERSION = 2;
const KIB = 1024;
const MAX_LOG_ENTRIES = 256;
const MAX_U31 = 0x7fffffff;
const MAX_U32 = 0xffffffff;

/** The largest `seq` a device request may carry: below 2^53. */
export const MAX_REQUEST_SEQ = Number.MAX_SAFE_INTEGER;

function refused(what: string, why: string): StatementError {
  return new StatementError(`${what}: ${why}`);
}

function bounded(statement: Statement, max: number, what: string): void {
  if (utf8(statement.payload).length > max) throw refused(what, "too large");
}

/** base64url(SHA-256(bytes)). */
export async function sha256Text(bytes: Uint8Array): Promise<string> {
  return b64(await sha256(bytes));
}

// ─── Server key log ─────────────────────────────────────────────────────────

/** Who signed a server key rotation. */
export type ServerRotationSigner = "server" | "recovery";

/** Where a verified server key log ends. */
export interface ServerHead {
  serverId: string;
  seq: number;
  serverKey: string;
  recoveryKey: string;
  /** base64url(SHA-256(head payload)): `prev` of the next rotation. */
  hash: string;
  /** The server key at every seq, oldest first. */
  keys: string[];
  /** Who signed the entry at every seq; `null` for the inception. */
  signers: (ServerRotationSigner | null)[];
  /** base64url(SHA-256(payload)) of the entry at every seq. */
  hashes: string[];
}

const INCEPTION_FIELDS = ["v", "type", "seq", "serverKey", "recoveryKey", "createdAt"];
const ROTATION_FIELDS = [
  "v",
  "type",
  "serverId",
  "seq",
  "prev",
  "serverKey",
  "recoveryKey",
  "signer",
  "createdAt",
];

/** The server id an inception payload fixes forever. */
export async function serverId(inceptionPayload: string): Promise<string> {
  return SERVER_PREFIX + (await sha256Text(concat(SERVER_DOMAIN, utf8(inceptionPayload))));
}

/** base64url(SHA-256(tagged key text)), how a delegation or an invite names a server key. */
export function keyHash(key: string): Promise<string> {
  return sha256Text(utf8(key));
}

function logKey(fields: Fields, name: string): string {
  const value = text(fields, name);
  if (value === null) throw refused("server key log", "an entry is malformed");
  try {
    return canonicalKey(value, VERSION);
  } catch {
    throw refused("server key log", "a key is malformed");
  }
}

function logEntry(statement: Statement, at: number): Fields {
  bounded(statement, 16 * KIB, "server key log");
  const fields = parseObject(statement.payload);
  const allowed = at === 0 ? INCEPTION_FIELDS : ROTATION_FIELDS;
  if (
    !fields ||
    unknownField(fields, allowed) ||
    uint(fields, "v", 0xff) !== VERSION ||
    uint(fields, "seq", MAX_U32) !== at ||
    timestamp(fields, "createdAt") === null
  ) {
    throw refused("server key log", `entry ${at} is not a server key log entry`);
  }
  return fields;
}

/** Verify a server's key log from its inception and return its head. */
export async function replayServerLog(log: Statement[]): Promise<ServerHead> {
  const [first, ...rest] = log;
  if (!first) throw refused("server key log", "empty");
  if (log.length > MAX_LOG_ENTRIES) throw refused("server key log", "too long");
  const inception = logEntry(first, 0);
  if (text(inception, "type") !== "server-inception") {
    throw refused("server key log", "entry 0 is not an inception");
  }
  const serverKey = logKey(inception, "serverKey");
  const recoveryKey = logKey(inception, "recoveryKey");
  if (serverKey === recoveryKey) throw refused("server key log", "the keys must differ");
  if (!(await verify(first, RELAY_CONTEXT.serverKey, serverKey, VERSION))) {
    throw refused("server key log", "inception signature does not verify");
  }
  const hash = await sha256Text(utf8(first.payload));
  let head: ServerHead = {
    serverId: await serverId(first.payload),
    seq: 0,
    serverKey,
    recoveryKey,
    hash,
    keys: [serverKey],
    signers: [null],
    hashes: [hash],
  };
  for (const statement of rest) {
    const at = head.seq + 1;
    const entry = logEntry(statement, at);
    const nextKey = logKey(entry, "serverKey");
    const nextRecovery = logKey(entry, "recoveryKey");
    if (
      text(entry, "type") !== "server-rotate" ||
      text(entry, "serverId") !== head.serverId ||
      text(entry, "prev") !== head.hash
    ) {
      throw refused("server key log", `entry ${at} does not extend the log`);
    }
    if (nextKey === head.serverKey)
      throw refused("server key log", "a rotation must change the key");
    if (nextKey === nextRecovery) throw refused("server key log", "the keys must differ");
    const signer = text(entry, "signer");
    let signerKey: string;
    if (signer === "server") {
      if (nextRecovery !== head.recoveryKey) {
        throw refused("server key log", "only recovery may change the recovery key");
      }
      signerKey = head.serverKey;
    } else if (signer === "recovery") {
      signerKey = head.recoveryKey;
    } else {
      throw refused("server key log", "unknown rotation signer");
    }
    if (!(await verify(statement, RELAY_CONTEXT.serverKey, signerKey, VERSION))) {
      throw refused("server key log", `entry ${at} signature does not verify`);
    }
    const entryHash = await sha256Text(utf8(statement.payload));
    head = {
      serverId: head.serverId,
      seq: at,
      serverKey: nextKey,
      recoveryKey: nextRecovery,
      hash: entryHash,
      keys: [...head.keys, nextKey],
      signers: [...head.signers, signer],
      hashes: [...head.hashes, entryHash],
    };
  }
  return head;
}

/** How a fetched server key log relates to the one pinned for that server. */
export type PinRelation = "equal" | "extends" | "prefix" | "fork";

/**
 * Compare a fetched log's head with the pinned log's entry hashes. A log from another
 * inception is a fork too: it names another server.
 */
export function comparePin(pinnedHashes: readonly string[], head: ServerHead): PinRelation {
  const pinnedSeq = pinnedHashes.length - 1;
  if (pinnedSeq < 0) return "fork";
  if (head.seq >= pinnedSeq) {
    if (head.hashes[pinnedSeq] !== pinnedHashes[pinnedSeq]) return "fork";
    return head.seq === pinnedSeq ? "equal" : "extends";
  }
  return pinnedHashes[head.seq] === head.hash ? "prefix" : "fork";
}

/**
 * Whether `keyHashText` names a key of the log followed only by `signer: server` rotations:
 * an invite naming that key still names this server.
 */
export async function namesCurrentKey(head: ServerHead, keyHashText: string): Promise<boolean> {
  for (let seq = head.seq; seq >= 0; seq--) {
    if ((await keyHash(head.keys[seq])) === keyHashText) return true;
    if (head.signers[seq] === "recovery") return false;
  }
  return false;
}

// ─── Descriptor and discovery ───────────────────────────────────────────────

/** A verified server descriptor: where the server answers and what it runs. */
export interface ServerDescriptor {
  serverId: string;
  keySeq: number;
  version: number;
  roles: ("host" | "relay")[];
  endpoints: { graphql: string; websocket: string; s2s: string | null };
}

const DESCRIPTOR_FIELDS = [
  "v",
  "type",
  "serverId",
  "keySeq",
  "version",
  "roles",
  "endpoints",
  "s2sVersions",
  "mlsCipherSuites",
  "limits",
  "registration",
  "issuedAt",
];

function readRoles(value: unknown): ("host" | "relay")[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const order = ["host", "relay"];
  let last = -1;
  for (const role of value) {
    const at = order.indexOf(String(role));
    if (typeof role !== "string" || at <= last) return null;
    last = at;
  }
  return value as ("host" | "relay")[];
}

/** Verify a descriptor signed by the head key of `head`. */
export async function verifyDescriptor(
  head: ServerHead,
  descriptor: Statement,
): Promise<ServerDescriptor> {
  bounded(descriptor, 16 * KIB, "server descriptor");
  const fields = parseObject(descriptor.payload);
  const endpoints =
    fields && fields.endpoints && typeof fields.endpoints === "object"
      ? (fields.endpoints as Fields)
      : null;
  const roles = fields ? readRoles(fields.roles) : null;
  const version = fields ? uint(fields, "version", MAX_U31) : null;
  const graphql = endpoints ? text(endpoints, "graphql") : null;
  const websocket = endpoints ? text(endpoints, "websocket") : null;
  const s2s = endpoints?.s2s === null ? null : endpoints ? text(endpoints, "s2s") : null;
  if (
    !fields ||
    !endpoints ||
    unknownField(fields, DESCRIPTOR_FIELDS) ||
    unknownField(endpoints, ["graphql", "websocket", "s2s"]) ||
    uint(fields, "v", 0xff) !== VERSION ||
    text(fields, "type") !== "server-descriptor" ||
    !roles ||
    version === null ||
    version < 1 ||
    graphql === null ||
    websocket === null ||
    (s2s === null && endpoints.s2s !== null) ||
    timestamp(fields, "issuedAt") === null
  ) {
    throw refused("server descriptor", "malformed");
  }
  if (text(fields, "serverId") !== head.serverId)
    throw refused("server descriptor", "another server");
  if (uint(fields, "keySeq", MAX_U32) !== head.seq) {
    throw refused("server descriptor", "not signed by the head key");
  }
  if (!(await verify(descriptor, RELAY_CONTEXT.descriptor, head.serverKey, VERSION))) {
    throw refused("server descriptor", "signature does not verify");
  }
  return {
    serverId: head.serverId,
    keySeq: head.seq,
    version,
    roles,
    endpoints: { graphql, websocket, s2s },
  };
}

/** A discovery document, verified: the server's key log and its descriptor. */
export interface VerifiedDiscovery {
  log: Statement[];
  head: ServerHead;
  descriptor: ServerDescriptor;
}

function statementOf(value: unknown): Statement | null {
  if (!value || typeof value !== "object") return null;
  const fields = value as Fields;
  const payload = text(fields, "payload");
  const signature = text(fields, "signature");
  return payload !== null && signature !== null ? { payload, signature } : null;
}

/**
 * Read and verify a discovery document (`GET /.well-known/rim-server`) fetched for `origin`:
 * the log replays, the descriptor verifies under its head, and the server-to-server endpoint
 * lives at that origin.
 */
export async function verifyDiscovery(
  document: string,
  origin: string,
): Promise<VerifiedDiscovery> {
  const fields = parseObject(document);
  const log = Array.isArray(fields?.keyLog) ? fields.keyLog.map(statementOf) : null;
  const descriptor = statementOf(fields?.descriptor);
  if (!fields || fields.rim !== "server-discovery" || !log || log.some((s) => !s) || !descriptor) {
    throw refused("server discovery", "malformed");
  }
  const statements = log as Statement[];
  const head = await replayServerLog(statements);
  const verified = await verifyDescriptor(head, descriptor);
  const s2s = verified.endpoints.s2s;
  if (s2s !== null && !s2s.startsWith(origin.replace(/\/+$/, ""))) {
    throw refused("server discovery", "its endpoints are at another origin");
  }
  return { log: statements, head, descriptor: verified };
}

// ─── Device requests ────────────────────────────────────────────────────────

/** What a device-request statement says, in its field order. */
export interface DeviceRequestInput {
  principalId: string;
  deviceId: string;
  host: string;
  method: "GET" | "POST";
  path: string;
  seq: number;
  bodySha256: string;
  issuedAt: string;
}

/** The exact payload text of a device request. */
export function deviceRequestPayload(input: DeviceRequestInput): string {
  if (!Number.isSafeInteger(input.seq) || input.seq < 0) {
    throw refused("device request", "seq is out of range");
  }
  return JSON.stringify({
    v: VERSION,
    type: "device-request",
    principalId: input.principalId,
    deviceId: input.deviceId,
    host: input.host,
    method: input.method,
    path: input.path,
    seq: input.seq,
    bodySha256: input.bodySha256,
    issuedAt: input.issuedAt,
  });
}

/** A device request signed by a WebCrypto device key. */
export function signDeviceRequest(
  deviceKey: CryptoKey,
  input: DeviceRequestInput,
): Promise<Statement> {
  return sign(deviceKey, RELAY_CONTEXT.deviceRequest, deviceRequestPayload(input));
}

/** The two headers that carry a device request. */
export function deviceRequestHeaders(request: Statement): Record<string, string> {
  return {
    "Rim-Device-Request": b64(utf8(request.payload)),
    "Rim-Device-Signature": request.signature,
  };
}

/** The current time as statements write it: RFC 3339, whole seconds, `Z`. */
export function issuedAtNow(now: number = Date.now()): string {
  return new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

// ─── Host responses ─────────────────────────────────────────────────────────

const RESPONSE_FIELDS = ["v", "type", "host", "keySeq", "requestSha256", "status", "bodySha256"];

/** A host-response statement, read from its headers before it is verified. */
export interface HostResponse {
  statement: Statement;
  host: string;
  keySeq: number;
  requestSha256: string;
  status: number;
  bodySha256: string;
}

/** Read `Rim-Host-Response` (base64url payload) and `Rim-Host-Signature`. */
export function readHostResponse(encoded: string, signature: string): HostResponse {
  const bytes = unb64(encoded);
  if (!bytes) throw refused("host response", "malformed");
  let payload: string;
  try {
    payload = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw refused("host response", "malformed");
  }
  const statement = { payload, signature };
  bounded(statement, 16 * KIB, "host response");
  const fields = parseObject(payload);
  const host = fields ? text(fields, "host") : null;
  const keySeq = fields ? uint(fields, "keySeq", MAX_U32) : null;
  const requestSha256 = fields ? text(fields, "requestSha256") : null;
  const status = fields ? uint(fields, "status", 999) : null;
  const bodySha256 = fields ? text(fields, "bodySha256") : null;
  if (
    !fields ||
    unknownField(fields, RESPONSE_FIELDS) ||
    uint(fields, "v", 0xff) !== VERSION ||
    text(fields, "type") !== "host-response" ||
    host === null ||
    keySeq === null ||
    requestSha256 === null ||
    status === null ||
    bodySha256 === null
  ) {
    throw refused("host response", "malformed");
  }
  return { statement, host, keySeq, requestSha256, status, bodySha256 };
}

/** What a host response must say to answer a request. */
export interface ResponseExpectation {
  host: string;
  /** The device-request payload text the request carried. */
  requestPayload: string;
  status: number;
  body: Uint8Array;
}

/**
 * Check a host response against the request it answers and the host key at its `keySeq`:
 * the host, the request hash, the status and the body hash, then the signature.
 */
export async function verifyHostResponse(
  response: HostResponse,
  hostKey: string,
  expected: ResponseExpectation,
): Promise<void> {
  if (response.host !== expected.host) throw refused("host response", "from another host");
  if (response.requestSha256 !== (await sha256Text(utf8(expected.requestPayload)))) {
    throw refused("host response", "answers another request");
  }
  if (response.status !== expected.status) throw refused("host response", "another status");
  if (response.bodySha256 !== (await sha256Text(expected.body))) {
    throw refused("host response", "another body");
  }
  if (!(await verify(response.statement, RELAY_CONTEXT.hostResponse, hostKey, VERSION))) {
    throw refused("host response", "signature does not verify");
  }
}

// ─── Host events ────────────────────────────────────────────────────────────

const EVENT_FIELDS = [
  "v",
  "type",
  "host",
  "keySeq",
  "workspaceId",
  "stream",
  "seq",
  "event",
  "issuedAt",
];

/** A host-event statement, read before it is verified. */
export interface HostEvent {
  host: string;
  keySeq: number;
  workspaceId: string;
  stream: string;
  /** `null` on the ephemeral stream `e`. */
  seq: number | null;
  event: Fields & { type: string };
  issuedAt: string;
}

/** Read a host-event envelope's payload. */
export function readHostEvent(envelope: Statement): HostEvent {
  bounded(envelope, 512 * KIB, "host event");
  const fields = parseObject(envelope.payload);
  const host = fields ? text(fields, "host") : null;
  const keySeq = fields ? uint(fields, "keySeq", MAX_U32) : null;
  const workspaceId = fields ? text(fields, "workspaceId") : null;
  const stream = fields ? text(fields, "stream") : null;
  const seq = fields?.seq === null ? null : fields ? uint(fields, "seq", MAX_REQUEST_SEQ) : null;
  const issuedAt = fields ? timestamp(fields, "issuedAt") : null;
  const event =
    fields?.event && typeof fields.event === "object" && !Array.isArray(fields.event)
      ? (fields.event as Fields)
      : null;
  if (
    !fields ||
    unknownField(fields, EVENT_FIELDS) ||
    uint(fields, "v", 0xff) !== VERSION ||
    text(fields, "type") !== "host-event" ||
    host === null ||
    keySeq === null ||
    workspaceId === null ||
    stream === null ||
    (seq === null && fields.seq !== null) ||
    !event ||
    typeof event.type !== "string" ||
    issuedAt === null
  ) {
    throw refused("host event", "malformed");
  }
  return {
    host,
    keySeq,
    workspaceId,
    stream,
    seq,
    event: event as HostEvent["event"],
    issuedAt,
  };
}

/** Whether `envelope` is signed by the host key `hostKey`. */
export function verifyHostEventSignature(envelope: Statement, hostKey: string): Promise<boolean> {
  return verify(envelope, RELAY_CONTEXT.hostEvent, hostKey, VERSION);
}

// ─── Delegations ────────────────────────────────────────────────────────────

/** The longest a delegation may run, from `issuedAt` to `expiresAt`. */
export const MAX_DELEGATION_MS = 24 * 60 * 60 * 1000;

/** What a delegation says, in its field order. */
export interface DelegationInput {
  principalId: string;
  deviceId: string;
  relay: string;
  relayKeyHash: string;
  host: string;
  workspaceId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A whole-second UTC time as statements write it, in ms; `null` for anything else. */
export function statementTime(text: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) || issuedAtNow(ms) !== text ? null : ms;
}

/** The exact payload text of a delegation; refuses what a host would refuse. */
export function delegationPayload(input: DelegationInput): string {
  if (!input.relay.startsWith("rims1_") || !input.host.startsWith("rims1_")) {
    throw refused("delegation", "relay and host must be server ids");
  }
  if (unb64(input.relayKeyHash)?.length !== 32) {
    throw refused("delegation", "the relay key hash is malformed");
  }
  if (!UUID.test(input.workspaceId)) throw refused("delegation", "the workspace id is malformed");
  if (unb64(input.nonce)?.length !== 16) throw refused("delegation", "the nonce must be 16 bytes");
  const issued = statementTime(input.issuedAt);
  const expires = statementTime(input.expiresAt);
  if (issued === null || expires === null) {
    throw refused("delegation", "times must be whole-second UTC");
  }
  if (expires <= issued || expires - issued > MAX_DELEGATION_MS) {
    throw refused("delegation", "a delegation runs for at most 24 hours after it is issued");
  }
  return JSON.stringify({
    v: VERSION,
    type: "delegation",
    principalId: input.principalId,
    deviceId: input.deviceId,
    relay: input.relay,
    relayKeyHash: input.relayKeyHash,
    host: input.host,
    workspaceId: input.workspaceId,
    scope: "workspace",
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  });
}

/** A delegation signed by a WebCrypto device key. */
export function signDelegation(deviceKey: CryptoKey, input: DelegationInput): Promise<Statement> {
  return sign(deviceKey, RELAY_CONTEXT.delegation, delegationPayload(input));
}

// ─── Revocation acknowledgements ────────────────────────────────────────────

const ACK_FIELDS = [
  "v",
  "type",
  "host",
  "keySeq",
  "principalId",
  "deviceId",
  "revocationSha256",
  "appliedAt",
];

/** A host's `revocation-ack`: it applied a device revocation. */
export interface RevocationAck {
  host: string;
  keySeq: number;
  principalId: string;
  deviceId: string;
  revocationSha256: string;
  appliedAt: string;
}

/** Read a revocation acknowledgement before its key is chosen. */
export function readRevocationAck(ack: Statement): RevocationAck {
  bounded(ack, 16 * KIB, "revocation acknowledgement");
  const fields = parseObject(ack.payload);
  const host = fields ? text(fields, "host") : null;
  const keySeq = fields ? uint(fields, "keySeq", MAX_U32) : null;
  const principal = fields ? text(fields, "principalId") : null;
  const deviceId = fields ? text(fields, "deviceId") : null;
  const revocationSha256 = fields ? text(fields, "revocationSha256") : null;
  const appliedAt = fields ? timestamp(fields, "appliedAt") : null;
  if (
    !fields ||
    unknownField(fields, ACK_FIELDS) ||
    uint(fields, "v", 0xff) !== VERSION ||
    text(fields, "type") !== "revocation-ack" ||
    host === null ||
    keySeq === null ||
    principal === null ||
    deviceId === null ||
    revocationSha256 === null ||
    appliedAt === null
  ) {
    throw refused("revocation acknowledgement", "malformed");
  }
  return { host, keySeq, principalId: principal, deviceId, revocationSha256, appliedAt };
}

/** What an acknowledgement must answer: the revocation sent, to that host. */
export interface AckExpectation {
  host: string;
  /** The `device-revoke` payload text that was sent. */
  revocationPayload: string;
}

/**
 * Check an acknowledgement against the revocation it answers and the host key at its
 * `keySeq`: the host, the principal and device, the revocation's hash, the signature.
 */
export async function verifyRevocationAck(
  ack: Statement,
  hostKey: string,
  expected: AckExpectation,
): Promise<RevocationAck> {
  const what = "revocation acknowledgement";
  const entry = readRevocationAck(ack);
  const revoked = parseObject(expected.revocationPayload);
  if (!revoked) throw refused(what, "the revocation is malformed");
  if (entry.host !== expected.host) throw refused(what, "from another host");
  if (
    entry.principalId !== text(revoked, "principalId") ||
    entry.deviceId !== text(revoked, "deviceId")
  ) {
    throw refused(what, "names another device");
  }
  if (entry.revocationSha256 !== (await sha256Text(utf8(expected.revocationPayload)))) {
    throw refused(what, "answers another revocation");
  }
  if (!(await verify(ack, RELAY_CONTEXT.revocationAck, hostKey, VERSION))) {
    throw refused(what, "signature does not verify");
  }
  return entry;
}
