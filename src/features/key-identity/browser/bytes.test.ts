import { describe, expect, it } from "vitest";

import { fromHex, hex } from "../../../test/ed25519";
import { b64, base32, unb64 } from "./bytes";

describe("base64url", () => {
  it("round-trips every length without padding", () => {
    for (let n = 0; n <= 34; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const text = b64(bytes);
      expect(text).not.toContain("=");
      expect(hex(unb64(text) as Uint8Array)).toBe(hex(bytes));
    }
    expect(b64(fromHex("000102030405060708090a0b0c0d0e0f"))).toBe("AAECAwQFBgcICQoLDA0ODw");
    expect(b64(fromHex("fbff"))).toBe("-_8");
  });

  it("decodes strictly", () => {
    expect(unb64("AAECAwQFBgcICQoLDA0ODw")).not.toBeNull();
    // Padding, the standard alphabet, whitespace, an impossible length, trailing bits.
    expect(unb64("AAECAwQFBgcICQoLDA0ODw==")).toBeNull();
    expect(unb64("+/8")).toBeNull();
    expect(unb64("AAEC AwQF")).toBeNull();
    expect(unb64("AAECA")).toBeNull();
    expect(unb64("AAECAwQFBgcICQoLDA0ODx")).toBeNull();
    expect(unb64("-_9")).toBeNull();
    expect(hex(unb64("") as Uint8Array)).toBe("");
  });
});

describe("base32", () => {
  it("is RFC 4648, uppercase, without padding", () => {
    expect(base32(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
    expect(base32(fromHex("848b7a9d80"))).toBe("QSFXVHMA");
  });
});
