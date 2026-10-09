/**
 * Byte helpers of the browser key backend: strict unpadded base64url (RFC 4648 §5), RFC 4648
 * base32 and UTF-8, written to refuse exactly what the Tauri side's decoders refuse.
 */

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE64URL_VALUES = new Map([...BASE64URL].map((c, i) => [c, i]));
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Unpadded base64url. */
export function b64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += BASE64URL[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

/**
 * Decode unpadded base64url strictly: no padding, no other characters, no impossible length,
 * and the unused trailing bits zero. `null` when `text` breaks any rule.
 */
export function unb64(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const c of text) {
    const v = BASE64URL_VALUES.get(c);
    if (v === undefined) return null;
    value = ((value << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  if ((value & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

/** RFC 4648 base32, uppercase, no padding. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function utf8(text: string): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(text));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
