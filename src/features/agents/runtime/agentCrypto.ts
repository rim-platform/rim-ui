/** The random values and hashes of pairing an agent. */

import { toB64 } from "../../../core/accountVault/crypto";

/** Fills `target` with random bytes. */
export type RandomFill = (target: Uint8Array<ArrayBuffer>) => void;

const UINT32_RANGE = 2 ** 32;
const CODE_RANGE = 1_000_000;
/** The largest multiple of {@link CODE_RANGE} a 32-bit value can reach: values from here on bias. */
const CODE_LIMIT = UINT32_RANGE - (UINT32_RANGE % CODE_RANGE);

/** Random bytes from the platform's secure source. */
export const secureRandom: RandomFill = (target) => {
  crypto.getRandomValues(target);
};

/**
 * A random token.
 *
 * @param bytes - How many random bytes it holds.
 * @param random - Where the bytes come from.
 * @returns The bytes in unpadded base64url.
 */
export function randomToken(bytes: number, random: RandomFill = secureRandom): string {
  const target = new Uint8Array(bytes);
  random(target);
  return toB64(target);
}

/**
 * Hashes text.
 *
 * @returns The SHA-256 of `text`'s UTF-8 bytes, in unpadded base64url.
 */
export async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toB64(new Uint8Array(digest));
}

/**
 * A six-digit code with every value equally likely: a 32-bit value past the last whole multiple
 * of the range is thrown away and drawn again.
 *
 * @param random - Where the bytes come from.
 * @returns The code, with its leading zeros.
 */
export function sixDigitCode(random: RandomFill = secureRandom): string {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  let value: number;
  do {
    random(bytes);
    value = view.getUint32(0);
  } while (value >= CODE_LIMIT);
  return String(value % CODE_RANGE).padStart(6, "0");
}
