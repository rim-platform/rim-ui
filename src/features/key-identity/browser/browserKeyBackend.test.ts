import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError } from "graphql-request";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { keyFromSeed } from "../../../test/ed25519";
import { DeviceLinkError, linkNewDevice } from "../api/deviceLink";
import { keyBackend } from "../api/keyBackend";
import { listDeviceKeyAccounts, signInWithDeviceKey } from "../api/keyIdentity";
import {
  audience,
  browserDeviceName,
  browserKeyBackend,
  deviceName,
  uuidV7,
} from "./browserKeyBackend";
import { fingerprint, open, parseLinkCode, seal, type Sealed } from "./channel";
import { record, type BrowserKeyRecord } from "./keyStore";
import { CONTEXT, sign, verify, type Statement } from "./statements";

const ENDPOINT = "http://localhost:8080/api";
const CODE =
  "rim-link:1:AAECAwQFBgcICQoLDA0ODw:ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8:http://localhost:8080/api";
const LINK_ID = "AAECAwQFBgcICQoLDA0ODw";
// key-identity-v1.md, appendix B: the account of the old device.
const PRINCIPAL = "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0";
const INCEPTION: Statement = {
  payload: `{"v":2,"type":"inception","seq":0,"identityKey":"ed25519:iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"ed25519:1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}`,
  signature:
    "ed25519:kGvSf1hR28cdKP2Smwmy2BHEdP7wmKwy0At-DtrUs8mYhfzF0jjHTjpeX4DAzXv5HuCVwFEYWM1DjN-6wkU2Ag",
};
// Appendix A: another account's log.
const OTHER_INCEPTION: Statement = {
  payload: `{"v":1,"type":"inception","seq":0,"identityKey":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w","recoveryKey":"1i8Bah79Hk_feT60LNhEceG6nwzwTRKHtcxx9hYofLg","createdAt":"2026-10-09T00:00:00Z"}`,
  signature:
    "vf3zjxbHUJ8l9Oe6ayFGZZszVH1c_FVgO04F_4PqkfsYu9h8jAgbPKhAIAYHlQxg-7yAO5w1OEMmcAGcXptVDQ",
};
const ME = { id: "user-1", username: "ada", displayName: "Ada", principalId: PRINCIPAL };

interface OpenedOffer {
  v: number;
  type: string;
  deviceId: string;
  deviceKey: string;
  name: string;
  platform: string;
  statementVersion: number;
}

function operation(doc: unknown): string {
  return /(?:query|mutation)\s+(\w+)/.exec(String(doc))?.[1] ?? String(doc);
}

function serverError(code: string) {
  return new ClientError(
    { status: 200, headers: new Headers(), errors: [{ message: code, extensions: { code } }] },
    { query: "" },
  );
}

const utf8 = (text: string) => new Uint8Array(new TextEncoder().encode(text));

interface OldDeviceOptions {
  /** Change the certificate before it is signed. */
  certify?: (offer: OpenedOffer) => Partial<Record<string, unknown>>;
  /** The seed of the key that signs the certificate (the identity key is 1). */
  signer?: number;
  keyLog?: Statement[];
  login?: (proof: Statement, offer: OpenedOffer) => unknown;
}

/**
 * The server and the old device of appendix B: opens the offer with the code, certifies the
 * offered key with the identity key, and answers; checks login proofs against the offered key.
 */
