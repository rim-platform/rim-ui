// The password's flows on the desktop, where the Tauri side runs OPAQUE behind a handle: the
// commands each step sends, and how their failures read.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
}));
const vault = vi.hoisted(() => ({ unlockVaultWithStoreKey: vi.fn() }));
vi.mock("../../../core/accountVault/accountVault", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../core/accountVault/accountVault")>()),
  ...vault,
}));

import { NeedsRecoveryError } from "../../../core/accountVault/dkWraps";
import { WrongPasswordError } from "../api/passwordApi";
import { changeRewrap, startLogin, startRegistration } from "./opaqueFlows";

const STORE_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Answers Tauri commands by name; an object with `kind` is the command's error. */
function commands(answers: Record<string, unknown>) {
  invokeMock.mockImplementation(async (command: string) => {
    const answer = answers[command];
    if (answer && typeof answer === "object" && "kind" in answer) {
      return { ok: false, error: answer };
    }
    return { ok: true, value: answer ?? null };
  });
}

const failure = (code: string) => ({ kind: "backend_error", code, message: code });

beforeEach(() => {
  invokeMock.mockReset();
  vault.unlockVaultWithStoreKey.mockReset();
});

describe("the desktop's password flows", () => {
  it("log in behind a handle and unlock, handing the webview the store key alone", async () => {
    commands({
      opaque_login_start: { handle: "h-1", request: "credential-request" },
      opaque_login_finish: { finalization: "finalization" },
      account_unlock_after_login: { webStoreKey: STORE_KEY, startedEmpty: false },
    });
    const login = await startLogin("pw");
    expect(login.request).toBe("credential-request");
    expect(await login.finish("response")).toBe("finalization");
    await expect(
      login.unlock({
        endpoint: "http://localhost:8080/api",
        principalId: "rimp1_ada",
        serverShare: "sealed",
        rewraps: ["rw"],
        keep: true,
      }),
    ).resolves.toEqual({ startedEmpty: false });

    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual([
      "opaque_login_start",
      "opaque_login_finish",
      "account_unlock_after_login",
    ]);
    expect(invokeMock.mock.calls[2][1]).toEqual({
      handle: "h-1",
      principal: "rimp1_ada",
      sealedShare: "sealed",
      rewraps: ["rw"],
      keep: true,
      startEmpty: false,
    });
    expect(vault.unlockVaultWithStoreKey).toHaveBeenCalledWith(
      { endpoint: "http://localhost:8080/api", principalId: "rimp1_ada" },
      expect.any(Uint8Array),
    );
  });

  it("read a wrong password and data that needs the recovery phrase", async () => {
    commands({
      opaque_login_start: { handle: "h-1", request: "r" },
      opaque_login_finish: failure("WRONG_PASSWORD"),
    });
    const wrong = await startLogin("pw");
    await expect(wrong.finish("response")).rejects.toBeInstanceOf(WrongPasswordError);

    commands({
      opaque_login_start: { handle: "h-2", request: "r" },
      opaque_login_finish: { finalization: "f" },
      account_unlock_after_login: failure("NEEDS_RECOVERY"),
    });
    const login = await startLogin("pw");
    await login.finish("response");
    await expect(
      login.unlock({
        endpoint: "http://localhost:8080/api",
        principalId: "rimp1_ada",
        serverShare: "s",
        rewraps: [],
        keep: false,
      }),
    ).rejects.toBeInstanceOf(NeedsRecoveryError);
    expect(vault.unlockVaultWithStoreKey).not.toHaveBeenCalled();
  });

  it("make a change's rewrap on the Tauri side and apply it only when asked", async () => {
    commands({
      opaque_login_start: { handle: "h-login", request: "r" },
      opaque_login_finish: { finalization: "f" },
      opaque_registration_start: { handle: "h-registration", request: "rr" },
      opaque_registration_finish: { upload: "upload" },
      account_password_rewrap: { rewrap: "rewrap-1" },
    });
    const login = await startLogin("old");
    await login.finish("response");
    const registration = await startRegistration("new passphrase");
    expect(await registration.finish("registration-response")).toBe("upload");

    const change = await changeRewrap("rimp1_ada", login, "sealed", registration);
    expect(change.rewrap).toBe("rewrap-1");
    expect(invokeMock).toHaveBeenLastCalledWith("account_password_rewrap", {
      loginHandle: "h-login",
      sealedShare: "sealed",
      registrationHandle: "h-registration",
      principal: "rimp1_ada",
    });

    await change.commit();
    expect(invokeMock).toHaveBeenLastCalledWith("account_password_commit", {
      handle: "h-registration",
      principal: "rimp1_ada",
    });
  });
});
