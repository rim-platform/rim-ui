/**
 * The device link channel in the browser, as the Tauri side's `device_link.rs` has it: making
 * and reading link codes, the per-direction AES-256-GCM keys derived from the code's secret with
 * HKDF-SHA256, sealing and opening the offer and the answer, and the fingerprint.
 *
 * Channel keys are derived as non-extractable `CryptoKey`s; the secret lives only in the
 * `LinkCode` held in the page's memory.
 */

import { b64, base32, concat, sha256, unb64, utf8 } from "./bytes";

/** The code version, and the version of the offer, the answer, the `info` and the AAD. */
export const LINK_VERSION = 1;
const SCHEME = "rim-link:";
/** 78 fixed characters plus a 256-byte endpoint. */
const MAX_CODE_LEN = 334;
const MAX_ENDPOINT_LEN = 256;
const LINK_ID_TEXT_LEN = 22;
const SECRET_TEXT_LEN = 43;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const AAD_LABEL = utf8("rim.device-link.v1\0");
const FINGERPRINT_DOMAIN = utf8("rim.device-link.v1 fingerprint\0");

/** Error for a message that did not open or whose plaintext is malformed; the two read alike. */
export const NOT_OPENED = "the message could not be opened";

/** A refusal of this module; its message is ready to show. */
export class LinkChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkChannelError";
  }
}

// ─── Link code ──────────────────────────────────────────────────────────────

/** A parsed link code: `rim-link:1:<link id>:<secret>:<endpoint>`. Holds the secret. */
export interface LinkCode {
  linkId: Uint8Array;
  /** The link id as its 22 characters of base64url. */
  linkIdText: string;
  secret: Uint8Array;
  endpoint: string;
}

function notACode(): LinkChannelError {
  return new LinkChannelError("this is not a device link code; copy the whole code again");
}

/** Decode `text` strictly to exactly `length` bytes from exactly `textLength` characters. */
function decodeExact(text: string, textLength: number, length: number): Uint8Array | null {
  if (text.length !== textLength) return null;
  const bytes = unb64(text);
  return bytes && bytes.length === length ? bytes : null;
}

/** `http://` or `https://`, 1 to 256 bytes of printable ASCII, no `?`, `#` or `@`. */
function validEndpoint(endpoint: string): boolean {
  return (
    (endpoint.startsWith("http://") || endpoint.startsWith("https://")) &&
    endpoint.length <= MAX_ENDPOINT_LEN &&
    /^[\x21-\x7e]+$/.test(endpoint) &&
    !/[?#@]/.test(endpoint)
  );
}

/** A link id from its 22-character text. */
export function parseLinkId(text: string): Uint8Array {
  const linkId = decodeExact(text, LINK_ID_TEXT_LEN, 16);
  if (!linkId) throw new LinkChannelError("the server's link id is malformed");
  return linkId;
}

/**
 * A new code for `linkIdText` (from `startDeviceLink`) with a fresh secret. `endpoint` is the
 * app's absolute GraphQL endpoint; its trailing `/` is dropped.
 */
export function generateLinkCode(linkIdText: string, endpoint: string): LinkCode {
  const linkId = parseLinkId(linkIdText);
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!validEndpoint(trimmed)) {
    throw new LinkChannelError(`this server's address cannot go into a link code: ${trimmed}`);
  }
  return {
    linkId,
    linkIdText,
    secret: crypto.getRandomValues(new Uint8Array(32)),
    endpoint: trimmed,
  };
}

/** The code as shown and pasted on the new device. */
export function formatLinkCode(code: LinkCode): string {
  return `${SCHEME}${LINK_VERSION}:${code.linkIdText}:${b64(code.secret)}:${code.endpoint}`;
}

