import { describe, expect, it } from "vitest";

import { keyFromSeed } from "../../../test/ed25519";
import { b64, unb64 } from "./bytes";
import {
  canonicalKey,
  certificateClaim,
  certifiedDevice,
  CONTEXT,
  payloadHash,
  principalId,
  now,
  recoveredAfter,
  replay,
  sign,
  signDeviceCertificate,
  signInception,
  signLogin,
  signProfileCard,
  signRevocation,
  signRotation,
  usableDeviceKey,
  verifiedCard,
  verifiedRevocation,
  verify,
  type Statement,
} from "./statements";

// key-identity-v1.md, appendix B (version 2).
const IDENTITY = "ed25519:iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w";
const RECOVERY = "ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg";
const DEVICE = "ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc";
const PRINCIPAL = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";
const INCEPTION = `{"v":2,"type":"inception","seq":0,"identityKey":"ed25519:iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}`;
const INCEPTION_SIG =
  "ed25519:kGvSf1hR28cdKP2Smwmy2BHEdP7wmKwy0At-DtrUs8mYhfzF0jjHTjpeX4DAzXv5HuCVwFEYWM1DjN-6wkU2Ag";
const DEVICE_CERT = `{"v":2,"type":"device","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","keySeq":0,"issuedAt":"2026-10-09T00:00:00Z"}`;
const DEVICE_CERT_SIG =
  "ed25519:0HjRzn6gQ2q-vCHSkdOPK2ykGGBUpW2fYdDuEdTzf6OxsWzjXeNNpRSVgzPxOEfbYzZ9o9DWqp4NxcTEDhOaDA";
const LOGIN_PROOF = `{"v":2,"type":"login","challengeId":"00000000-0000-0000-0000-000000000009","nonce":"bm9uY2U","audience":"localhost:8080","principalId":"rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0","deviceId":"00000000-0000-0000-0000-000000000001"}`;
const LOGIN_SIG =
  "ed25519:3FSH7M9uz0sP42GA0gKPso6JmGSx32Y1WZ-oKBW0VcVWANGEEjkDjaEtDpHNIjdEgC5fFA2jbfzSmuzhW7k1Dg";
const DEVICE_ID = "00000000-0000-0000-0000-000000000001";

// Appendix A (version 1).
const V1_PRINCIPAL = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";
const V1_PREV = "o1oFYkMXfjtQJnG6as5GURR0cnzeYNYv5Br-LaeI78I";
const V1_INCEPTION = `{"v":1,"type":"inception","seq":0,"identityKey":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}`;
const V1_INCEPTION_SIG =
  "vf3zjxbHUJ8l9Oe6ayFGZZszVH1c_FVgO04F_4PqkfsYu9h8jAgbPKhAIAYHlQxg-7yAO5w1OEMmcAGcXptVDQ";
const V1_DEVICE_CERT = `{"v":1,"type":"device","principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","deviceId":"00000000-0000-0000-0000-000000000001","deviceKey":"IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc","name":"Laptop","keySeq":0,"issuedAt":"2026-10-09T00:00:00Z"}`;
const V1_DEVICE_CERT_SIG =
  "tt6UNl3tRCwupWIYEfnWzqW9qVqDsJju2dA7d2CdNqdIZ0piVeP_Q6Y1lLfA4YN-26tsdaFea-rM_I8Qy9H6Cg";
const V1_LOGIN_PROOF = `{"v":1,"type":"login","challengeId":"00000000-0000-0000-0000-000000000009","nonce":"bm9uY2U","audience":"localhost:8080","principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","deviceId":"00000000-0000-0000-0000-000000000001"}`;
const V1_LOGIN_SIG =
  "jB_BFFAn7e-FMh8wCSWhnCcPzMjoe1fTKwlCoGfE0p1OYkhZWjV4J1c_AgeIhKpWOnLYyB0PqstAEYmaCITXBw";

// Appendix B's mixed log: the version 1 inception, then a version 2 identity rotation.
const MIXED_ROTATION = `{"v":2,"type":"rotate","principalId":"rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo","seq":1,"prev":"o1oFYkMXfjtQJnG6as5GURR0cnzeYNYv5Br-LaeI78I","identityKey":"ed25519:gTl3Dqh9F19Wo1Rmw0x-zMuNipG07jeiXfYPW4_Js5Q","recoveryKey":"ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","signer":"identity","createdAt":"2026-10-09T00:00:00Z"}`;
const MIXED_ROTATION_SIG =
  "ed25519:D2moo9U9OjVL9zed4lM0A5cHoGQOVEtUfgKfAmOn0P18x74NEbh4FL4f3PbulQzoVuGAGOEJUZq3R2ZNpeUdCg";