function oldDevice(options: OldDeviceOptions = {}) {
  const state: {
    offer?: OpenedOffer;
    offerBytes?: Uint8Array;
    answer?: Sealed;
    calls: string[];
    storedWhileAnswering?: number;
  } = { calls: [] };
  requestMock.mockImplementation(async (doc: unknown, vars: Record<string, unknown>) => {
    const name = operation(doc);
    state.calls.push(name);
    switch (name) {
      case "SendDeviceLinkOffer": {
        expect(vars.linkId).toBe(LINK_ID);
        state.offerBytes = await open(parseLinkCode(CODE), "offer", vars.offer as Sealed);
        state.offer = JSON.parse(new TextDecoder().decode(state.offerBytes)) as OpenedOffer;
        return { sendDeviceLinkOffer: true };
      }
      case "DeviceLinkAnswer": {
        const offer = state.offer as OpenedOffer;
        state.storedWhileAnswering = (await listDeviceKeyAccounts()).length;
        const payload = JSON.stringify({
          v: 2,
          type: "device",
          principalId: PRINCIPAL,
          deviceId: offer.deviceId,
          deviceKey: offer.deviceKey,
          name: offer.name,
          keySeq: 0,
          issuedAt: "2026-10-09T00:00:00Z",
          ...options.certify?.(offer),
        });
        const signer = (await keyFromSeed(options.signer ?? 1)).privateKey;
        const certificate = await sign(signer, CONTEXT.device, payload);
        state.answer = await seal(
          parseLinkCode(CODE),
          "answer",
          utf8(JSON.stringify({ v: 1, type: "link-answer", certificate })),
        );
        return { deviceLinkAnswer: state.answer };
      }
      case "KeyLog":
        expect(vars.principalId).toBe(PRINCIPAL);
        return {
          keyLog: (options.keyLog ?? [INCEPTION]).map((statement, seq) => ({ seq, statement })),
        };
      case "KeyLoginChallenge":
        return { keyLoginChallenge: { challengeId: "challenge-1", nonce: "bm9uY2U" } };
      case "LoginWithKey": {
        const proof = vars.proof as Statement;
        const offer = state.offer as OpenedOffer;
        if (options.login) {
          const answer = options.login(proof, offer);
          if (answer instanceof Error) throw answer;
        }
        expect(await verify(proof, CONTEXT.login, offer.deviceKey, 2)).toBe(true);
        expect(JSON.parse(proof.payload)).toEqual({
          v: 2,
          type: "login",
          challengeId: "challenge-1",
          nonce: "bm9uY2U",
          audience: "localhost:8080",
          principalId: PRINCIPAL,
          deviceId: offer.deviceId,
        });
        return { loginWithKey: { userId: ME.id } };
      }
      case "MeKeyAccount":
        return { me: ME };
      case "CompleteDeviceLink":
        return { completeDeviceLink: true };
      case "CancelDeviceLink":
        return { cancelDeviceLink: true };
      default:
        throw new Error(`unexpected request ${name}`);
    }
  });
  return state;
}

const sleep = vi.fn(async () => undefined);

async function link(): Promise<string> {
  return linkNewDevice(CODE, "Firefox on Linux", { sleep });
}

async function stored(): Promise<BrowserKeyRecord | null> {
  return record(ENDPOINT, PRINCIPAL);
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  requestMock.mockReset();
  sleep.mockClear();
});

