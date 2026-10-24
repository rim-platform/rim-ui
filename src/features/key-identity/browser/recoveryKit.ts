/**
 * The recovery kit in the browser, as the Tauri side's `recovery_kit.rs` reads and writes it.
 *
 * This browser writes version 2, a 12-word recovery phrase:
 *
 * ```text
 * RIM recovery kit (v2)
 * Account id: rimp1_…
 * Recovery phrase: word1 word2 … word12
 * ```
 *
 * The phrase is the BIP39 English encoding of 16 random bytes; the recovery key is the Ed25519
 * key whose seed is HKDF-SHA256 of those bytes (salt `rim.recovery-phrase.v1`, info
 * `recovery key`), not BIP39's PBKDF2 seed. Version 1, a `RK1-` base32 seed with 3 check bytes,
 * is still read. Readers tell the two apart by content, not by the header line.
 *
 * The recovery key is derived when it is needed and imported as a non-extractable `CryptoKey`;
 * it is never stored.
 */

import { BIP39_ENGLISH } from "./bip39English";
import { concat, sameBytes, sha256, utf8 } from "./bytes";
import { audience } from "./naming";
import { signPasswordReset as signReset, type Statement } from "./statements";

const PRINCIPAL_PREFIX = "rimp1_";
/** A principal id: the prefix and 43 base64url characters. */
const PRINCIPAL_LEN = PRINCIPAL_PREFIX.length + 43;
const KEY_PREFIX = "RK1";
const CHECK_DOMAIN = utf8("rim.recovery-kit.v1\0");
const CHECK_LEN = 3;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PHRASE_SALT = utf8("rim.recovery-phrase.v1");
const PHRASE_INFO = utf8("recovery key");
const PHRASE_LABEL = "recovery phrase:";

/** Bytes of entropy behind a recovery phrase: 128 bits, 12 words. */
export const PHRASE_ENTROPY_LEN = 16;
/** Words in a recovery phrase. */
export const PHRASE_WORDS = 12;

/** The pkcs8 encoding of an Ed25519 private key, before its 32-byte seed. */
export const PKCS8_ED25519_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const WORD_INDEX = new Map(BIP39_ENGLISH.map((word, i) => [word, i]));

/** A kit, phrase or key this module refused; its message is ready to show. */
export class RecoveryKitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryKitError";
  }
}

/** A recovery key, ready to sign a recovery rotation. */
export interface RecoveryKey {
  /** Non-extractable Ed25519 private key. */
  privateKey: CryptoKey;
  /** Tagged public key, as the key log's `recoveryKey` holds it. */
  publicKey: string;
}

// ─── Version 2: the recovery phrase ─────────────────────────────────────────

/** Fresh entropy for a recovery phrase. */
export function generateEntropy(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(PHRASE_ENTROPY_LEN));
}

/** The 4 checksum bits BIP39 appends to 128 bits of entropy: SHA-256's first 4 bits. */
async function checksum(entropy: Uint8Array): Promise<number> {
  return (await sha256(entropy))[0] >> 4;
}

/** The 12 words of the phrase for `entropy`, in order. */
export async function phraseWords(entropy: Uint8Array): Promise<string[]> {
  if (entropy.length !== PHRASE_ENTROPY_LEN) {
    throw new RecoveryKitError("a recovery phrase holds 16 bytes");
  }
  const bits = [...entropy].map((b) => b.toString(2).padStart(8, "0")).join("");
  const all = bits + (await checksum(entropy)).toString(2).padStart(4, "0");
  const words: string[] = [];
  for (let i = 0; i < PHRASE_WORDS; i++) {
    words.push(BIP39_ENGLISH[parseInt(all.slice(i * 11, i * 11 + 11), 2)]);
  }
  return words;
}

/** The whole version 2 kit text shown to the person. */
export async function formatKit(principalId: string, entropy: Uint8Array): Promise<string> {
  const words = await phraseWords(entropy);
  return `RIM recovery kit (v2)\nAccount id: ${principalId}\nRecovery phrase: ${words.join(" ")}\n`;
}

