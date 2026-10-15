import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError } from "graphql-request";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { fromHex, keyFromSeed } from "../../../test/ed25519";
import { DeviceLinkState } from "../../../core/graphql/generated/schema-types";
import {
  confirmLink,
  DeviceLinkError,
  linkNewDevice,
  startLinkingDevice,
  waitForOffer,
} from "../api/deviceLink";
import { keyBackend, type EnrollmentDraft, type KeyChallenge } from "../api/keyBackend";
import {
  beginEnrollment,
  completeEnrollment,
  confirmRecoveryKitSaved,
  listDeviceKeyAccounts,
  recoverAccount,
  signInWithDeviceKey,
  signupWithKey,
  unsavedRecoveryKit,
  type MyKeyIdentity,
} from "../api/keyIdentity";
import { useKeyStorageStore } from "../state/keyStorage";
import {
  audience,
  browserDeviceName,
  browserKeyBackend,
  deviceName,
  uuidV7,
} from "./browserKeyBackend";
import {
  answerCertificate,
  fingerprint,
  offerPlaintext,
  open,
  parseLinkCode,
  seal,
  type Offer,
  type Sealed,
} from "./channel";
import { pendingLinks, principalRecords, record, update, type BrowserKeyRecord } from "./keyStore";
import { base32, concat, sha256, utf8 } from "./bytes";
import { formatKit, phraseWords } from "./recoveryKit";
import {
  certificateClaim,
  certifiedDevice,
  CONTEXT,
  principalId as principalIdOf,
  replay,
  sign,
  signInception,
  signRotation,
  verifiedCard,
  verifiedRevocation,
  verify,
  type Statement,
} from "./statements";

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

// ─── The browser as the identity holder ─────────────────────────────────────

const ACCOUNT = { endpoint: ENDPOINT, userId: "user-1", username: "ada" };
const CHALLENGE: KeyChallenge = { challengeId: "challenge-1", nonce: "bm9uY2U" };
const AT = "2026-10-09T00:00:00Z";
// key-identity-v1.md, "Recovery kit": the vector phrase and its recovery key.
const KIT_ENTROPY = "000102030405060708090a0b0c0d0e0f";
const KIT_RECOVERY_KEY = "ed25519:K2c3c55QDKnCUKWO8yTdZm25JIT20PKr5vaNC91F4cw";

/**
 * Answer server operations by name: a function answer gets the variables, an Error answer is
 * thrown. Returns the operations asked, in order.
 */
function serve(handlers: Record<string, unknown>): string[] {
  const asked: string[] = [];
  requestMock.mockImplementation(async (doc: unknown, vars: Record<string, unknown>) => {
    const name = operation(doc);
    asked.push(name);
    if (!(name in handlers)) throw new Error(`unexpected request ${name}`);
    const answer = handlers[name];
    const value = typeof answer === "function" ? await answer(vars) : answer;
    if (value instanceof Error) throw value;
    return value;
  });
  return asked;
}

/** `myKeyIdentity` for a log and the devices its certificates name. */
function identityOf(keyLog: Statement[], certificates: Statement[]): MyKeyIdentity {
  return {
    principalId: certificateClaim(certificates[0]).principalId,
    keySeq: keyLog.length - 1,
    keyLog: keyLog.map((statement, seq) => ({ seq, statement })),
    devices: certificates.map((certificate) => {
      const claim = certificateClaim(certificate);
      return {
        deviceId: claim.deviceId,
        publicKey: claim.deviceKey,
        name: claim.name,
        keySeq: JSON.parse(certificate.payload).keySeq as number,
        certificate,
        addedAt: AT,
        lastUsedAt: AT,
        revokedAt: null,
      };
    }),
    profileCard: null,
  };
}

/** An identity this browser created and the server confirmed: its draft, log and certificate. */
async function holder(): Promise<{
  draft: EnrollmentDraft;
  principalId: string;
  keyLog: Statement[];
  certificate: Statement;
}> {
  const draft = await browserKeyBackend.beginEnrollment("Firefox on Linux");
  await browserKeyBackend.confirmRecoveryKit(draft.principalId);
  const signed = await browserKeyBackend.signEnrollment(draft.draftId, ACCOUNT, CHALLENGE);
  await browserKeyBackend.settle(ACCOUNT, draft.principalId);
  return {
    draft,
    principalId: draft.principalId,
    keyLog: signed.keyLog,
    certificate: signed.device,
  };
}