/** Read a code as typed or pasted: ASCII whitespace removed, scheme case ignored, strict decoding. */
export function parseLinkCode(text: string): LinkCode {
  const compact = text.replace(/[\t\n\f\r ]/g, "");
  if (utf8(compact).length > MAX_CODE_LEN) throw notACode();
  const scheme = compact.slice(0, SCHEME.length).replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (scheme !== SCHEME) throw notACode();
  const rest = compact.slice(SCHEME.length);
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < 3; i++) {
    const colon = rest.indexOf(":", from);
    if (colon < 0) throw notACode();
    parts.push(rest.slice(from, colon));
    from = colon + 1;
  }
  const [version, linkIdText, secretText] = parts;
  const endpoint = rest.slice(from);
  if (!/^[1-9][0-9]*$/.test(version) || Number(version) > 0xffffffff) throw notACode();
  if (Number(version) > LINK_VERSION) {
    throw new LinkChannelError("this code was made by a newer app; update this device");
  }
  const linkId = decodeExact(linkIdText, LINK_ID_TEXT_LEN, 16);
  const secret = decodeExact(secretText, SECRET_TEXT_LEN, 32);
  if (!linkId || !secret || !validEndpoint(endpoint)) throw notACode();
  return { linkId, linkIdText, secret, endpoint };
}

// ─── Channel ────────────────────────────────────────────────────────────────

/** Which way a sealed message goes: `offer` from the new device, `answer` from the old one. */
export type Direction = "offer" | "answer";

const MAX_PLAINTEXT: Record<Direction, number> = { offer: 16 * 1024, answer: 64 * 1024 };

/** The HKDF parameters of `K_offer` or `K_answer`: salted with the raw link id. */
export function hkdfParams(code: LinkCode, direction: Direction): HkdfParams {
  return {
    name: "HKDF",
    hash: "SHA-256",
    salt: code.linkId,
    info: utf8(`rim.device-link.v1 ${direction}`),
  };
}

/** `K_offer` or `K_answer`, as a non-extractable AES-256-GCM key. */
async function channelKey(code: LinkCode, direction: Direction): Promise<CryptoKey> {
  const secret = await crypto.subtle.importKey("raw", code.secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    hkdfParams(code, direction),
    secret,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** `rim.device-link.v1\0<direction>\0<link id text>`. */
export function aad(linkIdText: string, direction: Direction): Uint8Array {
  return concat(AAD_LABEL, utf8(`${direction}\0${linkIdText}`));
}

/** A sealed message as it travels: the 12-byte nonce and the ciphertext with its tag appended. */
export interface Sealed {
  nonce: string;
  ciphertext: string;
}

/** Seal `plaintext` under the given nonce. */
export async function sealWithNonce(
  code: LinkCode,
  direction: Direction,
  plaintext: Uint8Array,
  nonce: Uint8Array,
): Promise<Sealed> {
  if (plaintext.length === 0 || plaintext.length > MAX_PLAINTEXT[direction]) {
    throw new LinkChannelError(`the link ${direction} is too large`);
  }
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad(code.linkIdText, direction), tagLength: 128 },
    await channelKey(code, direction),
    plaintext,
  );
  return { nonce: b64(nonce), ciphertext: b64(new Uint8Array(ciphertext)) };
}

/** Seal `plaintext` under a random nonce. Each side seals one plaintext per link. */
export function seal(code: LinkCode, direction: Direction, plaintext: Uint8Array): Promise<Sealed> {
  return sealWithNonce(
    code,
    direction,
    plaintext,
    crypto.getRandomValues(new Uint8Array(NONCE_LEN)),
  );
}

/** Open a sealed message. Every failure (encoding, size, tag) reads the same. */
export async function open(
  code: LinkCode,
  direction: Direction,
  sealed: Sealed,
): Promise<Uint8Array> {
  const failed = () => new LinkChannelError(NOT_OPENED);
  const nonce = unb64(sealed.nonce);
  const ciphertext = unb64(sealed.ciphertext);
  if (
    !nonce ||
    !ciphertext ||
    nonce.length !== NONCE_LEN ||
    ciphertext.length <= TAG_LEN ||
    ciphertext.length > MAX_PLAINTEXT[direction] + TAG_LEN
  ) {
    throw failed();
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: aad(code.linkIdText, direction),
        tagLength: 128,
      },
      await channelKey(code, direction),
      ciphertext,
    );
    return new Uint8Array(plaintext);
  } catch {
    throw failed();
  }
}