describe("the web app as a linked device", () => {
  it("uses the browser backend outside the desktop app", () => {
    expect(keyBackend()).toBe(browserKeyBackend);
  });

  it("links with a pasted code, stores a non-extractable key, and signs in with it", async () => {
    const onOffered = vi.fn();
    const server = oldDevice();
    const userId = await linkNewDevice(CODE, "Firefox on Linux", { sleep, onOffered });

    expect(userId).toBe("user-1");
    const offer = server.offer as OpenedOffer;
    expect(offer).toMatchObject({ v: 1, type: "link-offer", name: "Firefox on Linux" });
    expect(offer.platform).toBe("web");
    expect(offer.statementVersion).toBe(2);
    expect(offer.deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(offer.deviceKey).toMatch(/^ed25519:[A-Za-z0-9_-]{43}$/);
    // The fingerprint shown here is the one the old device computes over the bytes it opened.
    expect(onOffered).toHaveBeenCalledWith({
      linkId: LINK_ID,
      fingerprint: await fingerprint(server.offerBytes as Uint8Array),
    });
    // Nothing was stored until the answer verified.
    expect(server.storedWhileAnswering).toBe(0);
    expect(server.calls).toContain("CompleteDeviceLink");
    expect(server.calls).not.toContain("CancelDeviceLink");

    const saved = (await stored()) as BrowserKeyRecord;
    expect(saved).toMatchObject({
      principalId: PRINCIPAL,
      deviceId: offer.deviceId,
      deviceName: "Firefox on Linux",
      confirmed: true,
      userId: "user-1",
      username: "ada",
    });
    expect(saved.deviceKey.type).toBe("private");
    expect(saved.deviceKey.extractable).toBe(false);
    expect(saved.deviceKey.algorithm.name).toBe("Ed25519");
    await expect(crypto.subtle.exportKey("pkcs8", saved.deviceKey)).rejects.toThrow();

    expect(await listDeviceKeyAccounts()).toEqual([
      {
        principalId: PRINCIPAL,
        userId: "user-1",
        username: "ada",
        deviceId: offer.deviceId,
        deviceName: "Firefox on Linux",
        hasIdentityKey: false,
        confirmed: true,
      },
    ]);
    // The stored key signs in again later.
    expect(await signInWithDeviceKey(PRINCIPAL)).toBe("user-1");
  });

  it("cancels and stores nothing when the certificate names another device", async () => {
    const server = oldDevice({
      certify: () => ({ deviceId: "00000000-0000-0000-0000-000000000002" }),
    });
    const err = await link().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeviceLinkError);
    expect((err as DeviceLinkError).reason).toBe("refused");
    expect((err as Error).message).toContain("the certificate is for another device");
    expect(server.calls).toContain("CancelDeviceLink");
    expect(server.calls).not.toContain("KeyLog");
    expect(await listDeviceKeyAccounts()).toEqual([]);
  });

  it("cancels and stores nothing when the certificate does not verify against the served log", async () => {
    const server = oldDevice({ signer: 66 });
    const err = await link().catch((e: unknown) => e);
    expect((err as Error).message).toContain("a device certificate does not verify");
    expect(server.calls).toContain("CancelDeviceLink");
    expect(await listDeviceKeyAccounts()).toEqual([]);
  });

  it("cancels when the served log belongs to another account", async () => {
    const server = oldDevice({ keyLog: [OTHER_INCEPTION] });
    const err = await link().catch((e: unknown) => e);
    expect((err as Error).message).toContain("belongs to another account");
    expect(server.calls).toContain("CancelDeviceLink");
    expect(await listDeviceKeyAccounts()).toEqual([]);
  });

  it("removes the keys when the other device revoked this one before it signed in", async () => {
    oldDevice({ login: () => serverError("FORBIDDEN") });
    const err = await link().catch((e: unknown) => e);
    expect((err as DeviceLinkError).reason).toBe("revoked");
    expect(await stored()).toBeNull();
  });

  it("keeps the keys for the sign-in screen when signing in fails otherwise", async () => {
    oldDevice({ login: () => serverError("UNAUTHENTICATED") });
    const err = await link().catch((e: unknown) => e);
    expect((err as DeviceLinkError).reason).toBe("failed");
    expect(await stored()).toMatchObject({ confirmed: false, userId: null });
  });

  it("refuses a code for another server before asking the server", async () => {
    oldDevice();
    const err = await linkNewDevice(
      CODE.replace(ENDPOINT, "https://rim.example/api"),
      "Firefox on Linux",
      { sleep },
    ).catch((e: unknown) => e);
    expect((err as Error).message).toContain("this code is for another server");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses to link over keys this browser already holds for the account", async () => {
    oldDevice();
    await link();
    const server = oldDevice();
    const err = await link().catch((e: unknown) => e);
    expect((err as Error).message).toContain("already holds keys for that account");
    expect(server.calls).toContain("CancelDeviceLink");
  });

  it("keeps a link only in the page: a reload has nothing to finish and nothing stored", async () => {
    await browserKeyBackend.linkOffer(ENDPOINT, CODE, "Firefox on Linux");
    expect(await listDeviceKeyAccounts()).toEqual([]);
    vi.resetModules();
    const reloaded = await import("./browserKeyBackend");
    await expect(
      reloaded.browserKeyBackend.linkOpenAnswer(LINK_ID, { nonce: "", ciphertext: "" }),
    ).rejects.toThrow("no longer open");
    await browserKeyBackend.linkEnd(LINK_ID);
  });
});