const AT = "2026-10-09T00:00:00Z";

function statement(payload: string, signature: string): Statement {
  return { payload, signature };
}

/** A version 1 (untagged) signature over `payload`. */
async function signV1(seed: number, context: Uint8Array, payload: string): Promise<Statement> {
  const signed = await sign((await keyFromSeed(seed)).privateKey, context, payload);
  return { payload, signature: signed.signature.replace("ed25519:", "") };
}

async function rotation(
  head: { principalId: string; hash: string },
  signerSeed: number,
  signer: "identity" | "recovery",
  next: string,
  recovery = RECOVERY,
): Promise<Statement> {
  const payload = JSON.stringify({
    v: 2,
    type: "rotate",
    principalId: head.principalId,
    seq: 1,
    prev: head.hash,
    identityKey: next,
    recoveryKey: recovery,
    signer,
    createdAt: AT,
  });
  return sign((await keyFromSeed(signerSeed)).privateKey, CONTEXT.keyLog, payload);
}

/** A copy of `text` (base64url) with the byte at `at` changed by `change`. */
function withByte(text: string, at: number, change: (b: number) => number): string {
  const bytes = unb64(text) as Uint8Array;
  bytes[at] = change(bytes[at]);
  return b64(bytes);
}

describe("key-identity known-answer vectors", () => {
  it("the seeds give appendix B's keys", async () => {
    expect((await keyFromSeed(1)).publicKey).toBe(IDENTITY);
    expect((await keyFromSeed(101)).publicKey).toBe(RECOVERY);
    expect((await keyFromSeed(20)).publicKey).toBe(DEVICE);
  });

  it("appendix B: the inception replays to its principal id and the certificate verifies", async () => {
    expect(await principalId(INCEPTION)).toBe(PRINCIPAL);
    const head = await replay([statement(INCEPTION, INCEPTION_SIG)]);
    expect(head).toEqual({
      principalId: PRINCIPAL,
      seq: 0,
      identityKey: IDENTITY,
      recoveryKey: RECOVERY,
      hash: await payloadHash(INCEPTION),
      identityKeys: [IDENTITY],
      signers: [null],
      hashes: [await payloadHash(INCEPTION)],
    });
    const device = await certifiedDevice(statement(DEVICE_CERT, DEVICE_CERT_SIG), head);
    expect(device).toEqual({ deviceId: DEVICE_ID, deviceKey: DEVICE });
    expect(certificateClaim(statement(DEVICE_CERT, DEVICE_CERT_SIG))).toEqual({
      principalId: PRINCIPAL,
      deviceId: DEVICE_ID,
      deviceKey: DEVICE,
      name: "Laptop",
    });
  });

  it("appendix B: this module signs the login proof byte for byte", async () => {
    const proof = await signLogin((await keyFromSeed(20)).privateKey, {
      challengeId: "00000000-0000-0000-0000-000000000009",
      nonce: "bm9uY2U",
      audience: "localhost:8080",
      principalId: PRINCIPAL,
      deviceId: DEVICE_ID,
    });
    expect(proof).toEqual({ payload: LOGIN_PROOF, signature: LOGIN_SIG });
    expect(await verify(proof, CONTEXT.login, DEVICE, 2)).toBe(true);
  });

  it("appendix A: a version 1 log, certificate and login proof verify", async () => {
    const head = await replay([statement(V1_INCEPTION, V1_INCEPTION_SIG)]);
    expect(head.principalId).toBe(V1_PRINCIPAL);
    expect(head.hash).toBe(V1_PREV);
    // The head's keys are canonical whichever version spelled them.
    expect(head.identityKey).toBe(IDENTITY);
    expect(head.recoveryKey).toBe(RECOVERY);
    const device = await certifiedDevice(statement(V1_DEVICE_CERT, V1_DEVICE_CERT_SIG), head);
    expect(device).toEqual({ deviceId: DEVICE_ID, deviceKey: DEVICE });
    expect(await verify(statement(V1_LOGIN_PROOF, V1_LOGIN_SIG), CONTEXT.login, DEVICE, 1)).toBe(
      true,
    );
  });

  it("appendix B: the mixed log replays and keeps appendix A's principal id", async () => {
    const head = await replay([
      statement(V1_INCEPTION, V1_INCEPTION_SIG),
      statement(MIXED_ROTATION, MIXED_ROTATION_SIG),
    ]);
    const seed2 = (await keyFromSeed(2)).publicKey;
    expect(head.principalId).toBe(V1_PRINCIPAL);
    expect(head.seq).toBe(1);
    expect(head.identityKey).toBe(seed2);
    expect(head.identityKeys).toEqual([IDENTITY, seed2]);
    expect(head.hash).toBe(await payloadHash(MIXED_ROTATION));
    // This module's rotation of the version 1 log is the spec's, byte for byte.
    const v1Head = { principalId: V1_PRINCIPAL, hash: V1_PREV };
    expect(await rotation(v1Head, 1, "identity", seed2)).toEqual(
      statement(MIXED_ROTATION, MIXED_ROTATION_SIG),
    );
  });
});

