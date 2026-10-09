import { describe, expect, it } from "vitest";

import { keyFromSeed } from "../../../test/ed25519";
import {
  INCEPTION,
  PUBLISHER,
  SIGNED_HELLO_WEB,
} from "../../plugins/registry/testing/signedHelloWeb";
import { HELLO_WEB_MANIFEST } from "../../plugins/web/testing/helloWeb";
import {
  MAX_MANIFEST_LEN,
  MAX_PAYLOAD_LEN,
  readPluginManifest,
  replayHistory,
  verifyPluginManifest,
} from "./pluginManifest";
import { CONTEXT, payloadHash, sign, type Statement } from "./statements";

const SHA = "5b154b3eb45c3ebc44f6820ba30a389ce85b43dea34bcbf652b9b1a5416fbe85";
const RECOVERY = "ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg";

/** The known payload with one substitution, signed again by the identity key. */
async function resigned(from: string, to: string): Promise<Statement> {
  const payload = SIGNED_HELLO_WEB.payload.replace(from, to);
  return sign((await keyFromSeed(1)).privateKey, CONTEXT.pluginManifest, payload);
}

async function refusal(statement: Statement, log: Statement[] = [INCEPTION]): Promise<string> {
  const history = await replayHistory(log);
  try {
    await verifyPluginManifest(history, statement);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("the statement was accepted");
}

async function rotation(
  log: Statement[],
  signer: "identity" | "recovery",
  signerSeed: number,
  nextSeed: number,
): Promise<Statement> {
  const last = log[log.length - 1];
  const payload = JSON.stringify({
    v: 2,
    type: "rotate",
    principalId: PUBLISHER,
    seq: log.length,
    prev: await payloadHash(last.payload),
    identityKey: (await keyFromSeed(nextSeed)).publicKey,
    recoveryKey: RECOVERY,
    signer,
    createdAt: "2026-10-09T00:00:00Z",
  });
  return sign((await keyFromSeed(signerSeed)).privateKey, CONTEXT.keyLog, payload);
}

describe("plugin manifest statements", () => {
  it("appendix A verifies against appendix B's inception", async () => {
    const history = await replayHistory([INCEPTION]);
    const verified = await verifyPluginManifest(history, SIGNED_HELLO_WEB);
    expect(verified.validity).toEqual({ status: "valid" });
    expect(verified.statement).toEqual({
      principalId: PUBLISHER,
      keySeq: 0,
      publisherName: "Ada",
      pluginId: "dev.example.hello-web",
      version: "0.1.0",
      manifest: HELLO_WEB_MANIFEST,
      displayName: "Hello Web",
      runtimeKind: "WebSandboxed",
      source: { kind: "bundle", sha256: SHA, size: 1605 },
      issuedAt: "2026-10-09T00:00:00Z",
    });
  });

  it("step 1: refuses a malformed statement", async () => {
    expect(await refusal(await resigned('"v":2', '"v":1'))).toContain("version 2 statement");
    expect(await refusal(await resigned("{", '{"extra":1,'))).toContain("unknown field");
    expect(await refusal(await resigned("{", '{"publisherName":"Eve",'))).toContain(
      "duplicate field",
    );
    expect(await refusal(await resigned('"size":1605', '"size":1605,"mirror":"x"'))).toContain(
      "unknown field",
    );
    expect(await refusal(await resigned("plugin-manifest", "profile-card"))).toBe(
      "expected a `plugin-manifest` statement",
    );
    const big = await sign(
      (await keyFromSeed(1)).privateKey,
      CONTEXT.pluginManifest,
      `{"pad":"${"x".repeat(MAX_PAYLOAD_LEN)}"}`,
    );
    expect(await refusal(big)).toBe("statement payload exceeds 98304 bytes");
  });

  it("applies the field rules with the server's messages", async () => {
    expect(await refusal(await resigned(SHA, SHA.toUpperCase()))).toBe(
      "source.sha256 must be 64 lowercase hex characters",
    );
    for (const size of ["0", "8388609"]) {
      expect(await refusal(await resigned('"size":1605', `"size":${size}`))).toBe(
        "source.size must be 1 to 8388608",
      );
    }
    expect(
      await refusal(
        await resigned('"pluginId":"dev.example.hello-web"', '"pluginId":"dev.example.other"'),
      ),
    ).toBe("pluginId does not match the manifest");
    expect(await refusal(await resigned('"version":"0.1.0"', '"version":"0.2.0"'))).toBe(
      "version does not match the manifest",
    );
    const bundle = `{"kind":"bundle","sha256":"${SHA}","size":1605}`;
    const git = `{"kind":"git","url":"https://github.com/acme/hello","commit":"${"a".repeat(40)}","treeSha256":"${SHA}"}`;
    expect(await refusal(await resigned(bundle, git))).toBe(
      "a WebSandboxed plugin must come with a bundle source",
    );
    const fat = await resigned(
      '"manifest":"{',
      `"manifest":"{\\"description\\":\\"${"x".repeat(MAX_MANIFEST_LEN)}\\",`,
    );
    expect(await refusal(fat)).toBe("manifest must be at most 65536 bytes");
    for (const name of ["  ", "n".repeat(81), "A\\u0007"]) {
      expect(await refusal(await resigned('"Ada"', `"${name}"`))).toContain("publisherName");
    }
    const trimmed = readPluginManifest(await resigned('"Ada"', '" Ada "'));
    expect(trimmed.publisherName).toBe("Ada");
  });

  it("a desktop plugin may come from git", async () => {
    const bundle = `{"kind":"bundle","sha256":"${SHA}","size":1605}`;
    const git = `{"kind":"git","url":"ssh://git@github.com/acme/hello","commit":"${"b".repeat(40)}","treeSha256":"${SHA}"}`;
    const payload = SIGNED_HELLO_WEB.payload
      .replace(bundle, git)
      .replace("WebSandboxed", "DesktopLocalProcess");
    const statement = await sign(
      (await keyFromSeed(1)).privateKey,
      CONTEXT.pluginManifest,
      payload,
    );
    const verified = await verifyPluginManifest(await replayHistory([INCEPTION]), statement);
    expect(verified.statement.source.kind).toBe("git");
  });

  it("step 2: refuses a statement of another principal", async () => {
    const other = await sign(
      (await keyFromSeed(5)).privateKey,
      CONTEXT.keyLog,
      INCEPTION.payload.replace(
        "ed25519:iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w",
        (await keyFromSeed(5)).publicKey,
      ),
    );
    expect(await refusal(SIGNED_HELLO_WEB, [other])).toBe("statement is for a different principal");
  });

  it("step 3: refuses a missing entry or a signature that does not verify", async () => {
    expect(await refusal(await resigned('"keySeq":0', '"keySeq":1'))).toBe(
      "keySeq 1 is not an entry of the publisher's key log",
    );
    const flipped = {
      ...SIGNED_HELLO_WEB,
      payload: SIGNED_HELLO_WEB.payload.replace("Ada", "Adb"),
    };
    expect(await refusal(flipped)).toBe("signature does not verify");
    const otherContext = await sign(
      (await keyFromSeed(1)).privateKey,
      CONTEXT.keyLog,
      SIGNED_HELLO_WEB.payload,
    );
    expect(await refusal(otherContext)).toBe("signature does not verify");
  });

  it("stays valid across an identity rotation and is withdrawn by a recovery", async () => {
    const log: Statement[] = [INCEPTION];
    log.push(await rotation(log, "identity", 1, 2));
    let verified = await verifyPluginManifest(await replayHistory(log), SIGNED_HELLO_WEB);
    expect(verified.validity).toEqual({ status: "valid" });
    log.push(await rotation(log, "recovery", 101, 3));
    verified = await verifyPluginManifest(await replayHistory(log), SIGNED_HELLO_WEB);
    expect(verified.validity).toEqual({ status: "publisherRecovered", atSeq: 2 });
  });
});
