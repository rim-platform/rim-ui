import { describe, expect, it } from "vitest";

import { fromHex, hex } from "../../../test/ed25519";
import { b64, unb64 } from "../../key-identity/browser/bytes";
import { attachmentKeyAndNonce, decryptFile, encryptFile } from "./attachments";

// e2ee-mls-v1 appendix A.3.
const SECRET = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);
const PLAINTEXT = new TextEncoder().encode("hello, attachment\n");
const BLOB = "096d52fa9b833e37ef33d387fc5ecab34eabb410807b85e90c862a44614c7c9cb163";
const BLOB_SHA256 = "EHFcZ6hUOIdDi32ptdrCXM2PTHQwKF46-0Ls56yQrac";

describe("encrypted attachments with WebCrypto", () => {
  it("match appendix A.3 byte for byte", async () => {
    expect(b64(SECRET)).toBe("oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8");
    const { key, nonce } = await attachmentKeyAndNonce(SECRET);
    expect(hex(key)).toBe("b03b51201f06749186a1768c665aaa48570ab7c6f42886d09ab5a97116b15b8f");
    expect(hex(nonce)).toBe("306c91d469a72d1e1b19c711");

    const { entry, blob } = await encryptFile(PLAINTEXT, "hello.txt", "text/plain", SECRET);
    expect(hex(blob)).toBe(BLOB);
    expect(entry).toEqual({
      blobSha256: BLOB_SHA256,
      secret: b64(SECRET),
      name: "hello.txt",
      mime: "text/plain",
      size: 18,
    });
    expect(hex(await decryptFile(entry, fromHex(BLOB)))).toBe(hex(PLAINTEXT));
  });

  it("refuse a blob that is not the one the message names, or does not decrypt", async () => {
    const { entry, blob } = await encryptFile(PLAINTEXT, "hello.txt", "text/plain");
    const flipped = blob.slice();
    flipped[0] ^= 1;
    await expect(decryptFile(entry, flipped)).rejects.toThrow("does not match its message");

    const other = await encryptFile(PLAINTEXT, "hello.txt", "text/plain");
    const wrongSecret = { ...entry, secret: other.entry.secret };
    await expect(decryptFile(wrongSecret, blob)).rejects.toThrow("does not decrypt");

    await expect(decryptFile({ ...entry, size: 17 }, blob)).rejects.toThrow("not the size");
  });

  it("use a fresh secret per file", async () => {
    const a = await encryptFile(PLAINTEXT, "a.txt", "text/plain");
    const b = await encryptFile(PLAINTEXT, "a.txt", "text/plain");
    expect(a.entry.secret).not.toBe(b.entry.secret);
    expect(unb64(a.entry.secret)).toHaveLength(32);
    expect(a.entry.blobSha256).not.toBe(b.entry.blobSha256);
  });
});