describe("statements this browser signs", () => {
  it("appendix B: the inception and the device certificate, byte for byte", async () => {
    const identity = (await keyFromSeed(1)).privateKey;
    expect(await signInception(identity, IDENTITY, RECOVERY, AT)).toEqual(
      statement(INCEPTION, INCEPTION_SIG),
    );
    expect(
      await signDeviceCertificate(identity, {
        principalId: PRINCIPAL,
        deviceId: DEVICE_ID,
        deviceKey: DEVICE,
        name: "Laptop",
        keySeq: 0,
        issuedAt: AT,
      }),
    ).toEqual(statement(DEVICE_CERT, DEVICE_CERT_SIG));
  });

  it("appendix B: the identity rotation that extends a version 1 log, byte for byte", async () => {
    const head = await replay([statement(V1_INCEPTION, V1_INCEPTION_SIG)]);
    const next = (await keyFromSeed(2)).publicKey;
    const entry = await signRotation(head, "identity", (await keyFromSeed(1)).privateKey, next, AT);
    expect(entry).toEqual(statement(MIXED_ROTATION, MIXED_ROTATION_SIG));
  });

  it("a recovery rotation keeps the recovery key and replays as signed by it", async () => {
    const head = await replay([statement(INCEPTION, INCEPTION_SIG)]);
    const next = (await keyFromSeed(3)).publicKey;
    const entry = await signRotation(
      head,
      "recovery",
      (await keyFromSeed(101)).privateKey,
      next,
      AT,
    );
    expect(JSON.parse(entry.payload)).toMatchObject({
      seq: 1,
      recoveryKey: RECOVERY,
      signer: "recovery",
    });
    const rotated = await replay([statement(INCEPTION, INCEPTION_SIG), entry]);
    expect(rotated).toMatchObject({ identityKey: next, signers: [null, "recovery"] });
  });

  it("revocations and profile cards carry the Tauri side's fields in its order and verify", async () => {
    const head = await replay([statement(INCEPTION, INCEPTION_SIG)]);
    const identity = (await keyFromSeed(1)).privateKey;
    const byIdentity = await signRevocation(identity, false, PRINCIPAL, DEVICE_ID, AT);
    expect(byIdentity.payload).toBe(
      `{"v":2,"type":"device-revoke","principalId":"${PRINCIPAL}","deviceId":"${DEVICE_ID}","signer":"identity","issuedAt":"${AT}"}`,
    );
    expect(await verifiedRevocation(byIdentity, head, DEVICE_ID, DEVICE)).toBe(true);
    const byDevice = await signRevocation(
      (await keyFromSeed(20)).privateKey,
      true,
      PRINCIPAL,
      DEVICE_ID,
      AT,
    );
    expect(JSON.parse(byDevice.payload).signer).toBe("device");
    expect(await verifiedRevocation(byDevice, head, DEVICE_ID, DEVICE)).toBe(true);

    const card = await signProfileCard(identity, {
      principalId: PRINCIPAL,
      version: 3,
      keySeq: 0,
      displayName: "Ada",
      relays: ["https://rim.example"],
      devices: [{ deviceId: DEVICE_ID, deviceKey: DEVICE }],
      issuedAt: AT,
    });
    expect(card.payload).toBe(
      `{"v":2,"type":"profile-card","principalId":"${PRINCIPAL}","version":3,"keySeq":0,"displayName":"Ada","relays":["https://rim.example"],"devices":[{"deviceId":"${DEVICE_ID}","deviceKey":"${DEVICE}"}],"issuedAt":"${AT}"}`,
    );
    expect(await verifiedCard(card, head)).toMatchObject({ version: 3, displayName: "Ada" });
  });

  it("writes timestamps in whole seconds", () => {
    expect(now(new Date("2026-10-09T12:34:56.789Z"))).toBe("2026-10-09T12:34:56Z");
  });

  it("takes only canonical, usable Ed25519 keys for a new device", () => {
    expect(usableDeviceKey(DEVICE)).toBe(DEVICE);
    expect(() => usableDeviceKey(DEVICE.replace("ed25519:", ""))).toThrow(/malformed/);
    expect(() => usableDeviceKey(`ed448:${DEVICE.slice(8)}`)).toThrow(/malformed/);
    expect(() => usableDeviceKey(`ed25519:${b64(new Uint8Array(32))}`)).toThrow(/malformed/);
  });
});