async function storedFor(principalId: string): Promise<BrowserKeyRecord> {
  const [found] = await principalRecords(principalId);
  return found;
}

/** A signup's or enrollment's statements, checked as the server checks them. */
async function checkEnrollment(
  input: { keyLog: Statement[]; device: Statement; proof: Statement },
  principalId: string,
): Promise<void> {
  const head = await replay(input.keyLog);
  expect(head.principalId).toBe(principalId);
  expect(head.recoveryKey).not.toBe(head.identityKey);
  const device = await certifiedDevice(input.device, head);
  expect(await verify(input.proof, CONTEXT.login, device.deviceKey, 2)).toBe(true);
  expect(Object.keys(JSON.parse(input.keyLog[0].payload))).toEqual([
    "v",
    "type",
    "seq",
    "identityKey",
    "recoveryKey",
    "createdAt",
  ]);
  expect(JSON.parse(input.proof.payload)).toMatchObject({
    v: 2,
    type: "login",
    audience: "localhost:8080",
    principalId,
    deviceId: device.deviceId,
  });
}

describe("the web app creating an identity", () => {
  it("enrolls: the keys are stored before enrollIdentityKey and the card lists the device", async () => {
    const draft = await beginEnrollment("Firefox on Linux");
    let storedWhileEnrolling: BrowserKeyRecord | undefined;
    let input: { keyLog: Statement[]; device: Statement; proof: Statement } | undefined;
    let card: Statement | undefined;
    serve({
      KeyLoginChallenge: { keyLoginChallenge: CHALLENGE },
      EnrollIdentityKey: async (vars: { input: typeof input }) => {
        storedWhileEnrolling = await storedFor(draft.principalId);
        input = vars.input;
        return { enrollIdentityKey: { principalId: draft.principalId } };
      },
      MyKeyIdentity: () => ({
        myKeyIdentity: identityOf(input?.keyLog ?? [], [input?.device as Statement]),
      }),
      PublishProfileCard: (vars: { card: Statement }) => {
        card = vars.card;
        return { publishProfileCard: { version: 1 } };
      },
    });

    await completeEnrollment(draft, { ...ACCOUNT, displayName: "Ada" });

    expect(storedWhileEnrolling?.identity?.privateKey.extractable).toBe(false);
    expect(storedWhileEnrolling?.deviceKey.extractable).toBe(false);
    if (!input || !card) throw new Error("the server was not asked");
    await checkEnrollment(input, draft.principalId);
    const head = await replay(input.keyLog);
    expect(storedWhileEnrolling?.identity?.publicKey).toBe(head.identityKey);
    const published = await verifiedCard(card, head);
    expect(published.devices).toEqual([await certifiedDevice(input.device, head)]);
    // Saved before sending: no kit secret is kept.
    expect(storedWhileEnrolling).toMatchObject({ kitConfirmed: true });
    expect(storedWhileEnrolling?.recoveryEntropy).toBeUndefined();
    expect(await listDeviceKeyAccounts()).toEqual([
      expect.objectContaining({
        principalId: draft.principalId,
        userId: "user-1",
        hasIdentityKey: true,
        confirmed: true,
      }),
    ]);
  });

  it("signs up with the kit saved later: the entropy is kept, even across a reload, until confirmed", async () => {
    const draft = await beginEnrollment("Firefox on Linux");
    let storedWhileSigningUp: BrowserKeyRecord | undefined;
    serve({
      KeyLoginChallenge: { keyLoginChallenge: CHALLENGE },
      SignupWithKey: async (vars: {
        input: { keyLog: Statement[]; device: Statement; proof: Statement };
      }) => {
        storedWhileSigningUp = await storedFor(draft.principalId);
        await checkEnrollment(vars.input, draft.principalId);
        return { signupWithKey: { userId: "user-1", serverId: null, csrfToken: "t" } };
      },
      MyKeyIdentity: new Error("card later"),
    });

    await signupWithKey(
      draft,
      { username: " ada ", instanceInviteToken: "invite" },
      { recoveryKit: "later" },
    );

    expect(storedWhileSigningUp).toMatchObject({ kitConfirmed: false, username: "ada" });
    expect(storedWhileSigningUp?.recoveryEntropy).toHaveLength(16);
    expect(await unsavedRecoveryKit(draft.principalId)).toEqual({
      principalId: draft.principalId,
      recoveryKit: draft.recoveryKit,
      recoveryPhrase: draft.recoveryPhrase,
    });
    vi.resetModules();
    const reloaded = (await import("./browserKeyBackend")).browserKeyBackend;
    expect((await reloaded.recoveryKit(draft.principalId))?.recoveryKit).toBe(draft.recoveryKit);

    await confirmRecoveryKitSaved(draft.principalId);
    const after = await storedFor(draft.principalId);
    expect(after).toMatchObject({ kitConfirmed: true, confirmed: true, userId: "user-1" });
    expect(after.recoveryEntropy).toBeUndefined();
    expect(await reloaded.recoveryKit(draft.principalId)).toBeNull();
  });

  it("a refused signup removes the keys and keeps the draft, so a retry signs the same keys", async () => {
    const draft = await beginEnrollment("Firefox on Linux");
    const sent: string[] = [];
    let refuse = true;
    serve({
      KeyLoginChallenge: { keyLoginChallenge: CHALLENGE },
      SignupWithKey: (vars: { input: { keyLog: Statement[] } }) => {
        sent.push(vars.input.keyLog[0].payload);
        return refuse
          ? serverError("VALIDATION")
          : { signupWithKey: { userId: "user-1", serverId: null } };
      },
      KeyLog: { keyLog: [] },
      MyKeyIdentity: new Error("card later"),
    });
    const fields = { username: "ada", instanceInviteToken: "invite" };

    await expect(signupWithKey(draft, fields)).rejects.toBeInstanceOf(ClientError);
    expect(await principalRecords(draft.principalId)).toEqual([]);

    refuse = false;
    await expect(signupWithKey(draft, fields)).resolves.toMatchObject({ userId: "user-1" });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    expect(await storedFor(draft.principalId)).toMatchObject({ confirmed: true });
  });

  it("a signup whose answer was lost signs in with the device key", async () => {
    const draft = await beginEnrollment("Firefox on Linux");
    let inception: Statement | undefined;
    let certificate: Statement | undefined;
    serve({
      KeyLoginChallenge: { keyLoginChallenge: CHALLENGE },
      SignupWithKey: (vars: { input: { keyLog: Statement[]; device: Statement } }) => {
        [inception] = vars.input.keyLog;
        certificate = vars.input.device;
        return new Error("Failed to fetch");
      },
      KeyLog: () => ({ keyLog: [{ seq: 0, statement: inception }] }),
      LoginWithKey: async (vars: { proof: Statement }) => {
        const head = await replay([inception as Statement]);
        const device = await certifiedDevice(certificate as Statement, head);
        expect(await verify(vars.proof, CONTEXT.login, device.deviceKey, 2)).toBe(true);
        return { loginWithKey: { userId: "user-1" } };
      },
      MeKeyAccount: { me: { ...ME, principalId: draft.principalId } },
      MyKeyIdentity: new Error("card later"),
    });

    await expect(
      signupWithKey(draft, { username: "ada", instanceInviteToken: "invite" }),
    ).resolves.toEqual({ userId: "user-1", serverId: null });
    expect(await storedFor(draft.principalId)).toMatchObject({ confirmed: true, userId: "user-1" });
  });

  it("a key store that cannot be written stops the signup before it is sent", async () => {
    const draft = await beginEnrollment("Firefox on Linux");
    const asked = serve({ KeyLoginChallenge: { keyLoginChallenge: CHALLENGE } });
    const factory = globalThis.indexedDB;
    // @ts-expect-error -- a browser whose storage is gone
    delete globalThis.indexedDB;
    try {
      await expect(
        signupWithKey(draft, { username: "ada", instanceInviteToken: "invite" }),
      ).rejects.toThrow("this browser cannot store keys");
    } finally {
      globalThis.indexedDB = factory;
    }
    expect(asked).not.toContain("SignupWithKey");
  });

  it("keeps an in-flight draft's keys when the server does not show them yet", async () => {
    const draft = await browserKeyBackend.beginEnrollment("Firefox on Linux");
    await browserKeyBackend.signEnrollment(draft.draftId, ACCOUNT, CHALLENGE);
    expect(await browserKeyBackend.settle(ACCOUNT, null)).toBeNull();
    expect(await storedFor(draft.principalId)).toMatchObject({
      confirmed: false,
      userId: "user-1",
    });
    await browserKeyBackend.discardEnrollment(draft.draftId);
    expect(await principalRecords(draft.principalId)).toEqual([]);
  });
});

