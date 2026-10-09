/**
 * The device link channel in the browser (`rim-server/docs/specs/device-linking-v1.md`): the
 * link code, the channel keys, sealing and opening, the offer, the answer and the fingerprint.
 * The web app joins an account with it; the desktop does the same on the Tauri side.
 *
 * Every key here is a non-extractable `CryptoKey`: HKDF and AES-GCM run in SubtleCrypto, and
 * the link secret is imported once and never read back.
 */

import type { SignedStatementInput } from "../../../core/graphql/generated/schema-types";

const SCHEME = "rim-link:";
const VERSION = "1";
const MAX_CODE_LENGTH = 78 + 256;
const CHANNEL_LABEL = "rim.device-link.v1";
const FINGERPRINT_DOMAIN = "rim.device-link.v1 fingerprint\0";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAX_ANSWER_CIPHERTEXT = 64 * 1024 + 16;

const encoder = new TextEncoder();

// ─── Bytes ──────────────────────────────────────────────────────────────────

/** Unpadded base64url, as every RIM statement spells bytes. */
export function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode strict unpadded base64url (canonical trailing bits); `null` for anything else. */
export function fromB64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return b64url(bytes) === text ? bytes : null;
  } catch {
    return null;
  }
}

/** A UUID v7 (time-ordered), lowercase with hyphens, as device ids are written. */
export function uuidV7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The `host[:port]` of an endpoint URL as written, lowercased: the audience of a login proof,
 * the same rule as the Tauri side's and the server's.
 */
