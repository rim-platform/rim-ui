// A password change in the page, then a sign-out and a sign-in, through the real password change,
// sign-out, sign-in, unlock and browser key store, with the OPAQUE flows and the server stood in:
// the new password opens the account after a sign-out that keeps it, and after "Sign out and
// remove from this device" the sign-in list is read again and a sign-in for the removed account
// sends nothing and writes nothing.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { QueryClient } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as opaque from "../opaque/wasm/rim_opaque_wasm";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../core/graphql/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/graphql/config")>()),
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));
vi.mock("../api/sessionKeys", () => ({
  setReloadKey: async () => "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
}));

const fake = vi.hoisted(() => ({ mod: null as unknown }));
vi.mock("../opaque/opaqueModule", () => ({
  loadOpaque: async () => fake.mod,
  opaqueCode: (err: unknown) =>
    err instanceof Error && err.name.startsWith("OPAQUE_") ? err.name : undefined,
}));

import { lockVault } from "../../../core/accountVault/accountVault";
import { fromB64, seal, toB64 } from "../../../core/accountVault/crypto";
import { readWraps } from "../../../core/accountVault/dkWraps";
import { NoDeviceKeysError, signInWithPassword } from "../../key-identity/api/keyIdentity";
import { insert, record, signingKey, storedRecord } from "../../key-identity/browser/keyStore";
import { WrongPasswordError } from "../api/passwordApi";
import { useAuthStore } from "../state/useAuthStore";
import { unlockAfterSignup } from "./accountUnlock";
import { changePassword } from "./passwordChanges";
import { signOut } from "./signOut";

const ENDPOINT = "http://localhost:8080/api";
const PRINCIPAL = "rimp1_gCe9rL-U8tJXIPz_3ZZlu1yhaGJ6cv7zXgpTQjg9FUI";
const SHARE = new Uint8Array(32).fill(0x33);
const OLD = "old passphrase 1";
const NEW = "new passphrase 22";

const enc = new TextEncoder();

/** A stand-in export key of a password: the same bytes for the same password. */
function derive(password: string): Uint8Array {
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    let h = 2166136261 ^ i;
    for (const c of password) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    out[i] = h & 0xff;
  }
  return out;
}

let serverPassword = OLD;
let rewraps: string[] = [];
let devicePublic: CryptoKey;

/** The operation name of a GraphQL document. */
function operation(doc: unknown): string | undefined {
  return /(?:query|mutation)\s+(\w+)/.exec(String(doc))?.[1];
}

/** A server that checks the password the stand-in OPAQUE flows send in the clear. */
function server() {
  requestMock.mockImplementation(async (doc: unknown, vars: Record<string, string>) => {
    const matches = (request: string) =>
      new TextDecoder().decode(fromB64(request, "request")) === serverPassword;
    switch (operation(doc)) {
      case "PasswordLoginStart":
        return {
          passwordLoginStart: {
            loginId: "l",
            response: toB64(new Uint8Array([matches(vars.request) ? 1 : 0])),
          },
        };
      case "PasswordLoginFinish": {
        const sessionKey = fromB64(vars.credentialFinalization, "finalization");
        const transport = opaque.transportKey(sessionKey, "server share");
        return {
          passwordLoginFinish: {
            ticket: "t",
            serverShare: toB64(await seal(transport, new Uint8Array(), SHARE)),
            rewraps,
          },
        };
      }
      case "PasswordChangeStart":
        return {
          passwordChangeStart: {
            loginId: "c",
            credentialResponse: toB64(new Uint8Array([matches(vars.credentialRequest) ? 1 : 0])),
            registrationResponse: "AA",
          },
        };
      case "PasswordChangeFinish":
        serverPassword = new TextDecoder().decode(fromB64(vars.registrationUpload, "upload"));
        rewraps = [vars.rewrap, ...rewraps];
        return { passwordChangeFinish: { ok: true } };
      case "Logout":
        return { logout: true };
      case "KeyLoginChallenge":
        return { keyLoginChallenge: { challengeId: "ch", nonce: "bm9uY2U" } };
      case "LoginWithKey":
        return { loginWithKey: { userId: "user-1", sessionSecret: "c2VjcmV0", keepKey: null } };
      case "MeKeyAccount":
        return { me: { id: "user-1", username: "ada", principalId: PRINCIPAL } };
      default:
        throw new Error(`unexpected ${operation(doc)}`);
    }
  });
}

