import { describe, expect, it } from "vitest";

import { fromHex } from "../../../test/ed25519";
import { BIP39_ENGLISH } from "./bip39English";
import { base32, concat, sha256, utf8 } from "./bytes";
import {
  formatKit,
  generateEntropy,
  parseKit,
  parseRecoveryKey,
  parseRecoveryPhrase,
  parseRecoverySecret,
  phraseRecoveryKey,
  phraseWords,
  signPasswordReset,
} from "./recoveryKit";
import { CONTEXT, sign, verify } from "./statements";

// key-identity-v1.md, "Recovery kit": the known-answer vector of the recovery phrase.
const ENTROPY = "000102030405060708090a0b0c0d0e0f";
const PHRASE = "abandon amount liar amount expire adjust cage candy arch gather drum buyer";
const PHRASE_KEY = "ed25519:K2c3c55QDKnCUKWO8yTdZm25JIT20PKr5vaNC91F4cw";
// Appendix A: the recovery key of seed 101, which a version 1 kit spells as `RK1-…`.
const V1_RECOVERY_KEY = "ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg";
const PRINCIPAL = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";

/** A version 1 recovery key as older clients wrote it: `RK1-` and base32 in groups of 4. */
async function rk1(seed: Uint8Array): Promise<string> {
  const check = (await sha256(concat(utf8("rim.recovery-kit.v1\0"), seed))).subarray(0, 3);
  const groups = base32(concat(seed, check)).match(/.{1,4}/g) ?? [];
  return ["RK1", ...groups].join("-");
}

const SEED_101 = new Uint8Array(32).fill(101);

