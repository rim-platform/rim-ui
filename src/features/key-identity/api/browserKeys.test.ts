import { beforeEach, describe, expect, it } from "vitest";

import {
  MemoryKeyStore,
  acceptBrowserJoin,
  beginBrowserJoin,
  browserAccounts,
  deviceName,
  discardBrowserJoin,
  forgetBrowserKeys,
  setBrowserKeyStore,
  settleBrowserKeys,
  signBrowserLogin,
} from "./browserKeys";
import {
  fingerprint,
  fromB64url,
  offerJson,
  open,
  openChannel,
  parseLinkCode,
  seal,
  type SealedMessage,
} from "./linkChannel";

const ENDPOINT = "https://rim.example.com/api";
const PRINCIPAL = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";
const CODE = `rim-link:1:AAECAwQFBgcICQoLDA0ODw:ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8:${ENDPOINT}`;
const LINK_ID = "AAECAwQFBgcICQoLDA0ODw";

let store: MemoryKeyStore;

beforeEach(() => {
  store = new MemoryKeyStore();
  setBrowserKeyStore(store);
  discardBrowserJoin(LINK_ID);
});

/** What the old device does with the offer: open it and answer with a certificate. */
async function answerFor(
  offer: SealedMessage,
  certFields: (offered: Record<string, unknown>) => Record<string, unknown> = () => ({}),
): Promise<{ answer: SealedMessage; offered: Record<string, unknown> }> {
  const channel = await openChannel(parseLinkCode(CODE));
  const plaintext = await open(channel, "offer", offer);
  if (!plaintext) throw new Error("offer did not open");
  const offered = JSON.parse(plaintext) as Record<string, unknown>;
  const payload = JSON.stringify({
    v: 2,
    type: "device",
    principalId: PRINCIPAL,
    deviceId: offered.deviceId,
    deviceKey: offered.deviceKey,
    name: "Firefox at work",
    keySeq: 0,
    issuedAt: "2026-10-09T00:00:00Z",
    ...certFields(offered),
  });
  const answer = await seal(
    channel,
    "answer",
    JSON.stringify({
      v: 1,
      type: "link-answer",
      certificate: { payload, signature: "ed25519:sig" },
    }),
  );
  return { answer, offered };
}

describe("browser keys", () => {
  it("joins an account, storing the key only once the answer names it", async () => {
    const started = await beginBrowserJoin(CODE, `${ENDPOINT}/`, " Firefox on Linux ");
    expect(started.linkId).toBe(LINK_ID);
    expect(store.records.size).toBe(0);

    const { answer, offered } = await answerFor(started.offer);
    expect(offered.platform).toBe("web");
    expect(offered.name).toBe("Firefox on Linux");
    expect(offered.statementVersion).toBe(2);
    expect(String(offered.deviceKey)).toMatch(/^ed25519:[A-Za-z0-9_-]{43}$/);
    expect(started.fingerprint).toBe(
      await fingerprint(
        offerJson({
          deviceId: String(offered.deviceId),
          deviceKey: String(offered.deviceKey),
          name: "Firefox on Linux",
          platform: "web",
        }),
      ),
    );

    expect(await acceptBrowserJoin(LINK_ID, answer)).toBe(PRINCIPAL);
    const [account] = await browserAccounts(ENDPOINT);
    expect(account).toMatchObject({
      principalId: PRINCIPAL,
      deviceId: offered.deviceId,
      deviceName: "Firefox at work",
      hasIdentityKey: false,
      confirmed: false,
    });
    const [record] = [...store.records.values()];
    expect(record?.privateKey.extractable).toBe(false);

    // The stored key signs a login proof the offered public key verifies.
    const proof = await signBrowserLogin(ENDPOINT, PRINCIPAL, {
      challengeId: "c",
      nonce: "bm9uY2U",
    });
    expect(JSON.parse(proof.payload)).toMatchObject({
      v: 2,
      type: "login",
      audience: "rim.example.com",
      principalId: PRINCIPAL,
      deviceId: offered.deviceId,
    });
    const publicKey = await crypto.subtle.importKey(
      "raw",
      fromB64url(String(offered.deviceKey).slice("ed25519:".length))!,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      fromB64url(proof.signature.slice("ed25519:".length))!,
      new TextEncoder().encode(`rim.login.v1\0${proof.payload}`),
    );
    expect(ok).toBe(true);
  });

  it("refuses a code for another server", async () => {
    await expect(beginBrowserJoin(CODE, "https://other.example.com/api", "Web")).rejects.toThrow(
      /server at https:\/\/rim\.example\.com\/api/,
    );
  });

  it("refuses an answer for another device and stores nothing", async () => {
    for (const wrong of [
      () => ({ deviceKey: "ed25519:IIKL9cW9ystoSGMzbCAvtVmdpIvlWWYVdCFwcFvsqfc" }),
      () => ({ deviceId: "01890a5d-ac96-774b-bcce-b302099a8057" }),
      () => ({ type: "login" }),
      () => ({ principalId: "someone" }),
    ]) {
      const started = await beginBrowserJoin(CODE, ENDPOINT, "Web");
      const { answer } = await answerFor(started.offer, wrong);
      await expect(acceptBrowserJoin(LINK_ID, answer)).rejects.toThrow(/not for this device/);
      discardBrowserJoin(LINK_ID);
    }
    // Bytes sealed under another secret do not open.
    const started = await beginBrowserJoin(CODE, ENDPOINT, "Web");
    const other = await openChannel(
      parseLinkCode(CODE.replace("ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8", "A".repeat(43))),
    );
    const forged = await seal(other, "answer", "{}");
    await expect(acceptBrowserJoin(started.linkId, forged)).rejects.toThrow(/not for this device/);
    expect(store.records.size).toBe(0);
  });

  it("does not replace a key it already holds, and forgets a dropped join", async () => {
    const first = await beginBrowserJoin(CODE, ENDPOINT, "Web");
    await acceptBrowserJoin(LINK_ID, (await answerFor(first.offer)).answer);
    const second = await beginBrowserJoin(CODE, ENDPOINT, "Web");
    await expect(
      acceptBrowserJoin(LINK_ID, (await answerFor(second.offer)).answer),
    ).rejects.toThrow(/already holds a key/);

    discardBrowserJoin(LINK_ID);
    await expect(acceptBrowserJoin(LINK_ID, first.offer)).rejects.toThrow(/cancelled/);
  });

  it("settles and forgets keys per server", async () => {
    const started = await beginBrowserJoin(CODE, ENDPOINT, "Web");
    await acceptBrowserJoin(LINK_ID, (await answerFor(started.offer)).answer);
    expect(await settleBrowserKeys(ENDPOINT, { userId: "u1", username: "alice" }, null)).toBeNull();
    const settled = await settleBrowserKeys(
      ENDPOINT,
      { userId: "u1", username: "alice" },
      PRINCIPAL,
    );
    expect(settled).toMatchObject({ userId: "u1", username: "alice", confirmed: true });
    expect(await browserAccounts("https://other.example.com/api")).toEqual([]);
    await forgetBrowserKeys(ENDPOINT, PRINCIPAL);
    expect(await browserAccounts(ENDPOINT)).toEqual([]);
  });

  it("cleans device names as certificates require", () => {
    expect(deviceName("  Work\u0007 laptop ")).toBe("Work laptop");
    expect(Array.from(deviceName("x".repeat(80)))).toHaveLength(64);
    expect(() => deviceName(" \n ")).toThrow(/name/);
  });
});
