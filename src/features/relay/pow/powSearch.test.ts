import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import vectors from "../../../../protocol/pow-vectors.json";
import { nonceText, PowHasher, powPrefix, searchPow } from "./powSearch";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(counter));
  return bytes;
}

describe("the proof-of-work search", () => {
  it("reproduces the server's vector: 16 bits at the vector relay", () => {
    const relay = "rims1_T5LLFxkrobgyvlf3WVxuvLlfqYSZAssRFgmvCfI2R-c";
    const inception =
      '{"v":2,"type":"inception","seq":0,"identityKey":"ed25519:iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}';
    const counter = searchPow(relay, inception, 16);
    expect(counter).toBe(37283);
    expect(nonceText(counter)).toBe("AAAAAAAAkaM");
    expect(hex(new PowHasher(powPrefix(relay, inception)).digest(counter))).toBe(
      "00002f63d137749fda27201ccf9d282a4ed846287d49c55fea89a47617e78ed6",
    );
  });

  // The desktop's search finds the same vectors, so both platforms send the same nonce.
  it.each(vectors.cases.map((c) => [c.description, c] as const))("finds %s", (_, c) => {
    const counter = searchPow(c.serverId, c.inceptionPayload, c.bits);
    expect(counter).toBe(c.counter);
    expect(nonceText(counter)).toBe(c.nonce);
    expect(hex(new PowHasher(powPrefix(c.serverId, c.inceptionPayload)).digest(counter))).toBe(
      c.hash,
    );
  });

  it("hashes like SHA-256 for every prefix length across two blocks", () => {
    for (let length = 0; length < 140; length++) {
      const prefix = new Uint8Array(length).map((_, i) => (i * 31 + length) & 0xff);
      const hasher = new PowHasher(prefix);
      for (const counter of [0, 1, 0xffffffff, 0x1_0000_0000, 2 ** 40 + 12345]) {
        const expected = createHash("sha256").update(prefix).update(counterBytes(counter));
        expect(hex(hasher.digest(counter))).toBe(expected.digest("hex"));
      }
    }
  });

  it("encodes a counter as 8 big-endian bytes", () => {
    expect(nonceText(0)).toBe("AAAAAAAAAAA");
    expect(nonceText(2 ** 32 + 1)).toBe("AAAAAQAAAAE");
  });

  it("ends without a nonce when told to stop", () => {
    let asked = 0;
    expect(searchPow("rims1_x", "{}", 40, () => ++asked < 3)).toBe(-1);
    expect(asked).toBe(3);
  });
});