/** A word as written, without numbering such as `1.` or `1)` in front; a bare number is empty. */
function withoutNumbering(token: string): string {
  const rest = token.replace(/^[0-9]+/, "");
  if (rest.length === token.length) return token;
  return rest.startsWith(".") || rest.startsWith(")") ? rest.slice(1) : rest;
}

/**
 * Read a recovery phrase, alone or inside a kit: ignores case, extra whitespace and line
 * breaks, numbering in front of words, and the kit's header and account id lines. Refuses a
 * phrase that is not 12 words, names the first word that is not in the word list, and refuses
 * one whose checksum fails. Returns the 16 bytes it spells.
 */
export async function parseRecoveryPhrase(text: string): Promise<Uint8Array> {
  const words: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const lower = line.trim().toLowerCase();
    if (
      lower.startsWith("rim recovery kit") ||
      lower.startsWith("account id") ||
      lower.includes(PRINCIPAL_PREFIX)
    ) {
      continue;
    }
    const rest = lower.startsWith(PHRASE_LABEL) ? lower.slice(PHRASE_LABEL.length) : lower;
    words.push(
      ...rest
        .split(/\s+/)
        .map(withoutNumbering)
        .filter((w) => w.length > 0),
    );
  }
  if (words.length === 0) {
    throw new RecoveryKitError(
      "paste the recovery kit, its 12-word recovery phrase or its RK1- recovery key",
    );
  }
  if (words.length !== PHRASE_WORDS) {
    throw new RecoveryKitError(
      `a recovery phrase has ${PHRASE_WORDS} words; this one has ${words.length}`,
    );
  }
  const indices: number[] = [];
  for (const [at, word] of words.entries()) {
    const index = WORD_INDEX.get(word);
    if (index === undefined) {
      throw new RecoveryKitError(
        `word ${at + 1} of the recovery phrase, "${word}", is not in the word list`,
      );
    }
    indices.push(index);
  }
  const bits = indices.map((i) => i.toString(2).padStart(11, "0")).join("");
  const entropy = new Uint8Array(PHRASE_ENTROPY_LEN);
  for (let i = 0; i < PHRASE_ENTROPY_LEN; i++) {
    entropy[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  if (parseInt(bits.slice(128), 2) !== (await checksum(entropy))) {
    throw new RecoveryKitError(
      "this recovery phrase has a typo: its words do not fit together. Check the spelling and the order of every word",
    );
  }
  return entropy;
}

/** The recovery key's 32-byte seed for a phrase's entropy: HKDF-SHA256, as the kit defines. */
async function phraseSeed(entropy: Uint8Array): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", entropy, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: PHRASE_SALT, info: PHRASE_INFO },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * The Ed25519 key of a 32-byte seed: its public key, and the private key imported
 * non-extractable. The seed and its PKCS#8 wrapping are overwritten once imported.
 */
async function keyFromSeed(seed: Uint8Array): Promise<RecoveryKey> {
  const pkcs8 = concat(PKCS8_ED25519_PREFIX, seed);
  try {
    // WebCrypto gives a private key's public half only through an export.
    const readable = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, [
      "sign",
    ]);
    const { x } = await crypto.subtle.exportKey("jwk", readable);
    if (!x) throw new RecoveryKitError("the recovery key could not be read");
    const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, [
      "sign",
    ]);
    return { privateKey, publicKey: `ed25519:${x}` };
  } finally {
    pkcs8.fill(0);
    seed.fill(0);
  }
}

/** The recovery key a phrase's entropy stands for. */
export async function phraseRecoveryKey(entropy: Uint8Array): Promise<RecoveryKey> {
  return keyFromSeed(await phraseSeed(entropy));
}

/**
 * A `password-reset` statement for `principalId` over a `passwordResetChallenge`, signed by the
 * recovery key of a phrase's entropy, for the server at `endpoint`.
 *
 * @param entropy - The phrase's 16 bytes.
 * @param challenge - The challenge `passwordResetChallenge` issued.
 * @returns The signed statement.
 */
