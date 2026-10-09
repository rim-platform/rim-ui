import { describe, expect, it } from "vitest";

import { readSignatureFile, signatureFileStem, writeSignatureFile } from "./signatureFile";
import { INCEPTION, SIGNED_HELLO_WEB } from "./testing/signedHelloWeb";

describe("signature files", () => {
  it("round-trips a statement and the publisher's key log", () => {
    const text = writeSignatureFile({ statement: SIGNED_HELLO_WEB, publisherKeyLog: [INCEPTION] });
    expect(JSON.parse(text)).toMatchObject({ format: "rim-plugin-signature", v: 1 });
    expect(readSignatureFile(text)).toEqual({
      statement: SIGNED_HELLO_WEB,
      publisherKeyLog: [INCEPTION],
    });
    expect(signatureFileStem("dev.example.hello-web", "0.1.0")).toBe("dev.example.hello-web-0.1.0");
  });

  it("refuses anything else", () => {
    expect(() => readSignatureFile("{")).toThrow(/not JSON/);
    expect(() => readSignatureFile('{"format":"rim-plugin-bundle","v":1}')).toThrow(/format/);
    const good = writeSignatureFile({ statement: SIGNED_HELLO_WEB, publisherKeyLog: [] });
    expect(() => readSignatureFile(good.replace("{", '{"extra":1,'))).toThrow(/unknown field/);
    expect(() => readSignatureFile(good.replace("{", '{"v":2,'))).toThrow(/twice/);
  });
});