export function audienceOf(endpoint: string): string {
  const trimmed = endpoint.trim();
  const at = trimmed.indexOf("://");
  if (at < 0) throw new Error(`not an absolute server URL: ${endpoint}`);
  const authority = trimmed.slice(at + 3).split(/[/?#]/)[0] ?? "";
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  if (!host) throw new Error(`not an absolute server URL: ${endpoint}`);
  return host.toLowerCase();
}

/** Endpoints compare trimmed, with a trailing `/` ignored, as the key store does. */
export function sameEndpoint(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, "") === b.trim().replace(/\/+$/, "");
}

// ─── The code ───────────────────────────────────────────────────────────────

/** A link code as read: the server's link id, the secret, and the server it is for. */
export interface LinkCode {
  linkId: string;
  linkIdBytes: Uint8Array<ArrayBuffer>;
  secret: Uint8Array<ArrayBuffer>;
  endpoint: string;
}

function validEndpoint(endpoint: string): boolean {
  return (
    endpoint.length >= 1 &&
    endpoint.length <= 256 &&
    /^[\x21-\x7e]+$/.test(endpoint) &&
    !/[?#@]/.test(endpoint) &&
    !endpoint.endsWith("/") &&
    /^https?:\/\//.test(endpoint)
  );
}

/** Read a pasted or scanned code. Throws an `Error` saying what is wrong. */
export function parseLinkCode(text: string): LinkCode {
  const compact = text.replace(/[\t\n\f\r ]+/g, "");
  if (compact.slice(0, SCHEME.length).toLowerCase() !== SCHEME) {
    throw new Error("This is not a RIM link code. It starts with rim-link:");
  }
  const damaged = new Error("The link code is damaged. Copy it again.");
  if (compact.length > MAX_CODE_LENGTH) throw damaged;
  const rest = compact.slice(SCHEME.length);
  const parts: string[] = [];
  let at = 0;
  for (let i = 0; i < 3; i++) {
    const next = rest.indexOf(":", at);
    if (next < 0) throw damaged;
    parts.push(rest.slice(at, next));
    at = next + 1;
  }
  const [version, linkId, secretText] = parts as [string, string, string];
  const endpoint = rest.slice(at);
  if (version !== VERSION) {
    // `0` or `01` is no version at all: not a link code.
    if (/^[1-9]\d*$/.test(version)) {
      throw new Error("This code was made by a newer app; update this device.");
    }
    throw damaged;
  }
  const linkIdBytes = fromB64url(linkId);
  const secret = fromB64url(secretText);
  if (linkIdBytes?.length !== 16 || secret?.length !== 32 || !validEndpoint(endpoint)) {
    throw damaged;
  }
  return { linkId, linkIdBytes, secret, endpoint };
}

// ─── The channel ────────────────────────────────────────────────────────────

export type Direction = "offer" | "answer";

/** A sealed message as it travels: nonce and ciphertext (tag appended), base64url. */
export interface SealedMessage {
  nonce: string;
  ciphertext: string;
}

/** The two non-extractable channel keys of a link. */
export interface Channel {
  linkId: string;
  offer: CryptoKey;
  answer: CryptoKey;
}

/** Derive both channel keys from a code; the secret is not kept. */
export async function openChannel(code: LinkCode): Promise<Channel> {
  const ikm = await crypto.subtle.importKey("raw", code.secret, "HKDF", false, ["deriveKey"]);
  const derive = (direction: Direction) =>
    crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: code.linkIdBytes,
        info: encoder.encode(`${CHANNEL_LABEL} ${direction}`),
      },
      ikm,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  return { linkId: code.linkId, offer: await derive("offer"), answer: await derive("answer") };
}

function aad(channel: Channel, direction: Direction): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${CHANNEL_LABEL}\0${direction}\0${channel.linkId}`);
}

/** Seal `plaintext`; `nonce` defaults to 12 fresh random bytes (tests pass the spec's). */
export async function seal(
  channel: Channel,
  direction: Direction,
  plaintext: string,
  nonce: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12)),
): Promise<SealedMessage> {
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad(channel, direction), tagLength: 128 },
    channel[direction],
    encoder.encode(plaintext),
  );
  return { nonce: b64url(nonce), ciphertext: b64url(new Uint8Array(ciphertext)) };
}

/** Open a message sealed in `direction` on this link; `null` when it does not open. */
export async function open(
  channel: Channel,
  direction: Direction,
  sealed: SealedMessage,
): Promise<string | null> {
  const nonce = fromB64url(sealed.nonce);
  const ciphertext = fromB64url(sealed.ciphertext);
  if (nonce?.length !== 12 || !ciphertext || ciphertext.length > MAX_ANSWER_CIPHERTEXT) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: aad(channel, direction), tagLength: 128 },
      channel[direction],
      ciphertext,
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    return null;
  }
}

/** The 8-character fingerprint both screens show, `XXXX-XXXX`, over the offer plaintext. */
export async function fingerprint(offerPlaintext: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(FINGERPRINT_DOMAIN + offerPlaintext)),
  );
  let bits = 0n;
  for (const byte of digest.slice(0, 5)) bits = (bits << 8n) | BigInt(byte);
  let out = "";
  for (let i = 0; i < 8; i++) out += BASE32[Number((bits >> BigInt(35 - 5 * i)) & 31n)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// ─── Offer and answer ───────────────────────────────────────────────────────

export interface OfferFields {
  deviceId: string;
  /** Tagged (`ed25519:…`). */
  deviceKey: string;
  name: string;
  platform: "desktop" | "web";
}

/** The offer plaintext: fields in the spec's order, no spaces. */
export function offerJson(offer: OfferFields): string {
  return JSON.stringify({
    v: 1,
    type: "link-offer",
    deviceId: offer.deviceId,
    deviceKey: offer.deviceKey,
    name: offer.name,
    platform: offer.platform,
    statementVersion: 2,
  });
}

function hasExactly(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value).sort();
  return own.length === keys.length && [...keys].sort().every((k, i) => own[i] === k);
}

/** The certificate in an opened answer; `null` for anything that is not a v1 answer. */
export function readAnswer(plaintext: string): SignedStatementInput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!hasExactly(raw, ["v", "type", "certificate"]) || raw.v !== 1) return null;
  if (raw.type !== "link-answer") return null;
  const cert = raw.certificate;
  if (!hasExactly(cert, ["payload", "signature"])) return null;
  if (typeof cert.payload !== "string" || typeof cert.signature !== "string") return null;
  return { payload: cert.payload, signature: cert.signature };
}
