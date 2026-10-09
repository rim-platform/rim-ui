/**
 * Encrypted attachments with WebCrypto: AES-256-GCM under a per-file secret, the key and nonce
 * derived with HKDF-SHA256, the blob the ciphertext with its 16-byte tag appended and pinned by
 * its SHA-256.
 *
 * An encrypted file's content entry (with its secret) waits here, by blob hash, until the
 * message that carries it is encrypted.
 */

import { b64, sameBytes, sha256, unb64, utf8 } from "../../key-identity/browser/bytes";

const KEY_INFO = utf8("rim.e2ee.attachment.v1 key");
const NONCE_INFO = utf8("rim.e2ee.attachment.v1 nonce");
const AAD = utf8("rim.e2ee.attachment.v1");
/** The largest blob the server takes (25 MiB); the plaintext is 16 bytes less. */
export const MAX_BLOB_BYTES = 25 * 1024 * 1024;
/** How long an encrypted file's entry waits for its message. */
const PENDING_TTL_MS = 60 * 60_000;

/** A file's content entry, as the message content carries it. */
export interface AttachmentEntry {
  blobSha256: string;
  secret: string;
  name: string;
  mime: string;
  size: number;
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

async function hkdf(secret: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", secret as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: info as BufferSource },
    ikm,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/** The AES-256-GCM key bytes and the 12-byte nonce of a file secret. */
export async function attachmentKeyAndNonce(
  secret: Uint8Array,
): Promise<{ key: Uint8Array; nonce: Uint8Array }> {
  return { key: await hkdf(secret, KEY_INFO, 32), nonce: await hkdf(secret, NONCE_INFO, 12) };
}

async function aesKey(secret: Uint8Array): Promise<{ key: CryptoKey; nonce: Uint8Array }> {
  const { key, nonce } = await attachmentKeyAndNonce(secret);
  return {
    key: await crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]),
    nonce,
  };
}

/** Encrypt a file under `secret` (fresh random bytes unless given). */
export async function encryptFile(
  plaintext: Uint8Array,
  name: string,
  mime: string,
  secret: Uint8Array = crypto.getRandomValues(new Uint8Array(32)),
): Promise<{ entry: AttachmentEntry; blob: Uint8Array }> {
  if (plaintext.byteLength > MAX_BLOB_BYTES - 16) {
    throw new AttachmentError("files are limited to 25 MB");
  }
  const { key, nonce } = await aesKey(secret);
  const blob = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: AAD as BufferSource },
      key,
      plaintext as BufferSource,
    ),
  );
  return {
    entry: {
      blobSha256: b64(await sha256(blob)),
      secret: b64(secret),
      name,
      mime,
      size: plaintext.byteLength,
    },
    blob,
  };
}

/** Check a downloaded blob's hash, decrypt it, and check the size the entry states. */
export async function decryptFile(entry: AttachmentEntry, blob: Uint8Array): Promise<Uint8Array> {
  const expected = unb64(entry.blobSha256);
  const secret = unb64(entry.secret);
  if (!expected || !secret || secret.length !== 32) {
    throw new AttachmentError("the attachment entry is malformed");
  }
  if (!sameBytes(await sha256(blob), expected)) {
    throw new AttachmentError("the file does not match its message");
  }
  const { key, nonce } = await aesKey(secret);
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce as BufferSource, additionalData: AAD as BufferSource },
        key,
        blob as BufferSource,
      ),
    );
  } catch {
    throw new AttachmentError("the file does not decrypt");
  }
  if (plaintext.byteLength !== entry.size) {
    throw new AttachmentError("the file is not the size its message states");
  }
  return plaintext;
}

const pending = new Map<string, { entry: AttachmentEntry; at: number }>();

/** Keep a file's entry until its message is encrypted. */
export function keepPending(entry: AttachmentEntry) {
  const now = Date.now();
  for (const [hash, kept] of pending) if (now - kept.at > PENDING_TTL_MS) pending.delete(hash);
  pending.set(entry.blobSha256, { entry, at: now });
}

export function pendingEntry(blobSha256: string): AttachmentEntry | null {
  return pending.get(blobSha256)?.entry ?? null;
}

export function forgetPending(hashes: string[]) {
  for (const hash of hashes) pending.delete(hash);
}
