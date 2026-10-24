import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../core/graphql/config", () => ({
  getGraphqlEndpoint: () => "http://localhost:8080/api",
}));
const desktop = vi.hoisted(() => ({ value: false }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => desktop.value,
}));
const keyCommand = vi.hoisted(() => vi.fn());
vi.mock("../../key-identity/api/keyBackend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../key-identity/api/keyBackend")>()),
  keyCommand,
}));
const signReset = vi.hoisted(() => vi.fn());
vi.mock("../../key-identity/browser/recoveryKit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../key-identity/browser/recoveryKit")>()),
  signPasswordReset: signReset,
}));
const flows = vi.hoisted(() => ({
  startLogin: vi.fn(),
  startRegistration: vi.fn(),
  changeRewrap: vi.fn(),
}));
vi.mock("./opaqueFlows", () => flows);

import { WrongPasswordError } from "../api/passwordApi";
import { changePassword, resetPassword } from "./passwordChanges";

const PRINCIPAL = "rimp1_ada";
const STATEMENT = { payload: "{}", signature: "ed25519:reset" };

function operation(call: unknown[]): string {
  return /(?:query|mutation)\s+(\w+)/.exec(String(call[0]))?.[1] ?? "";
}

/** Answers server operations by name; an Error answer is thrown. */
function server(answers: Record<string, unknown>) {
  requestMock.mockImplementation(async (doc: unknown) => {
    const name = operation([doc]);
    if (!(name in answers)) throw new Error(`unexpected request ${name}`);
    const answer = answers[name];
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

function fakeLogin(request: string, finalization: string | Error) {
  return {
    request,
    finish: vi.fn(async () => {
      if (finalization instanceof Error) throw finalization;
      return finalization;
    }),
    unlock: vi.fn(),
    close: vi.fn(),
  };
}

function fakeRegistration() {
  return {
    request: "registration-request",
    finish: vi.fn(async () => "registration-upload"),
    unlockAfterSignup: vi.fn(async () => ({ startedEmpty: true })),
    close: vi.fn(),
  };
}

beforeEach(() => {
  requestMock.mockReset();
  keyCommand.mockReset();
  signReset.mockReset();
  Object.values(flows).forEach((fn) => fn.mockReset());
  desktop.value = false;
});

describe("changePassword", () => {
  const change = {
    PasswordLoginStart: { passwordLoginStart: { loginId: "login-1", response: "response-1" } },
    PasswordLoginFinish: {
      passwordLoginFinish: { ticket: "t", serverShare: "sealed-share", rewraps: [] },
    },
    PasswordChangeStart: {
      passwordChangeStart: {
        loginId: "change-1",
        credentialResponse: "credential-response",
        registrationResponse: "registration-response",
      },
    },
    PasswordChangeFinish: { passwordChangeFinish: { changedAt: "2026-10-24T00:00:00Z" } },
  };

  it("opens the share with a login, then changes with the rewrap and rewraps this device", async () => {
    const shareLogin = fakeLogin("credential-request-1", "finalization-1");
    const check = fakeLogin("credential-request-2", "finalization-2");
    const registration = fakeRegistration();
    flows.startLogin.mockResolvedValueOnce(shareLogin).mockResolvedValueOnce(check);
    flows.startRegistration.mockResolvedValue(registration);
    const commit = vi.fn(async () => undefined);
    flows.changeRewrap.mockResolvedValue({ rewrap: "rewrap-1", commit, discard: vi.fn() });
    server(change);

    await changePassword(PRINCIPAL, "old password", "new passphrase!");

    expect(flows.startLogin.mock.calls).toEqual([["old password"], ["old password"]]);
    expect(flows.startRegistration).toHaveBeenCalledWith("new passphrase!");
    expect(requestMock.mock.calls.map(operation)).toEqual([
      "PasswordLoginStart",
      "PasswordLoginFinish",
      "PasswordChangeStart",
      "PasswordChangeFinish",
    ]);
    expect(requestMock.mock.calls[2][1]).toEqual({
      credentialRequest: "credential-request-2",
      registrationRequest: "registration-request",
    });
    expect(flows.changeRewrap).toHaveBeenCalledWith(
      PRINCIPAL,
      shareLogin,
      "sealed-share",
      registration,
    );
    expect(requestMock.mock.calls[3][1]).toEqual({
      loginId: "change-1",
      credentialFinalization: "finalization-2",
      registrationUpload: "registration-upload",
      rewrap: "rewrap-1",
    });
    expect(commit).toHaveBeenCalled();
    expect(commit.mock.invocationCallOrder[0]).toBeGreaterThan(
      requestMock.mock.invocationCallOrder[3],
    );
    for (const flow of [shareLogin, check, registration]) expect(flow.close).toHaveBeenCalled();
  });

  it("stops at a wrong current password, before the change starts", async () => {
    flows.startLogin
      .mockResolvedValueOnce(fakeLogin("r1", new WrongPasswordError()))
      .mockResolvedValueOnce(fakeLogin("r2", "f2"));
    flows.startRegistration.mockResolvedValue(fakeRegistration());
    server(change);

    await expect(changePassword(PRINCIPAL, "wrong", "new passphrase!")).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    expect(requestMock.mock.calls.map(operation)).toEqual(["PasswordLoginStart"]);
  });

  it("leaves this device's wrap as it was when the server refuses the change", async () => {
    flows.startLogin
      .mockResolvedValueOnce(fakeLogin("r1", "f1"))
      .mockResolvedValueOnce(fakeLogin("r2", "f2"));
    flows.startRegistration.mockResolvedValue(fakeRegistration());
    const commit = vi.fn();
    const discard = vi.fn();
    flows.changeRewrap.mockResolvedValue({ rewrap: "rewrap-1", commit, discard });
    const refused = new Error("expired");
    server({ ...change, PasswordChangeFinish: refused });

    await expect(changePassword(PRINCIPAL, "old", "new passphrase!")).rejects.toBe(refused);
    expect(commit).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  const reset = {
    PasswordResetChallenge: { passwordResetChallenge: { challengeId: "c-1", nonce: "n-1" } },
    PasswordResetStart: {
      passwordResetStart: { resetId: "reset-1", registrationResponse: "registration-response" },
    },
    PasswordResetFinish: { passwordResetFinish: true },
  };

  it("signs the reset with the phrase's recovery key in the browser, then registers the new password", async () => {
    const registration = fakeRegistration();
    flows.startRegistration.mockResolvedValue(registration);
    signReset.mockResolvedValue(STATEMENT);
    server(reset);
    const entropy = new Uint8Array(16).fill(3);

    await resetPassword(PRINCIPAL, entropy, "new passphrase!");

    expect(signReset).toHaveBeenCalledWith("http://localhost:8080/api", PRINCIPAL, entropy, {
      challengeId: "c-1",
      nonce: "n-1",
    });
    expect(requestMock.mock.calls.map(operation)).toEqual([
      "PasswordResetChallenge",
      "PasswordResetStart",
      "PasswordResetFinish",
    ]);
    expect(requestMock.mock.calls[1][1]).toEqual({
      statement: STATEMENT,
      registrationRequest: "registration-request",
    });
    expect(registration.finish).toHaveBeenCalledWith("registration-response");
    expect(requestMock.mock.calls[2][1]).toEqual({
      resetId: "reset-1",
      registrationUpload: "registration-upload",
    });
    expect(registration.close).toHaveBeenCalled();
  });

  it("signs it on the Tauri side on the desktop", async () => {
    desktop.value = true;
    flows.startRegistration.mockResolvedValue(fakeRegistration());
    keyCommand.mockResolvedValue(STATEMENT);
    server(reset);

    await resetPassword(PRINCIPAL, new Uint8Array(16).fill(255), "new passphrase!");

    expect(keyCommand).toHaveBeenCalledWith("key_identity_sign_password_reset", {
      endpoint: "http://localhost:8080/api",
      principalId: PRINCIPAL,
      entropy: "_____________________w",
      challenge: { challengeId: "c-1", nonce: "n-1" },
    });
    expect(signReset).not.toHaveBeenCalled();
  });
});