export async function signPasswordReset(
  endpoint: string,
  principalId: string,
  entropy: Uint8Array,
  challenge: { challengeId: string; nonce: string },
): Promise<Statement> {
  const { privateKey } = await phraseRecoveryKey(entropy);
  return signReset(privateKey, {
    principalId,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    audience: audience(endpoint),
  });
}

// ─── Version 1: the RK1- recovery key ───────────────────────────────────────

async function checkBytes(seed: Uint8Array): Promise<Uint8Array> {
  return (await sha256(concat(CHECK_DOMAIN, seed))).subarray(0, CHECK_LEN);
}

/** RFC 4648 base32 without padding, strictly: leftover bits must be zero. */
function unbase32(text: string): Uint8Array | null {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of text) {
    const value = BASE32.indexOf(c);
    if (value < 0) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  return buffer === 0 ? Uint8Array.from(out) : null;
}

/** Read a version 1 recovery key, forgiving case, spaces, dashes and the 0/O and 1/I mix-ups. */
export async function parseRecoveryKey(text: string): Promise<Uint8Array> {
  const cleaned = text.replace(/[ \-\t\n\r]/g, "").toUpperCase();
  if (!cleaned.startsWith(KEY_PREFIX)) {
    throw new RecoveryKitError("a recovery key starts with RK1");
  }
  const body = cleaned.slice(KEY_PREFIX.length).replace(/0/g, "O").replace(/1/g, "I");
  const bytes = unbase32(body);
  if (!bytes || bytes.length !== 32 + CHECK_LEN) {
    throw new RecoveryKitError("this recovery key is incomplete or mistyped");
  }
  const seed = bytes.slice(0, 32);
  if (!sameBytes(bytes.subarray(32), await checkBytes(seed))) {
    throw new RecoveryKitError("this recovery key has a typo: its check characters do not match");
  }
  return seed;
}

/**
 * The version 1 recovery key in `text`, from its `RK1` on: the first line, other than the
 * account id's, with a word that starts with `RK1`. A phrase never has one.
 */
function v1KeyText(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (line.includes(PRINCIPAL_PREFIX)) continue;
    const upper = line.toUpperCase();
    for (let at = upper.indexOf(KEY_PREFIX); at >= 0; at = upper.indexOf(KEY_PREFIX, at + 1)) {
      const before = at === 0 ? "" : upper[at - 1];
      if (before === "" || before === ":" || /\s/.test(before)) return line.slice(at);
    }
  }
  return null;
}

// ─── Either version ─────────────────────────────────────────────────────────

/** The recovery key in a pasted kit or bare secret: a `RK1-` key (v1) or a 12-word phrase (v2). */
export async function parseRecoverySecret(text: string): Promise<RecoveryKey> {
  const key = v1KeyText(text);
  if (key !== null) return keyFromSeed(await parseRecoveryKey(key));
  const entropy = await parseRecoveryPhrase(text);
  try {
    return await phraseRecoveryKey(entropy);
  } finally {
    entropy.fill(0);
  }
}

function findPrincipalId(text: string): string | null {
  const at = text.indexOf(PRINCIPAL_PREFIX);
  if (at < 0) return null;
  return /^[A-Za-z0-9_-]*/.exec(text.slice(at))?.[0] ?? null;
}

/**
 * The account id and recovery key of a pasted kit, phrase or key. `accountId` comes from its
 * own field when the person typed it separately, else from the kit text.
 */
export async function parseKit(
  kit: string,
  accountId: string | null,
): Promise<{ principalId: string; recovery: RecoveryKey }> {
  const typed = accountId?.trim();
  const principalId = typed ? typed : findPrincipalId(kit);
  if (!principalId) {
    throw new RecoveryKitError("the kit has no account id (it starts with rimp1_)");
  }
  if (principalId.length !== PRINCIPAL_LEN || !principalId.startsWith(PRINCIPAL_PREFIX)) {
    throw new RecoveryKitError("an account id is rimp1_ and 43 more characters");
  }
  return { principalId, recovery: await parseRecoverySecret(kit) };
}