beforeAll(() => {
  opaque.initSync({
    module: readFileSync(
      join(process.cwd(), "src/features/auth/opaque/wasm/rim_opaque_wasm_bg.wasm"),
    ),
  });
  class FakeLogin {
    constructor(private password: string) {}
    request() {
      return enc.encode(this.password);
    }
    finish(response: Uint8Array) {
      if (response[0] !== 1) {
        const err = new Error("wrong password");
        err.name = "OPAQUE_WRONG_PASSWORD";
        throw err;
      }
      const sessionKey = crypto.getRandomValues(new Uint8Array(64));
      return { exportKey: derive(this.password), sessionKey, finalization: sessionKey.slice() };
    }
    free() {}
  }
  class FakeRegistration {
    constructor(private password: string) {}
    request() {
      return enc.encode(this.password);
    }
    finish() {
      return { exportKey: derive(this.password), upload: enc.encode(this.password) };
    }
    free() {}
  }
  fake.mod = { ...opaque, OpaqueLogin: FakeLogin, OpaqueRegistration: FakeRegistration };
});

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  lockVault();
  serverPassword = OLD;
  rewraps = [];
  requestMock.mockReset();
  server();
  const device = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
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
  });
  await unlockAfterSignup({
    endpoint: ENDPOINT,
    principalId: PRINCIPAL,
    exportKey: derive(OLD),
    serverShare: toB64(SHARE),
    recoveryEntropy: new Uint8Array(16).fill(5),
  });
  useAuthStore.getState().setSession({ userId: "user-1" });
});

/** Whether the account's stored device key signs what its public key verifies. */
async function signsAsDevice(): Promise<boolean> {
  const r = await record(ENDPOINT, PRINCIPAL);
  if (!r) return false;
  const data = enc.encode("proof");
  const signature = await crypto.subtle.sign("Ed25519", signingKey(r), data);
  return crypto.subtle.verify("Ed25519", devicePublic, signature, data);
}

/** The operations the stand-in server was asked for. */
function requested(): (string | undefined)[] {
  return requestMock.mock.calls.map(([doc]) => operation(doc));
}

describe("signing in after a password change in the page", () => {
  it("signs in with the new password after a password change and a sign-out that keeps the account", async () => {
    await changePassword(PRINCIPAL, OLD, NEW);
    await signOut(new QueryClient());

    await expect(
      signInWithPassword(PRINCIPAL, { password: OLD, keep: false }),
    ).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(signInWithPassword(PRINCIPAL, { password: NEW, keep: false })).resolves.toEqual({
      userId: "user-1",
      startedEmpty: false,
    });
    expect(await record(ENDPOINT, PRINCIPAL)).not.toBeNull();
    expect(await signsAsDevice()).toBe(true);
    expect((await readWraps(ENDPOINT, PRINCIPAL))?.recoveryWrap).toBeDefined();

    await signOut(new QueryClient());
    await expect(signInWithPassword(PRINCIPAL, { password: NEW, keep: true })).resolves.toEqual({
      userId: "user-1",
      startedEmpty: false,
    });
    expect(await signsAsDevice()).toBe(true);
    expect((await readWraps(ENDPOINT, PRINCIPAL))?.recoveryWrap).toBeDefined();
  });

  it("reads the sign-in list again once Sign out and remove deleted the account", async () => {
    await changePassword(PRINCIPAL, OLD, NEW);
    const qc = new QueryClient();
    const storedAtRefresh: unknown[] = [];
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockImplementation(async () => {
      storedAtRefresh.push(await storedRecord(ENDPOINT, PRINCIPAL));
    });

    await signOut(qc, { remove: true });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deviceKeyAccounts", ENDPOINT] });
    expect(storedAtRefresh).toEqual([null]);
  });

  it("a sign-in for an account this browser holds no keys for sends nothing and writes nothing", async () => {
    await changePassword(PRINCIPAL, OLD, NEW);
    await signOut(new QueryClient(), { remove: true });
    requestMock.mockClear();

    await expect(
      signInWithPassword(PRINCIPAL, { password: NEW, keep: false }),
    ).rejects.toBeInstanceOf(NoDeviceKeysError);
    expect(requested()).not.toContain("PasswordLoginStart");
    expect(await readWraps(ENDPOINT, PRINCIPAL)).toBeNull();
  });
});
