/**
 * The keys a password unlocks on the web, and the AES-256-GCM values sealed under them, byte for
 * byte as the desktop's `rim_opaque::keys` makes them:
 *
 * - recovery wrap key: `HKDF-SHA256(ikm = the phrase's 16 bytes, salt = "rim.recovery-phrase.v1",
 *   info = "data key wrap")`;
 * - store key: `HKDF-SHA256(ikm = data key, salt = "rim.store.v1", info = "web stores")`;
 * - device key wrap key: `HKDF-SHA256(ikm = server share, salt = "rim.device-key.v1",
 *   info = principal id)`.
 *
 * The transport key and the unlock key come from the OPAQUE module (`transportKey`,
 * `unlockKey`). Every sealed value is `nonce (12) ‖ ciphertext ‖ tag (16)` under a random nonce.
 * A wrap of the data key authenticates `"rim.dk.v1|<kind>|<principal id>"`, a rewrap of an old
 * unlock key `"rim.uk-rewrap.v1|<principal id>"`, a wrap of the device key's seed
 * `"rim.device-key.v1|<principal id>"`, a transport value nothing.
 */

import { b64, unb64, utf8 } from "../../features/key-identity/browser/bytes";

/** Length of every key this module derives or wraps. */
export const KEY_LEN = 32;
/** Length of the random AES-GCM nonce that starts every sealed value. */
export const NONCE_LEN = 12;
/** Length of the AES-GCM tag that ends every sealed value. */
export const TAG_LEN = 16;
/** Length of a recovery phrase's entropy. */
export const RECOVERY_ENTROPY_LEN = 16;

const RECOVERY_SALT = utf8("rim.recovery-phrase.v1");
const RECOVERY_WRAP_INFO = utf8("data key wrap");
const STORE_SALT = utf8("rim.store.v1");
const WEB_STORES_INFO = utf8("web stores");
const DEVICE_KEY_SALT = utf8("rim.device-key.v1");

/** Which key a wrap of the data key is sealed under. */
export type WrapKind = "password" | "recovery" | "keep";

/** A sealed value or key did not open: a wrong key, associated data or byte. */
export class UnauthenticError extends Error {
  constructor() {
    super("a sealed value did not open");
    this.name = "UnauthenticError";
  }
}

/** A copy of `bytes` in its own `ArrayBuffer`, as WebCrypto takes it. */
function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/**
 * HKDF-SHA256 of `ikm` with `salt` and `info`, 32 bytes.
 *
 * @returns The derived bytes.
 */
export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", own(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: own(salt), info: own(info) },
    base,
    KEY_LEN * 8,
  );
  return new Uint8Array(bits);
}

/**
 * A non-extractable AES-256-GCM key of `raw`.
 *
 * @param raw - 32 bytes.
 * @param usages - What the key may do.
 */
export function aesKey(
  raw: Uint8Array,
  usages: KeyUsage[] = ["encrypt", "decrypt"],
): Promise<CryptoKey> {
  if (raw.length !== KEY_LEN) throw new Error(`a key must be ${KEY_LEN} bytes`);
  return crypto.subtle.importKey("raw", own(raw), { name: "AES-GCM" }, false, usages);
}

/** 32 fresh random bytes: a new data key. */
export function randomKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(KEY_LEN));
}

async function keyOf(key: Uint8Array | CryptoKey): Promise<CryptoKey> {
  return key instanceof Uint8Array ? aesKey(key) : key;
}

/**
 * Seals `plaintext` under `key` with a random nonce, authenticating `aad` too.
 *
 * @returns `nonce ‖ ciphertext ‖ tag`.
 */
export async function seal(
  key: Uint8Array | CryptoKey,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: own(aad) },
    await keyOf(key),
    own(plaintext),
  );
  const out = new Uint8Array(NONCE_LEN + sealed.byteLength);
  out.set(nonce);
  out.set(new Uint8Array(sealed), NONCE_LEN);
  return out;
}

/**
 * Opens a value {@link seal} made.
 *
 * @returns The plaintext.
 * @throws UnauthenticError when the key, `aad` or a byte is wrong, or `sealed` is too short.
 */
export async function open(
  key: Uint8Array | CryptoKey,
  aad: Uint8Array,
  sealed: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (sealed.length < NONCE_LEN + TAG_LEN) throw new UnauthenticError();
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: own(sealed.subarray(0, NONCE_LEN)), additionalData: own(aad) },
      await keyOf(key),
      own(sealed.subarray(NONCE_LEN)),
    );
    return new Uint8Array(plain);
  } catch {
    throw new UnauthenticError();
  }
}