describe("the recovery phrase", () => {
  it("matches the spec's vector: the words and the recovery key", async () => {
    expect((await phraseWords(fromHex(ENTROPY))).join(" ")).toBe(PHRASE);
    expect((await phraseRecoveryKey(fromHex(ENTROPY))).publicKey).toBe(PHRASE_KEY);
    expect(await parseRecoveryPhrase(PHRASE)).toEqual(fromHex(ENTROPY));
  });

  it("uses the standard BIP39 English list", () => {
    expect(BIP39_ENGLISH).toHaveLength(2048);
    expect(BIP39_ENGLISH[0]).toBe("abandon");
    expect(BIP39_ENGLISH[2047]).toBe("zoo");
  });

  it("round-trips fresh entropy through its words", async () => {
    const entropy = generateEntropy();
    expect(entropy).toHaveLength(16);
    expect(await parseRecoveryPhrase((await phraseWords(entropy)).join(" "))).toEqual(entropy);
  });

  it("writes the version 2 kit the desktop writes", async () => {
    expect(await formatKit(PRINCIPAL, fromHex(ENTROPY))).toBe(
      `RIM recovery kit (v2)\nAccount id: ${PRINCIPAL}\nRecovery phrase: ${PHRASE}\n`,
    );
  });

  it("reads a whole kit, case, line breaks and numbering as copied from a list", async () => {
    const numbered = PHRASE.toUpperCase()
      .split(" ")
      .map((word, i) =>
        i % 3 === 0 ? `${i + 1}. ${word}` : i % 3 === 1 ? `${i + 1})${word}` : `${i + 1}\n${word}`,
      )
      .join("  ");
    for (const text of [await formatKit(PRINCIPAL, fromHex(ENTROPY)), numbered]) {
      expect(await parseRecoveryPhrase(text)).toEqual(fromHex(ENTROPY));
    }
  });

  it("refuses the wrong length, a word off the list, and a typo the checksum catches", async () => {
    const words = PHRASE.split(" ");
    await expect(parseRecoveryPhrase("")).rejects.toThrow(/paste the recovery kit/);
    await expect(parseRecoveryPhrase(words.slice(1).join(" "))).rejects.toThrow(
      "a recovery phrase has 12 words; this one has 11",
    );
    const offList = [...words];
    offList[4] = "Zzzq";
    await expect(parseRecoveryPhrase(offList.join(" "))).rejects.toThrow(
      'word 5 of the recovery phrase, "zzzq", is not in the word list',
    );
    const swapped = [...words];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    await expect(parseRecoveryPhrase(swapped.join(" "))).rejects.toThrow(/has a typo/);
  });

  it("gives a non-extractable recovery key that signs for its public key", async () => {
    const key = await phraseRecoveryKey(fromHex(ENTROPY));
    expect(key.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", key.privateKey)).rejects.toThrow();
    const signed = await sign(key.privateKey, CONTEXT.keyLog, "{}");
    expect(await verify(signed, CONTEXT.keyLog, PHRASE_KEY, 2)).toBe(true);
  });
});

describe("the version 1 recovery key", () => {
  it("is still read, forgiving case, spacing and the 0/O and 1/I mix-ups", async () => {
    const key = await rk1(SEED_101);
    expect(key).toMatch(/^RK1(-[A-Z2-7]{4}){14}$/);
    expect(await parseRecoveryKey(key)).toEqual(SEED_101);
    const sloppy = key.toLowerCase().replace(/-/g, " ").replace(/o/g, "0").replace(/i/g, "1");
    expect(await parseRecoveryKey(sloppy)).toEqual(SEED_101);
  });

  it("refuses a key without its prefix, cut short, or with a typo", async () => {
    const key = await rk1(SEED_101);
    await expect(parseRecoveryKey(key.slice(4))).rejects.toThrow("a recovery key starts with RK1");
    await expect(parseRecoveryKey(key.slice(0, -5))).rejects.toThrow(/incomplete or mistyped/);
    const typo = `${key.slice(0, 5)}${key[5] === "A" ? "B" : "A"}${key.slice(6)}`;
    await expect(parseRecoveryKey(typo)).rejects.toThrow(/check characters do not match/);
  });
});

describe("reading a pasted kit", () => {
  it("tells the versions apart by content and gives the recovery key", async () => {
    const v1 = `RIM recovery kit (v1)\nAccount id: ${PRINCIPAL}\nRecovery key: ${await rk1(SEED_101)}\n`;
    expect((await parseRecoverySecret(v1)).publicKey).toBe(V1_RECOVERY_KEY);
    // A v2 header over a v1 key still reads the key: the header line does not decide.
    expect((await parseRecoverySecret(v1.replace("(v1)", "(v2)"))).publicKey).toBe(V1_RECOVERY_KEY);
    expect((await parseRecoverySecret(PHRASE)).publicKey).toBe(PHRASE_KEY);
  });

  it("takes the account id from its own field, else from the kit", async () => {
    const kit = await formatKit(PRINCIPAL, fromHex(ENTROPY));
    expect((await parseKit(kit, null)).principalId).toBe(PRINCIPAL);
    const other = `rimp1_${"b".repeat(43)}`;
    expect((await parseKit(kit, ` ${other} `)).principalId).toBe(other);
    await expect(parseKit(PHRASE, "")).rejects.toThrow(/has no account id/);
    await expect(parseKit(PHRASE, "rimp1_short")).rejects.toThrow(/rimp1_ and 43 more/);
  });
});

describe("signPasswordReset", () => {
  it("signs a password-reset statement with the phrase's recovery key, for this purpose only", async () => {
    const entropy = new Uint8Array(16).fill(9);
    const statement = await signPasswordReset("https://rim.example/api", "rimp1_ada", entropy, {
      challengeId: "c-1",
      nonce: "bm9uY2U",
    });
    expect(JSON.parse(statement.payload)).toEqual({
      v: 2,
      type: "password-reset",
      principalId: "rimp1_ada",
      challengeId: "c-1",
      nonce: "bm9uY2U",
      audience: "rim.example",
    });
    const { publicKey } = await phraseRecoveryKey(entropy);
    expect(await verify(statement, CONTEXT.passwordReset, publicKey, 2)).toBe(true);
    expect(await verify(statement, CONTEXT.login, publicKey, 2)).toBe(false);
  });
});