describe("settling and forgetting", () => {
  async function linked(principalId: string, extra: Partial<BrowserKeyRecord> = {}) {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const { update } = await import("./keyStore");
    await update(ENDPOINT, () => ({
      put: [
        {
          v: 1,
          endpoint: ENDPOINT,
          principalId,
          deviceId: `device-of-${principalId}`,
          deviceName: "Firefox on Linux",
          deviceKey: pair.privateKey,
          confirmed: false,
          userId: null,
          username: null,
          ...extra,
        },
      ],
    }));
  }

  const account = { endpoint: `${ENDPOINT}/`, userId: "user-1", username: "ada" };

  it("confirms the shown keys and drops the account's unconfirmed others", async () => {
    await linked("rimp1_shown");
    await linked("rimp1_stale", { userId: "user-1" });
    await linked("rimp1_kept", { userId: "user-1", confirmed: true });
    await linked("rimp1_other", { userId: "user-2" });
    const settled = await browserKeyBackend.settle(account, "rimp1_shown");
    expect(settled).toMatchObject({
      principalId: "rimp1_shown",
      userId: "user-1",
      confirmed: true,
    });
    const left = (await browserKeyBackend.accounts(ENDPOINT)).map((a) => a.principalId).sort();
    expect(left).toEqual(["rimp1_kept", "rimp1_other", "rimp1_shown"]);
    expect(await browserKeyBackend.settle(account, null)).toBeNull();
  });

  it("forgets keys, or only unconfirmed ones", async () => {
    await linked("rimp1_a");
    await linked("rimp1_b", { confirmed: true });
    await browserKeyBackend.forgetUnconfirmed("rimp1_b");
    await browserKeyBackend.forgetUnconfirmed("rimp1_a");
    expect((await browserKeyBackend.accounts(ENDPOINT)).map((a) => a.principalId)).toEqual([
      "rimp1_b",
    ]);
    await browserKeyBackend.forget("rimp1_b");
    expect(await browserKeyBackend.accounts(ENDPOINT)).toEqual([]);
  });

  it("refuses to sign for an account it holds no key for", async () => {
    await expect(
      browserKeyBackend.signLogin(ENDPOINT, PRINCIPAL, { challengeId: "c", nonce: "n" }),
    ).rejects.toThrow("no keys for that account");
  });

  it("lists nothing when the browser has no IndexedDB", async () => {
    const factory = globalThis.indexedDB;
    // @ts-expect-error -- a browser without IndexedDB
    delete globalThis.indexedDB;
    try {
      expect(await browserKeyBackend.accounts(ENDPOINT)).toEqual([]);
    } finally {
      globalThis.indexedDB = factory;
    }
  });
});

describe("helpers", () => {
  it("the audience is the endpoint's host and port, lowercased", () => {
    expect(audience("http://LocalHost:8080/api")).toBe("localhost:8080");
    expect(audience("https://user@rim.example/api?x#y")).toBe("rim.example");
    expect(audience("/api")).toBe(window.location.host);
    expect(() => audience("http:///api")).toThrow("not an absolute server URL");
  });

  it("device names follow the certificate rules", () => {
    expect(deviceName("  Firefox\u0007 on Linux  ")).toBe("Firefox on Linux");
    expect(deviceName("é".repeat(70))).toBe("é".repeat(64));
    expect(() => deviceName(" \n ")).toThrow("give this device a name");
  });

  it("names the browser and system", () => {
    expect(
      browserDeviceName("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"),
    ).toBe("Firefox on Linux");
    expect(
      browserDeviceName(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      ),
    ).toBe("Safari on macOS");
    expect(
      browserDeviceName(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0",
      ),
    ).toBe("Edge on Windows");
    expect(browserDeviceName("curl/8")).toBe("Browser");
  });

  it("device ids are UUID v7", () => {
    const id = uuidV7(0x0192_3456_789a);
    expect(id).toMatch(/^01923456-789a-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidV7()).not.toBe(uuidV7());
  });
});