function key32(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.length !== KEY_LEN) {
    bytes.fill(0);
    throw new UnauthenticError();
  }
  return own(bytes);
}

/**
 * Decodes unpadded base64url.
 *
 * @param what - What the text holds, for the error.
 * @throws Error when `text` is not unpadded base64url.
 */
export function fromB64(text: string, what: string): Uint8Array<ArrayBuffer> {
  const bytes = unb64(text.trim());
  if (!bytes) throw new Error(`${what} is not base64url`);
  return own(bytes);
}

/** Unpadded base64url of `bytes`. */
export const toB64 = b64;

/**
 * Opens a value the server sealed under a login's transport key (empty associated data).
 *
 * @param transport - The 32-byte transport key of the value's label.
 * @param sealed - The value as the server sent it, base64url.
 */
export function openTransport(transport: Uint8Array, sealed: string): Promise<Uint8Array> {
  return open(transport, new Uint8Array(), fromB64(sealed, "a sealed server value"));
}

function dataKeyAad(kind: WrapKind, principalId: string) {
  return utf8(`rim.dk.v1|${kind}|${principalId}`);
}

/**
 * The wrap of `dataKey` under `key`, bound to `kind` and `principalId`.
 *
 * @returns `nonce ‖ ciphertext ‖ tag`.
 */
export function wrapDataKey(
  key: Uint8Array,
  kind: WrapKind,
  principalId: string,
  dataKey: Uint8Array,
): Promise<Uint8Array> {
  return seal(key, dataKeyAad(kind, principalId), dataKey);
}

/**
 * The data key a wrap of `kind` for `principalId` holds.
 *
 * @throws UnauthenticError when it does not open or does not hold 32 bytes.
 */
export async function unwrapDataKey(
  key: Uint8Array,
  kind: WrapKind,
  principalId: string,
  wrap: Uint8Array,
): Promise<Uint8Array> {
  return key32(await open(key, dataKeyAad(kind, principalId), wrap));
}

/**
 * The old unlock key a rewrap holds, opened with the unlock key after the change.
 *
 * @throws UnauthenticError when it does not open or does not hold 32 bytes.
 */
export async function unwrapRewrap(
  newUnlockKey: Uint8Array,
  principalId: string,
  rewrap: Uint8Array,
): Promise<Uint8Array> {
  return key32(await open(newUnlockKey, utf8(`rim.uk-rewrap.v1|${principalId}`), rewrap));
}

/** The key of the recovery wrap, from a recovery phrase's entropy. */
export function recoveryWrapKey(entropy: Uint8Array): Promise<Uint8Array> {
  if (entropy.length !== RECOVERY_ENTROPY_LEN) {
    throw new Error(`the recovery entropy must be ${RECOVERY_ENTROPY_LEN} bytes`);
  }
  return hkdf(RECOVERY_SALT, entropy, RECOVERY_WRAP_INFO);
}

/** The bytes of the key that seals the IndexedDB records under `dataKey`. */
export function webStoreKey(dataKey: Uint8Array): Promise<Uint8Array> {
  return hkdf(STORE_SALT, dataKey, WEB_STORES_INFO);
}

/** The key that wraps `principalId`'s device key seed, from the server share. */
export function deviceKeyWrapKey(share: Uint8Array, principalId: string): Promise<Uint8Array> {
  return hkdf(DEVICE_KEY_SALT, share, utf8(principalId));
}

function deviceKeyAad(principalId: string) {
  return utf8(`rim.device-key.v1|${principalId}`);
}

/**
 * The wrap of `principalId`'s device key seed under `key`, from {@link deviceKeyWrapKey}.
 *
 * @returns `nonce ‖ ciphertext ‖ tag`.
 */
export function wrapDeviceSeed(
  key: Uint8Array,
  principalId: string,
  seed: Uint8Array,
): Promise<Uint8Array> {
  return seal(key, deviceKeyAad(principalId), seed);
}

/**
 * The device key seed a wrap for `principalId` holds.
 *
 * @throws UnauthenticError when it does not open or does not hold 32 bytes.
 */
export async function unwrapDeviceSeed(
  key: Uint8Array,
  principalId: string,
  wrap: Uint8Array,
): Promise<Uint8Array> {
  return key32(await open(key, deviceKeyAad(principalId), wrap));
}