describe("the web app recovering an account", () => {
  /** An account whose recovery key is the vector phrase's, enrolled by another device. */
  async function lostAccount() {
    const identity = await keyFromSeed(1);
    const inception = await signInception(
      identity.privateKey,
      identity.publicKey,
      KIT_RECOVERY_KEY,
      AT,
    );
    const principalId = await principalIdOf(inception.payload);
    return {
      principalId,
      inception,
      kit: await formatKit(principalId, fromHex(KIT_ENTROPY)),
    };
  }

  it("rotates with the phrase's recovery key, stores the new keys and signs in", async () => {
    const { principalId, inception, kit } = await lostAccount();
    const log: Statement[] = [inception];
    let device: Statement | undefined;
    serve({
      KeyLog: () => ({ keyLog: log.map((statement, seq) => ({ seq, statement })) }),
      RotateIdentityKey: async (vars: { input: { entry: Statement; device: Statement } }) => {
        log.push(vars.input.entry);
        device = vars.input.device;
        return { rotateIdentityKey: { principalId, keySeq: 1 } };
      },
      KeyLoginChallenge: { keyLoginChallenge: CHALLENGE },
      LoginWithKey: async (vars: { proof: Statement }) => {
        const key = await certifiedDevice(device as Statement, await replay(log));
        expect(await verify(vars.proof, CONTEXT.login, key.deviceKey, 2)).toBe(true);
        return { loginWithKey: { userId: "user-1" } };
      },
      MeKeyAccount: { me: { ...ME, principalId } },
    });

    await expect(recoverAccount(kit, null, "Firefox on Linux")).resolves.toBe("user-1");

    const head = await replay(log);
    expect(head).toMatchObject({
      seq: 1,
      recoveryKey: KIT_RECOVERY_KEY,
      signers: [null, "recovery"],
    });
    expect(JSON.parse((device as Statement).payload)).toMatchObject({ keySeq: 1 });
    const kept = await storedFor(principalId);
    expect(kept.identity?.publicKey).toBe(head.identityKey);
    expect(kept.identity?.privateKey.extractable).toBe(false);
    expect(kept).toMatchObject({ confirmed: true, userId: "user-1", kitConfirmed: true });
  });

  it("a refused recovery puts back the confirmed keys it replaced", async () => {
    const { principalId, inception, kit } = await lostAccount();
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
    ])) as CryptoKeyPair;
    const before: BrowserKeyRecord = {
      v: 1,
      endpoint: ENDPOINT,
      principalId,
      deviceId: "device-before",
      deviceName: "Old browser",
      deviceKey: pair.privateKey,
      confirmed: true,
      userId: "user-1",
      username: "ada",
    };
    await update(ENDPOINT, () => ({ put: [before] }));
    serve({
      KeyLog: { keyLog: [{ seq: 0, statement: inception }] },
      RotateIdentityKey: serverError("FORBIDDEN"),
    });

    await expect(recoverAccount(kit, principalId, "Firefox on Linux")).rejects.toBeInstanceOf(
      ClientError,
    );
    expect(await storedFor(principalId)).toMatchObject({
      deviceId: "device-before",
      confirmed: true,
    });
    expect((await storedFor(principalId)).identity).toBeUndefined();
  });

  it("recovers an account enrolled with a version 1 kit, extending its log in version 2", async () => {
    // Appendix A: the version 1 log, whose recovery key has seed 101.
    const seed = new Uint8Array(32).fill(101);
    const check = (await sha256(concat(utf8("rim.recovery-kit.v1\0"), seed))).subarray(0, 3);
    const rk1 = ["RK1", ...(base32(concat(seed, check)).match(/.{1,4}/g) ?? [])].join("-");
    const principalId = "rimp1_nz1POml8JmCMcFDECrtu60ibohPKnywhcExmOPMvTUo";

    const signed = await browserKeyBackend.beginRecovery(
      ENDPOINT,
      `RIM recovery kit (v1)\nAccount id: ${principalId}\nRecovery key: ${rk1}\n`,
      null,
      [OTHER_INCEPTION],
      "Firefox on Linux",
    );

    expect(JSON.parse(signed.entry.payload)).toMatchObject({
      v: 2,
      prev: "o1oFYkMXfjtQJnG6as5GURR0cnzeYNYv5Br-LaeI78I",
      signer: "recovery",
    });
    const head = await replay([OTHER_INCEPTION, signed.entry]);
    expect((await certifiedDevice(signed.device, head)).deviceId).toBe(signed.deviceId);
  });

  it("refuses a kit of another account, and an account this server does not have", async () => {
    const { principalId, inception, kit } = await lostAccount();
    await expect(
      browserKeyBackend.beginRecovery(ENDPOINT, kit, principalId, [], "Firefox on Linux"),
    ).rejects.toThrow("this server has no account with that account id");
    const words = await phraseWords(new Uint8Array(16).fill(7));
    await expect(
      browserKeyBackend.beginRecovery(ENDPOINT, words.join(" "), principalId, [inception], "x"),
    ).rejects.toThrow("this recovery phrase or key does not belong to that account");
    expect(await principalRecords(principalId)).toEqual([]);
  });
});