describe("replay", () => {
  it("follows identity and recovery rotations", async () => {
    const first = statement(INCEPTION, INCEPTION_SIG);
    const head = await replay([first]);
    const seed2 = (await keyFromSeed(2)).publicKey;
    const byIdentity = await replay([first, await rotation(head, 1, "identity", seed2)]);
    expect(byIdentity.identityKey).toBe(seed2);
    expect(byIdentity.recoveryKey).toBe(RECOVERY);
    const seed3 = (await keyFromSeed(3)).publicKey;
    const seed4 = (await keyFromSeed(4)).publicKey;
    const byRecovery = await replay([first, await rotation(head, 101, "recovery", seed3, seed4)]);
    expect(byRecovery.identityKey).toBe(seed3);
    expect(byRecovery.recoveryKey).toBe(seed4);
  });

  it("refuses a rotation by the wrong key, off the head, or breaking the signer rules", async () => {
    const first = statement(INCEPTION, INCEPTION_SIG);
    const head = await replay([first]);
    const seed2 = (await keyFromSeed(2)).publicKey;
    await expect(replay([first, await rotation(head, 9, "identity", seed2)])).rejects.toThrow(
      "signature does not verify",
    );
    await expect(replay([first, await rotation(head, 1, "recovery", seed2)])).rejects.toThrow(
      "signature does not verify",
    );
    const offHead = { ...head, hash: b64(new Uint8Array(32)) };
    await expect(replay([first, await rotation(offHead, 1, "identity", seed2)])).rejects.toThrow(
      "does not extend the log",
    );
    await expect(replay([first, await rotation(head, 1, "identity", IDENTITY)])).rejects.toThrow(
      "must change the identity key",
    );
    const seed4 = (await keyFromSeed(4)).publicKey;
    await expect(
      replay([first, await rotation(head, 1, "identity", seed2, seed4)]),
    ).rejects.toThrow("only recovery may change the recovery key");
    await expect(replay([])).rejects.toThrow("empty");
    await expect(replay([statement(INCEPTION, LOGIN_SIG)])).rejects.toThrow(
      "inception signature does not verify",
    );
  });

  it("never goes back to version 1", async () => {
    const first = statement(INCEPTION, INCEPTION_SIG);
    const head = await replay([first]);
    const payload = JSON.stringify({
      v: 1,
      type: "rotate",
      principalId: head.principalId,
      seq: 1,
      prev: head.hash,
      identityKey: (await keyFromSeed(2)).publicKey.replace("ed25519:", ""),
      recoveryKey: RECOVERY.replace("ed25519:", ""),
      signer: "identity",
      createdAt: AT,
    });
    await expect(replay([first, await signV1(1, CONTEXT.keyLog, payload)])).rejects.toThrow(
      "goes back to statement version 1",
    );
  });

  it("refuses unknown versions and wrong spellings", async () => {
    const v3 = await sign(
      (await keyFromSeed(1)).privateKey,
      CONTEXT.keyLog,
      INCEPTION.replace(`"v":2`, `"v":3`),
    );
    await expect(replay([v3])).rejects.toThrow("statement version 3 is not supported");
    // A version 2 key without its tag, and a version 1 signature with one.
    const untagged = INCEPTION.replace(IDENTITY, IDENTITY.replace("ed25519:", ""));
    await expect(
      replay([await sign((await keyFromSeed(1)).privateKey, CONTEXT.keyLog, untagged)]),
    ).rejects.toThrow();
    await expect(
      replay([statement(V1_INCEPTION, `ed25519:${V1_INCEPTION_SIG}`)]),
    ).rejects.toThrow();
    await expect(replay([statement("not json", INCEPTION_SIG)])).rejects.toThrow(
      "not a key log entry",
    );
  });
});

