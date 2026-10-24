// The web app's account unlock against the committed OPAQUE module: what a signup, a login, a
// reset elsewhere, the recovery phrase and a kept session open, and what locking takes away.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as opaque from "../opaque/wasm/rim_opaque_wasm";

vi.mock("../opaque/opaqueModule", () => ({ loadOpaque: async () => opaque }));
vi.mock("../api/sessionKeys", () => ({
  setReloadKey: async () => "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
}));

import {
  isVaultUnlocked,
  lockVault,
  VaultLockedError,
} from "../../../core/accountVault/accountVault";
import { seal, toB64 } from "../../../core/accountVault/crypto";
import { sessionSecret } from "../../../core/graphql/sessionSecret";
import { NeedsRecoveryError, readWraps } from "../../../core/accountVault/dkWraps";
import {
  insert,
  record,
  signingKey,
  storedRecord,
  type BrowserKeyRecord,
} from "../../key-identity/browser/keyStore";
import {
  addRecoveryWrapToUnlocked,
  commitPasswordChange,
  hasPasswordWrap,
  holdSession,
  keepUnlocked,
  lockAccount,
  passwordChangeRewrap,
  unlockAfterLogin,
  unlockAfterSignup,
  unlockKept,
  unlockWithRecovery,
} from "./accountUnlock";

const ENDPOINT = "http://localhost:8080/api";
const PRINCIPAL = "rimp1_gCe9rL-U8tJXIPz_3ZZlu1yhaGJ6cv7zXgpTQjg9FUI";
const SHARE = new Uint8Array(32).fill(0x33);
const ENTROPY = new Uint8Array(16).fill(0x55);

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

let devicePublic: CryptoKey;

async function pair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
}

/** The account's keys as a signup writes them, before its first unlock. */
async function signedUpKeys(): Promise<void> {
  const device = await pair();
  const identity = await pair();
  devicePublic = device.publicKey;
  await insert({
    v: 1,
    endpoint: ENDPOINT,
    principalId: PRINCIPAL,
    deviceId: "0199d1a0-0000-7000-8000-000000000001",
    deviceName: "Firefox on Linux",
    deviceKey: device.privateKey,
    confirmed: true,
    userId: "user-1",
    username: "ada",
    identity: { privateKey: identity.privateKey, publicKey: "ed25519:identity" },
    recoveryEntropy: new Uint8Array(ENTROPY),
    kitConfirmed: false,
  });
}

/** Whether `r`'s device key is this account's: it signs what its public key verifies. */
async function signsAsDevice(r: BrowserKeyRecord | null): Promise<boolean> {
  if (!r) return false;
  const data = new TextEncoder().encode("proof");
  const signature = await crypto.subtle.sign("Ed25519", signingKey(r), data);
  return crypto.subtle.verify("Ed25519", devicePublic, signature, data);
}

/** What `passwordLoginFinish` would answer a login with `sessionKey`: the share, sealed. */
async function sealedShare(sessionKey: Uint8Array): Promise<string> {
  const transport = opaque.transportKey(sessionKey, "server share");
  return toB64(await seal(transport, new Uint8Array(), SHARE));
}

async function login(exportKey: Uint8Array, startEmpty = false, rewraps: string[] = []) {
  const sessionKey = random(64);
  return unlockAfterLogin({
    endpoint: ENDPOINT,
    principalId: PRINCIPAL,
    exportKey,
    sessionKey,
    serverShare: await sealedShare(sessionKey),
    rewraps,
    startEmpty,
  });
}

async function signUp(exportKey: Uint8Array, recoveryEntropy: Uint8Array | null = ENTROPY) {
  await signedUpKeys();
  return unlockAfterSignup({
    endpoint: ENDPOINT,
    principalId: PRINCIPAL,
    exportKey,
    serverShare: toB64(SHARE),
    recoveryEntropy,
  });
}

