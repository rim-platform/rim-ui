import { describe, it, expect, vi, beforeEach } from "vitest";

const safeInvokeMock = vi.fn();

vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => safeInvokeMock(...args),
}));

import {
  accountAddRecoveryWrap,
  accountForgetKeep,
  accountHasPasswordWrap,
  accountLock,
  accountPasswordCommit,
  accountPasswordRewrap,
  accountUnlockAfterLogin,
  accountUnlockAfterSignup,
  accountUnlockKept,
  accountUnlockWithRecovery,
  opaqueLoginFinish,
  opaqueLoginStart,
  opaqueRegistrationFinish,
  opaqueRegistrationStart,
} from "./accountLock";

describe("account lock commands", () => {
  beforeEach(() => {
    safeInvokeMock.mockReset();
    safeInvokeMock.mockResolvedValue({ ok: true, value: null });
  });

  it("send each command its arguments by name", async () => {
    await opaqueRegistrationStart("pw");
    await opaqueRegistrationFinish("h1", "resp");
    await opaqueLoginStart("pw");
    await opaqueLoginFinish("h2", "resp");
    await accountUnlockAfterLogin("h2", "rimp1_a", "sealed", ["r1"], true);
    await accountUnlockAfterSignup("h1", "rimp1_a", "share", null, false);
    await accountUnlockKept("rimp1_a");
    await accountUnlockWithRecovery("rimp1_a", "entropy");
    await accountLock("rimp1_a");
    await accountForgetKeep("rimp1_a");
    await accountPasswordRewrap("h3", "sealed", "h4", "rimp1_a");
    await accountPasswordCommit("h4", "rimp1_a");
    await accountAddRecoveryWrap("rimp1_a", "entropy");
    await accountHasPasswordWrap("rimp1_a");

    expect(safeInvokeMock.mock.calls).toEqual([
      ["opaque_registration_start", { password: "pw" }],
      ["opaque_registration_finish", { handle: "h1", response: "resp" }],
      ["opaque_login_start", { password: "pw" }],
      ["opaque_login_finish", { handle: "h2", response: "resp" }],
      [
        "account_unlock_after_login",
        {
          handle: "h2",
          principal: "rimp1_a",
          sealedShare: "sealed",
          rewraps: ["r1"],
          keep: true,
          startEmpty: false,
        },
      ],
      [
        "account_unlock_after_signup",
        { handle: "h1", principal: "rimp1_a", share: "share", recoveryEntropy: null, keep: false },
      ],
      ["account_unlock_kept", { principal: "rimp1_a" }],
      ["account_unlock_with_recovery", { principal: "rimp1_a", entropy: "entropy" }],
      ["account_lock", { principal: "rimp1_a" }],
      ["account_forget_keep", { principal: "rimp1_a" }],
      [
        "account_password_rewrap",
        {
          loginHandle: "h3",
          sealedShare: "sealed",
          registrationHandle: "h4",
          principal: "rimp1_a",
        },
      ],
      ["account_password_commit", { handle: "h4", principal: "rimp1_a" }],
      ["account_add_recovery_wrap", { principal: "rimp1_a", entropy: "entropy" }],
      ["account_has_password_wrap", { principal: "rimp1_a" }],
    ]);
  });

  it("returns what the command answered", async () => {
    safeInvokeMock.mockResolvedValue({
      ok: true,
      value: { webStoreKey: "key", startedEmpty: false },
    });
    await expect(accountUnlockKept("rimp1_a")).resolves.toEqual({
      webStoreKey: "key",
      startedEmpty: false,
    });
  });

  it("throws the command's error", async () => {
    const error = { kind: "backend_error", code: "WRONG_PASSWORD", message: "wrong" };
    safeInvokeMock.mockResolvedValue({ ok: false, error });
    await expect(opaqueLoginFinish("h", "resp")).rejects.toBe(error);
  });
});