describe("certificates", () => {
  it("vouch for devices only when they verify against the log", async () => {
    const head = await replay([statement(INCEPTION, INCEPTION_SIG)]);
    const other = (await keyFromSeed(66)).publicKey;
    // A key the server slipped in, a certificate of another account, a forged one, a seq ahead.
    const swapped = DEVICE_CERT.replace(DEVICE, other);
    await expect(certifiedDevice(statement(swapped, DEVICE_CERT_SIG), head)).rejects.toThrow();
    await expect(
      certifiedDevice(statement(V1_DEVICE_CERT, V1_DEVICE_CERT_SIG), head),
    ).rejects.toThrow();
    const forged = await sign((await keyFromSeed(66)).privateKey, CONTEXT.device, swapped);
    await expect(certifiedDevice(forged, head)).rejects.toThrow();
    const ahead = await sign(
      (await keyFromSeed(1)).privateKey,
      CONTEXT.device,
      DEVICE_CERT.replace(`"keySeq":0`, `"keySeq":1`),
    );
    await expect(certifiedDevice(ahead, head)).rejects.toThrow();
    // Signed for another purpose.
    const asLogin = await sign((await keyFromSeed(1)).privateKey, CONTEXT.login, DEVICE_CERT);
    await expect(certifiedDevice(asLogin, head)).rejects.toThrow();
  });

  it("claims are read only from device certificates", () => {
    expect(() => certificateClaim(statement(LOGIN_PROOF, LOGIN_SIG))).toThrow(
      "not a device certificate",
    );
    expect(() => certificateClaim(statement("[]", LOGIN_SIG))).toThrow();
  });
});

describe("verify", () => {
  const proof = statement(LOGIN_PROOF, LOGIN_SIG);

  it("binds the context, the key and the algorithm", async () => {
    expect(await verify(proof, CONTEXT.login, DEVICE, 2)).toBe(true);
    expect(await verify(proof, CONTEXT.device, DEVICE, 2)).toBe(false);
    expect(await verify(proof, CONTEXT.login, IDENTITY, 2)).toBe(false);
    expect(await verify(proof, CONTEXT.login, "not a key", 2)).toBe(false);
    const renamed = { ...proof, signature: LOGIN_SIG.replace("ed25519:", "ed25519-mldsa44:") };
    expect(await verify(renamed, CONTEXT.login, DEVICE, 2)).toBe(false);
    expect(await verify({ ...proof, payload: `${LOGIN_PROOF} ` }, CONTEXT.login, DEVICE, 2)).toBe(
      false,
    );
  });

  it("refuses non-canonical encodings of keys and signatures", async () => {
    const sig = LOGIN_SIG.replace("ed25519:", "");
    // Padding, trailing bits, a wrong length.
    expect(await verify({ ...proof, signature: `${LOGIN_SIG}==` }, CONTEXT.login, DEVICE, 2)).toBe(
      false,
    );
    const lastChar = sig.at(-1) === "g" ? "h" : "g";
    expect(
      await verify(
        { ...proof, signature: `ed25519:${sig.slice(0, -1)}${lastChar}` },
        CONTEXT.login,
        DEVICE,
        2,
      ),
    ).toBe(false);
    expect(await verify(proof, CONTEXT.login, `${DEVICE}AA`, 2)).toBe(false);
    expect(await verify(proof, CONTEXT.login, `${DEVICE}=`, 2)).toBe(false);
    // The scalar plus the group order: the same signature, malleated.
    const order = [
      0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde,
      0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
    ];
    const bytes = unb64(sig) as Uint8Array;
    let carry = 0;
    for (let i = 0; i < 32; i++) {
      const sum = bytes[32 + i] + order[i] + carry;
      bytes[32 + i] = sum & 0xff;
      carry = sum >> 8;
    }
    expect(
      await verify({ ...proof, signature: `ed25519:${b64(bytes)}` }, CONTEXT.login, DEVICE, 2),
    ).toBe(false);
  });

  it("refuses weak keys and small-order R", async () => {
    const identity = new Uint8Array(32);
    identity[0] = 1;
    for (const weak of [
      identity,
      new Uint8Array(32),
      Uint8Array.from(identity, (b, i) => (i === 31 ? 0x80 : b)),
    ]) {
      expect(await verify(proof, CONTEXT.login, `ed25519:${b64(weak)}`, 2)).toBe(false);
    }
    // y = p + 1: a non-canonical encoding of the identity point.
    const nonCanonical = new Uint8Array(32).fill(0xff);
    nonCanonical[0] = 0xee;
    nonCanonical[31] = 0x7f;
    expect(await verify(proof, CONTEXT.login, `ed25519:${b64(nonCanonical)}`, 2)).toBe(false);
    // R replaced by the identity point.
    const sig = unb64(LOGIN_SIG.replace("ed25519:", "")) as Uint8Array;
    sig.set(identity, 0);
    expect(
      await verify({ ...proof, signature: `ed25519:${b64(sig)}` }, CONTEXT.login, DEVICE, 2),
    ).toBe(false);
  });

  it("refuses a flipped signature byte", async () => {
    const flipped = `ed25519:${withByte(LOGIN_SIG.replace("ed25519:", ""), 5, (b) => b ^ 1)}`;
    expect(await verify({ ...proof, signature: flipped }, CONTEXT.login, DEVICE, 2)).toBe(false);
  });
});