beforeAll(() => {
  opaque.initSync({
    module: readFileSync(
      join(process.cwd(), "src/features/auth/opaque/wasm/rim_opaque_wasm_bg.wasm"),
    ),
  });
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  lockVault();
});

describe("unlocking an account in the web app", () => {
  it("seals the keys a signup wrote at its first unlock, and opens them at each login", async () => {
    const exportKey = random(64);
    expect(await signUp(exportKey)).toEqual({ startedEmpty: true });
    expect(isVaultUnlocked()).toBe(true);

    const stored = (await storedRecord(ENDPOINT, PRINCIPAL)) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(
      [
        "confirmed",
        "data",
        "deviceId",
        "deviceName",
        "deviceWrap",
        "endpoint",
        "kitConfirmed",
        "principalId",
        "userId",
        "username",
        "v",
      ].sort(),
    );
    const open = await record(ENDPOINT, PRINCIPAL);
    expect(open?.deviceKey?.extractable).toBe(false);
    expect(open?.identity?.privateKey.extractable).toBe(false);
    expect(open?.recoveryEntropy).toEqual(ENTROPY);
    expect(await signsAsDevice(open)).toBe(true);

    lockAccount();
    expect(isVaultUnlocked()).toBe(false);
    const locked = await record(ENDPOINT, PRINCIPAL);
    expect(locked).toMatchObject({ principalId: PRINCIPAL, userId: "user-1", deviceKey: null });
    expect(() => signingKey(locked as BrowserKeyRecord)).toThrow(VaultLockedError);

    expect(await login(exportKey)).toEqual({ startedEmpty: false });
    const reopened = await record(ENDPOINT, PRINCIPAL);
    expect(await signsAsDevice(reopened)).toBe(true);
    expect(reopened?.identity?.publicKey).toBe("ed25519:identity");
  });

  it("asks for the recovery phrase after a reset elsewhere, and changes nothing until then", async () => {
    await signUp(random(64));
    lockAccount();
    const wraps = await readWraps(ENDPOINT, PRINCIPAL);

    const afterReset = random(64);
    await expect(login(afterReset)).rejects.toBeInstanceOf(NeedsRecoveryError);
    expect(isVaultUnlocked()).toBe(false);
    expect(await readWraps(ENDPOINT, PRINCIPAL)).toEqual(wraps);

    expect(await unlockWithRecovery(ENDPOINT, PRINCIPAL, new Uint8Array(16))).toBe(false);
    expect(await unlockWithRecovery(ENDPOINT, PRINCIPAL, ENTROPY)).toBe(true);
    expect(await login(afterReset)).toEqual({ startedEmpty: false });
    const kept = await record(ENDPOINT, PRINCIPAL);
    expect(kept?.identity?.publicKey).toBe("ed25519:identity");
    expect(await signsAsDevice(kept)).toBe(true);

    lockAccount();
    expect(await login(afterReset)).toEqual({ startedEmpty: false });
  });

  it("starting empty keeps the device key through its wrap under the server share", async () => {
    await signUp(random(64));
    lockAccount();

    expect(await login(random(64), true)).toEqual({ startedEmpty: true });
    const fresh = await record(ENDPOINT, PRINCIPAL);
    expect(await signsAsDevice(fresh)).toBe(true);
    expect(fresh?.identity).toBeUndefined();
    expect(fresh?.recoveryEntropy).toBeUndefined();
    expect((await readWraps(ENDPOINT, PRINCIPAL))?.recoveryWrap).toBeUndefined();
  });

  it("opens a kept account with its session's keep key, until sign-out drops the keep wrap", async () => {
    await signUp(random(64), null);
    const keepKey = random(32);
    await keepUnlocked(keepKey);

    // Closing the page locks without signing out.
    lockVault();
    expect(await unlockKept(ENDPOINT, PRINCIPAL, random(32))).toBe(false);
    expect(await unlockKept(ENDPOINT, PRINCIPAL, keepKey)).toBe(true);
    expect(await signsAsDevice(await record(ENDPOINT, PRINCIPAL))).toBe(true);

    lockAccount();
    await vi.waitFor(async () =>
      expect((await readWraps(ENDPOINT, PRINCIPAL))?.keepWrap).toBeUndefined(),
    );
    expect(await unlockKept(ENDPOINT, PRINCIPAL, keepKey)).toBe(false);
  });

  it("refuses a server share sealed under another login", async () => {
    await signUp(random(64));
    lockAccount();
    await expect(
      unlockAfterLogin({
        endpoint: ENDPOINT,
        principalId: PRINCIPAL,
        exportKey: random(64),
        sessionKey: random(64),
        serverShare: await sealedShare(random(64)),
        rewraps: [],
      }),
    ).rejects.toThrow();
    expect(isVaultUnlocked()).toBe(false);
  });

  it("a password change leaves a rewrap that opens the old wrap, and rewraps this browser's data key", async () => {
    const before = random(64);
    const after = random(64);
    await signUp(before);
    const sessionKey = random(64);
    const { rewrap, newUnlockKey } = await passwordChangeRewrap({
      principalId: PRINCIPAL,
      oldExportKey: before,
      sessionKey,
      serverShare: await sealedShare(sessionKey),
      newExportKey: after,
    });

    // A device still wrapped under the old password opens with the new one and the rewrap.
    lockAccount();
    expect(await login(after, false, [rewrap])).toEqual({ startedEmpty: false });
    expect(await signsAsDevice(await record(ENDPOINT, PRINCIPAL))).toBe(true);

    // The device that changed it wraps its data key under the new unlock key at once.
    await commitPasswordChange(newUnlockKey);
    lockAccount();
    expect(await login(after)).toEqual({ startedEmpty: false });
    lockAccount();
    await expect(login(before)).rejects.toBeInstanceOf(NeedsRecoveryError);
  });

  it("adds the recovery wrap to the unlocked account once this browser holds the phrase", async () => {
    await signUp(random(64), null);
    expect((await readWraps(ENDPOINT, PRINCIPAL))?.recoveryWrap).toBeUndefined();

    await addRecoveryWrapToUnlocked(ENTROPY);
    lockAccount();
    expect(await unlockWithRecovery(ENDPOINT, PRINCIPAL, ENTROPY)).toBe(true);
    expect(await signsAsDevice(await record(ENDPOINT, PRINCIPAL))).toBe(true);

    lockAccount();
    await expect(addRecoveryWrapToUnlocked(ENTROPY)).rejects.toThrow(/no account is unlocked/);
  });

  it("holds an unkept session's secret, keeps it for a reload, and forgets both at sign-out", async () => {
    await signUp(random(64), null);
    await holdSession({ sessionSecret: "c2VjcmV0", keepKey: null });
    expect(sessionSecret()).toBe("c2VjcmV0");
    expect(sessionStorage.getItem(`rim:reload:${ENDPOINT}`)).not.toBeNull();

    lockAccount();
    expect(sessionSecret()).toBeNull();
    expect(sessionStorage.getItem(`rim:reload:${ENDPOINT}`)).toBeNull();
  });

  it("wraps the data key under a kept session's keep key", async () => {
    await signUp(random(64), null);
    const keepKey = random(32);
    await holdSession({ sessionSecret: null, keepKey: toB64(keepKey) });
    expect(sessionSecret()).toBeNull();
    lockVault();
    expect(await unlockKept(ENDPOINT, PRINCIPAL, keepKey)).toBe(true);
  });

  it("tells a browser that unlocked the account with its password from one that never did", async () => {
    expect(await hasPasswordWrap(ENDPOINT, PRINCIPAL)).toBe(false);
    await signUp(random(64));
    expect(await hasPasswordWrap(ENDPOINT, PRINCIPAL)).toBe(true);
  });
});