/** `XXXX-XXXX`: base32 of the first 5 bytes of SHA-256 over the offer plaintext as sealed. */
export async function fingerprint(offerPlaintext: Uint8Array): Promise<string> {
  const digest = await sha256(concat(FINGERPRINT_DOMAIN, offerPlaintext));
  const text = base32(digest.subarray(0, 5));
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

// ─── Plaintexts ─────────────────────────────────────────────────────────────

/** The new device's offer. */
export interface Offer {
  deviceId: string;
  /** Tagged (version 2) device key. */
  deviceKey: string;
  name: string;
  platform: "desktop" | "web";
  /** The highest key-identity statement version this device reads. */
  statementVersion: number;
}

/** An offer as another device sent it, before its fields are checked. */
export type OpenedOffer = Omit<Offer, "platform"> & { platform: string };

/** The offer as sealed: fields in the order that fixes its bytes. */
export function offerPlaintext(offer: Offer): Uint8Array {
  return utf8(
    JSON.stringify({
      v: LINK_VERSION,
      type: "link-offer",
      deviceId: offer.deviceId,
      deviceKey: offer.deviceKey,
      name: offer.name,
      platform: offer.platform,
      statementVersion: offer.statementVersion,
    }),
  );
}

/**
 * An opened offer. Unknown fields and a wrong version or type are refused; a malformed
 * plaintext reads like one that did not open.
 */
export function parseOffer(plaintext: Uint8Array): OpenedOffer {
  const failed = () => new LinkChannelError(NOT_OPENED);
  let offer: unknown;
  try {
    offer = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  } catch {
    throw failed();
  }
  const fields = ["v", "type", "deviceId", "deviceKey", "name", "platform", "statementVersion"];
  if (!hasExactly(offer, fields)) throw failed();
  if (offer.v !== LINK_VERSION || offer.type !== "link-offer") throw failed();
  const { deviceId, deviceKey, name, platform, statementVersion } = offer;
  if (
    typeof deviceId !== "string" ||
    typeof deviceKey !== "string" ||
    typeof name !== "string" ||
    typeof platform !== "string" ||
    typeof statementVersion !== "number" ||
    !Number.isInteger(statementVersion) ||
    statementVersion < 0 ||
    statementVersion > 0xffffffff
  ) {
    throw failed();
  }
  return { deviceId, deviceKey, name, platform, statementVersion };
}

/** The old device's answer as sealed: the certificate exactly as sent to `addDeviceKey`. */
export function answerPlaintext(certificate: { payload: string; signature: string }): Uint8Array {
  return utf8(
    JSON.stringify({
      v: LINK_VERSION,
      type: "link-answer",
      certificate: { payload: certificate.payload, signature: certificate.signature },
    }),
  );
}

function hasExactly(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

/**
 * The certificate in an opened answer. Unknown fields and a wrong version or type are refused;
 * a malformed plaintext reads like one that did not open.
 */
export function answerCertificate(plaintext: Uint8Array): { payload: string; signature: string } {
  const failed = () => new LinkChannelError(NOT_OPENED);
  let answer: unknown;
  try {
    answer = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  } catch {
    throw failed();
  }
  if (!hasExactly(answer, ["v", "type", "certificate"])) throw failed();
  if (answer.v !== LINK_VERSION || answer.type !== "link-answer") throw failed();
  const certificate = answer.certificate;
  if (!hasExactly(certificate, ["payload", "signature"])) throw failed();
  const { payload, signature } = certificate;
  if (typeof payload !== "string" || typeof signature !== "string") throw failed();
  return { payload, signature };
}