describe("canonicalKey", () => {
  it("tags a version 1 key and keeps a version 2 one", () => {
    expect(canonicalKey(DEVICE.replace("ed25519:", ""), 1)).toBe(DEVICE);
    expect(canonicalKey(DEVICE, 2)).toBe(DEVICE);
    expect(() => canonicalKey(DEVICE, 1)).toThrow();
    expect(() => canonicalKey("ED25519:AAAA", 2)).toThrow();
    expect(() => canonicalKey(DEVICE, 3)).toThrow("statement version 3 is not supported");
  });
});

describe("against a misbehaving server", () => {
  /** A certificate of DEVICE at `keySeq`, signed by the key of `seed`. */
  async function certAt(keySeq: number, seed: number) {
    const payload = DEVICE_CERT.replace('"keySeq":0', `"keySeq":${keySeq}`);
    return sign((await keyFromSeed(seed)).privateKey, CONTEXT.device, payload);
  }

  /** A rotation at `seq` extending `prev`. */
  async function rotateAt(
    seq: number,
    prev: string,
    signerSeed: number,
    signer: "identity" | "recovery",
    next: string,
  ) {
    const payload = JSON.stringify({
      v: 2,
      type: "rotate",
      principalId: PRINCIPAL,
      seq,
      prev,
      identityKey: next,
      recoveryKey: RECOVERY,
      signer,
      createdAt: AT,
    });
    return sign((await keyFromSeed(signerSeed)).privateKey, CONTEXT.keyLog, payload);
  }

  it("finding 3: a certificate signed before a recovery is refused", async () => {
    const first = statement(INCEPTION, INCEPTION_SIG);
    const seed2 = (await keyFromSeed(2)).publicKey;
    const seed3 = (await keyFromSeed(3)).publicKey;
    const byIdentity = await rotateAt(1, await payloadHash(INCEPTION), 1, "identity", seed2);
    const rotated = await replay([first, byIdentity]);
    // An identity rotation keeps what the earlier key certified.
    expect(recoveredAfter(rotated, 0)).toBe(false);
    await expect(certifiedDevice(await certAt(0, 1), rotated)).resolves.toEqual({
      deviceId: DEVICE_ID,
      deviceKey: DEVICE,
    });

    const byRecovery = await rotateAt(2, rotated.hash, 101, "recovery", seed3);
    const recovered = await replay([first, byIdentity, byRecovery]);
    expect(recovered.hashes).toEqual([
      await payloadHash(INCEPTION),
      await payloadHash(byIdentity.payload),
      await payloadHash(byRecovery.payload),
    ]);
    await expect(certifiedDevice(await certAt(0, 1), recovered)).rejects.toThrow(
      "predates a recovery",
    );
    await expect(certifiedDevice(await certAt(1, 2), recovered)).rejects.toThrow(
      "predates a recovery",
    );
    await expect(certifiedDevice(await certAt(2, 3), recovered)).resolves.toMatchObject({
      deviceKey: DEVICE,
    });
  });

  it("finding 22: refuses equal identity and recovery keys and unknown fields, as the server", async () => {
    const same = await sign(
      (await keyFromSeed(1)).privateKey,
      CONTEXT.keyLog,
      INCEPTION.replace(RECOVERY, IDENTITY),
    );
    await expect(replay([same])).rejects.toThrow("must differ");
    // rim-server's test inserts `"x":1` first.
    const extra = await sign(
      (await keyFromSeed(1)).privateKey,
      CONTEXT.keyLog,
      INCEPTION.replace("{", '{"x":1,'),
    );
    await expect(replay([extra])).rejects.toThrow("not a key log entry");
    const prefixed = await sign(
      (await keyFromSeed(1)).privateKey,
      CONTEXT.keyLog,
      INCEPTION.replace("{", '{"prev":"AA",'),
    );
    await expect(replay([prefixed])).rejects.toThrow("not a key log entry");
    // y = p + 3: a point of large order spelled out of range.
    const nonCanonical = new Uint8Array(32).fill(0xff);
    nonCanonical[0] = 0xf0;
    nonCanonical[31] = 0x7f;
    const proof = statement(LOGIN_PROOF, LOGIN_SIG);
    expect(await verify(proof, CONTEXT.login, `ed25519:${b64(nonCanonical)}`, 2)).toBe(false);
  });

  it("finding 2: a revocation counts only when its signature verifies", async () => {
    const head = await replay([statement(INCEPTION, INCEPTION_SIG)]);
    const revocation = (seed: number, signer: string, deviceId = DEVICE_ID) =>
      keyFromSeed(seed).then((key) =>
        sign(
          key.privateKey,
          CONTEXT.deviceRevoke,
          JSON.stringify({
            v: 2,
            type: "device-revoke",
            principalId: PRINCIPAL,
            deviceId,
            signer,
            issuedAt: AT,
          }),
        ),
      );
    expect(await verifiedRevocation(await revocation(1, "identity"), head, DEVICE_ID, DEVICE)).toBe(
      true,
    );
    expect(await verifiedRevocation(await revocation(20, "device"), head, DEVICE_ID, DEVICE)).toBe(
      true,
    );
    for (const forged of [
      await revocation(66, "identity"),
      await revocation(20, "identity"),
      await revocation(1, "identity", "00000000-0000-0000-0000-000000000002"),
      statement(DEVICE_CERT, DEVICE_CERT_SIG),
    ]) {
      expect(await verifiedRevocation(forged, head, DEVICE_ID, DEVICE)).toBe(false);
    }
  });
});