describe("the web app holding the identity key", () => {
  it("rotates: the new key is pending, signed again on a retry, and promoted by the log", async () => {
    const { principalId, keyLog } = await holder();
    const first = await browserKeyBackend.beginRotation(principalId, keyLog);
    const retry = await browserKeyBackend.beginRotation(principalId, keyLog);
    const next = JSON.parse(first.payload).identityKey as string;
    expect(JSON.parse(retry.payload).identityKey).toBe(next);
    expect((await storedFor(principalId)).pendingIdentity).toMatchObject({
      publicKey: next,
      seq: 1,
    });

    // A stale log says nothing about the pending key.
    expect(await browserKeyBackend.syncLog(principalId, keyLog)).toMatchObject({
      seq: 0,
      holdsIdentityKey: true,
    });
    expect((await storedFor(principalId)).pendingIdentity).toBeDefined();

    expect(await browserKeyBackend.syncLog(principalId, [...keyLog, first])).toMatchObject({
      seq: 1,
      holdsIdentityKey: true,
    });
    const promoted = await storedFor(principalId);
    expect(promoted.identity?.publicKey).toBe(next);
    expect(promoted.pendingIdentity).toBeUndefined();
  });

  it("drops a pending key once the log holds its seq with another key", async () => {
    const { principalId, keyLog } = await holder();
    await browserKeyBackend.beginRotation(principalId, keyLog);
    const current = (await storedFor(principalId)).identity?.privateKey as CryptoKey;
    const elsewhere = await signRotation(
      await replay(keyLog),
      "identity",
      current,
      (await keyFromSeed(9)).publicKey,
      AT,
    );
    expect(await browserKeyBackend.syncLog(principalId, [...keyLog, elsewhere])).toMatchObject({
      holdsIdentityKey: false,
    });
    expect((await storedFor(principalId)).pendingIdentity).toBeUndefined();
    await expect(
      browserKeyBackend.signRevocation(principalId, [...keyLog, elsewhere], "other-device"),
    ).rejects.toThrow("does not hold the account's current identity key");
  });

  it("revokes its own device with the device key and others with the identity key", async () => {
    const { principalId, keyLog, certificate } = await holder();
    const head = await replay(keyLog);
    const own = certificateClaim(certificate);
    const other = "01999999-0000-7000-8000-000000000002";

    const selfRevoked = await browserKeyBackend.signRevocation(principalId, keyLog, own.deviceId);
    expect(JSON.parse(selfRevoked.payload).signer).toBe("device");
    expect(await verifiedRevocation(selfRevoked, head, own.deviceId, own.deviceKey)).toBe(true);
    const revoked = await browserKeyBackend.signRevocation(principalId, keyLog, other);
    expect(JSON.parse(revoked.payload).signer).toBe("identity");
    expect(await verifiedRevocation(revoked, head, other, own.deviceKey)).toBe(true);
  });

  it("signs a profile card listing only devices whose certificates verify", async () => {
    const { principalId, keyLog, certificate } = await holder();
    const card = await browserKeyBackend.signProfileCard(principalId, keyLog, {
      version: 2,
      displayName: " Ada ",
      relays: ["http://localhost:8080"],
      certificates: [certificate],
    });
    expect(await verifiedCard(card, await replay(keyLog))).toMatchObject({
      version: 2,
      displayName: "Ada",
      devices: [{ deviceId: certificateClaim(certificate).deviceId }],
    });

    const foreign = await sign(
      (await keyFromSeed(66)).privateKey,
      CONTEXT.device,
      certificate.payload,
    );
    await expect(
      browserKeyBackend.signProfileCard(principalId, keyLog, {
        version: 3,
        displayName: "Ada",
        relays: [],
        certificates: [foreign],
      }),
    ).rejects.toThrow("a device certificate does not verify");
  });
});

