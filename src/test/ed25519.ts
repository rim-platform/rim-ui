/**
 * Ed25519 keys from fixed seeds for tests, through Node's WebCrypto: the known-answer vectors'
 * keys are `SigningKey::from_bytes([seed; 32])`.
 */

const PKCS8_ED25519_PREFIX = [
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
];

export interface SeedKey {
  privateKey: CryptoKey;
  /** Tagged public key, `ed25519:<base64url>`. */
  publicKey: string;
}

/** The key whose 32-byte seed is `seed` repeated. */
export async function keyFromSeed(seed: number): Promise<SeedKey> {
  const pkcs8 = new Uint8Array([...PKCS8_ED25519_PREFIX, ...new Array<number>(32).fill(seed)]);
  const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, [
    "sign",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  return { privateKey, publicKey: `ed25519:${jwk.x}` };
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(text: string): Uint8Array {
  return Uint8Array.from(text.match(/../g) ?? [], (h) => parseInt(h, 16));
}
