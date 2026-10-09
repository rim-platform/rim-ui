/**
 * A principal's fingerprint: what two people compare, out of band, to know an account is the
 * one they mean. `base32(first 10 bytes of SHA-256("rim.principal-fingerprint.v1\0" ||
 * principal id))`, in four groups of four.
 */

import { base32, concat, sha256, utf8 } from "../../key-identity/browser/bytes";

const DOMAIN = utf8("rim.principal-fingerprint.v1\0");

export async function principalFingerprint(principalId: string): Promise<string> {
  const digest = await sha256(concat(DOMAIN, utf8(principalId)));
  const text = base32(digest.subarray(0, 10));
  return text.match(/.{4}/g)?.join("-") ?? text;
}