describe("the web app as the old device of a link", () => {
  const NEW_DEVICE_ID = "01999999-0000-7000-8000-00000000000a";

  async function offerFrom(code: string, change: Partial<Offer> = {}) {
    const offer: Offer = {
      deviceId: NEW_DEVICE_ID,
      deviceKey: (await keyFromSeed(77)).publicKey,
      name: "Phone",
      platform: "web",
      statementVersion: 2,
      ...change,
    };
    const plaintext = offerPlaintext(offer);
    return { offer, plaintext, sealed: await seal(parseLinkCode(code), "offer", plaintext) };
  }

  it("links a new device: certificate, pending record before addDeviceKey, answer, card", async () => {
    const { principalId, keyLog, certificate } = await holder();
    const identity = identityOf(keyLog, [certificate]);
    const link = { code: "", offer: undefined as Sealed | undefined, answered: false };
    const seen: { pendingWhileAdding?: number; added?: Statement; answer?: Sealed } = {};
    serve({
      StartDeviceLink: { startDeviceLink: { linkId: LINK_ID, expiresAt: AT } },
      DeviceLink: () => ({
        deviceLink: link.answered
          ? { state: DeviceLinkState.CONSUMED, expiresAt: AT, offer: null }
          : { state: DeviceLinkState.OFFERED, expiresAt: AT, offer: link.offer },
      }),
      MyKeyIdentity: { myKeyIdentity: identity },
      AddDeviceKey: async (vars: { certificate: Statement }) => {
        seen.pendingWhileAdding = (await pendingLinks()).length;
        seen.added = vars.certificate;
        return { addDeviceKey: { deviceId: NEW_DEVICE_ID } };
      },
      SendDeviceLinkAnswer: (vars: { answer: Sealed }) => {
        seen.answer = vars.answer;
        link.answered = true;
        return { sendDeviceLinkAnswer: { state: DeviceLinkState.ANSWERED, expiresAt: AT } };
      },
      PublishProfileCard: { publishProfileCard: { version: 1 } },
    });

    const started = await startLinkingDevice(identity);
    expect(started).toMatchObject({ linkId: LINK_ID, principalId });
    expect(parseLinkCode(started.code).endpoint).toBe(ENDPOINT);
    link.code = started.code;
    const { offer, plaintext, sealed } = await offerFrom(started.code);
    link.offer = sealed;

    expect(await waitForOffer(started, { sleep })).toEqual({
      deviceId: NEW_DEVICE_ID,
      name: "Phone",
      platform: "web",
      fingerprint: await fingerprint(plaintext),
    });
    await confirmLink(started, "Ada's phone", "Ada", { sleep });

    expect(seen.pendingWhileAdding).toBe(1);
    const head = await replay(keyLog);
    expect(await certifiedDevice(seen.added as Statement, head)).toEqual({
      deviceId: NEW_DEVICE_ID,
      deviceKey: offer.deviceKey,
    });
    expect(certificateClaim(seen.added as Statement).name).toBe("Ada's phone");
    const opened = answerCertificate(
      await open(parseLinkCode(started.code), "answer", seen.answer as Sealed),
    );
    expect(opened).toEqual(seen.added);
    // Consumed: the pending record is gone.
    expect(await pendingLinks()).toEqual([]);
  });

  it("refuses an offer of the account's own key, and one sealed without the code's secret", async () => {
    const { principalId, keyLog, certificate } = await holder();
    const identity = identityOf(keyLog, [certificate]);
    const devices = identity.devices.map((d) => ({ deviceId: d.deviceId, publicKey: d.publicKey }));
    const head = await replay(keyLog);

    const issued = await browserKeyBackend.linkBegin(principalId, ENDPOINT, LINK_ID);
    const own = await offerFrom(issued.code, { deviceKey: head.identityKey });
    await expect(
      browserKeyBackend.linkReviewOffer(LINK_ID, keyLog, devices, own.sealed),
    ).rejects.toThrow("the new device offered one of this account's own keys");
    const used = await offerFrom(issued.code, { deviceId: devices[0].deviceId });
    await expect(
      browserKeyBackend.linkReviewOffer(LINK_ID, keyLog, devices, used.sealed),
    ).rejects.toThrow("the new device's id is already used by a device of this account");

    const forged = await offerFrom(CODE);
    await expect(
      browserKeyBackend.linkReviewOffer(LINK_ID, keyLog, devices, forged.sealed),
    ).rejects.toThrow(/someone other than your new device used this code/);
    await browserKeyBackend.linkEnd(LINK_ID);
  });

  it("confirms once, and a reload resumes the same answer from the pending record", async () => {
    const { principalId, keyLog, certificate } = await holder();
    const identity = identityOf(keyLog, [certificate]);
    const devices = identity.devices.map((d) => ({ deviceId: d.deviceId, publicKey: d.publicKey }));
    const issued = await browserKeyBackend.linkBegin(principalId, ENDPOINT, LINK_ID);
    const { sealed } = await offerFrom(issued.code);
    await browserKeyBackend.linkReviewOffer(LINK_ID, keyLog, devices, sealed);
    const answer = await browserKeyBackend.linkConfirm(LINK_ID, keyLog, "Phone");
    expect(await browserKeyBackend.linkConfirm(LINK_ID, keyLog, "Another name")).toEqual(answer);
    // Live in this page: nothing to resume.
    expect(await browserKeyBackend.linkPending(ENDPOINT)).toEqual([]);

    vi.resetModules();
    const reloaded = (await import("./browserKeyBackend")).browserKeyBackend;
    expect(await reloaded.linkPending("http://localhost:8080/api/")).toEqual([
      { linkId: LINK_ID, principalId, deviceId: NEW_DEVICE_ID, deviceKey: answer.deviceKey },
    ]);
    expect(await reloaded.linkResume(LINK_ID)).toEqual(answer);
    await reloaded.linkEnd(LINK_ID);
    expect(await pendingLinks()).toEqual([]);
  });
});

describe("browser storage", () => {
  function storage(value: unknown) {
    Object.defineProperty(navigator, "storage", { value, configurable: true });
  }

  it("asks to keep the storage and records a refusal for the UI", async () => {
    try {
      storage({ persisted: async () => false, persist: async () => false });
      expect(await browserKeyBackend.persistStorage()).toBe("refused");
      expect(useKeyStorageStore.getState().persistence).toBe("refused");
      storage({ persisted: async () => false, persist: async () => true });
      expect(await browserKeyBackend.persistStorage()).toBe("persisted");
      storage({ persisted: async () => true, persist: vi.fn() });
      expect(await browserKeyBackend.persistStorage()).toBe("persisted");
      storage(undefined);
      expect(await browserKeyBackend.persistStorage()).toBe("unavailable");
    } finally {
      storage(undefined);
    }
  });
});