describe("profile cards", () => {
  const cardContext = new TextEncoder().encode("rim.profile-card.v1\0");
  function card(fields: Record<string, unknown> = {}): string {
    return JSON.stringify({
      v: 2,
      type: "profile-card",
      principalId: PRINCIPAL,
      version: 3,
      keySeq: 0,
      displayName: "Ada",
      relays: ["https://relay.example", "https://other.example"],
      devices: [{ deviceId: DEVICE_ID, deviceKey: DEVICE }],
      issuedAt: AT,
      ...fields,
    });
  }

  it("reads a card the identity key signed", async () => {
    const head = await replay([statement(INCEPTION, INCEPTION_SIG)]);
    const signed = await sign((await keyFromSeed(1)).privateKey, cardContext, card());
    const verified = await verifiedCard(signed, head);
    expect(verified.displayName).toBe("Ada");
    expect(verified.relays).toEqual(["https://relay.example", "https://other.example"]);
    expect(verified.devices).toEqual([{ deviceId: DEVICE_ID, deviceKey: DEVICE }]);
  });

  it("refuses another signer, another account, and fields out of bounds", async () => {
    const head = await replay([statement(INCEPTION, INCEPTION_SIG)]);
    const identity = (await keyFromSeed(1)).privateKey;
    const byDevice = await sign((await keyFromSeed(20)).privateKey, cardContext, card());
    await expect(verifiedCard(byDevice, head)).rejects.toThrow(/signature/);
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ principalId: V1_PRINCIPAL }, /another account/],
      [{ displayName: " " }, /name/],
      [{ relays: ["ftp://relay.example"] }, /relays/],
      [{ relays: ["https://a.example", "https://a.example"] }, /repeat/],
      [{ keySeq: 1 }, /lost key/],
      [{ extra: true }, /not a profile card/],
    ];
    for (const [fields, error] of cases) {
      const signed = await sign(identity, cardContext, card(fields));
      await expect(verifiedCard(signed, head)).rejects.toThrow(error);
    }
  });
});
