import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const tauri = vi.hoisted(() => ({ desktop: false }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => tauri.desktop,
}));
const accounts = vi.hoisted(() => vi.fn());
vi.mock("../../key-identity/api/keyBackend", () => ({
  keyBackend: () => ({ accounts }),
}));
const kept = vi.hoisted(() => vi.fn());
vi.mock("../api/accountLock", () => ({ accountUnlockKept: kept }));

import {
  lockVault,
  openValue,
  sealValue,
  unlockVault,
  vaultAccount,
} from "../../../core/accountVault/accountVault";
import { toB64, webStoreKey } from "../../../core/accountVault/crypto";
import { useUnlockGate } from "./unlockGate";

const DATA_KEY = new Uint8Array(32).fill(9);

beforeEach(() => {
  lockVault();
  tauri.desktop = false;
  accounts.mockResolvedValue([{ principalId: "rimp1_me", userId: "user-1" }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the unlock gate", () => {
  it("waits for the password in the web app", async () => {
    const { result } = renderHook(() => useUnlockGate("user-1"));
    expect(result.current).toBe("opening");
    await waitFor(() => expect(result.current).toBe("locked"));
    expect(kept).not.toHaveBeenCalled();
  });

  it("opens a kept account on the desktop with the store key the desktop hands over", async () => {
    await unlockVault({ endpoint: "x", principalId: "rimp1_me" }, DATA_KEY);
    const sealed = await sealValue("kept draft", "aad");
    lockVault();
    tauri.desktop = true;
    kept.mockResolvedValue({
      webStoreKey: toB64(await webStoreKey(DATA_KEY)),
      startedEmpty: false,
    });

    const { result } = renderHook(() => useUnlockGate("user-1"));
    await waitFor(() => expect(result.current).toBe("unlocked"));
    expect(kept).toHaveBeenCalledWith("rimp1_me");
    expect(vaultAccount()?.principalId).toBe("rimp1_me");
    expect(await openValue(sealed, "aad")).toBe("kept draft");
  });

  it("asks for the password on the desktop when the account is not kept", async () => {
    tauri.desktop = true;
    kept.mockResolvedValue(null);
    const { result } = renderHook(() => useUnlockGate("user-1"));
    await waitFor(() => expect(result.current).toBe("locked"));
  });

  it("asks for the password when this device holds no keys for the account", async () => {
    tauri.desktop = true;
    accounts.mockResolvedValue([]);
    const { result } = renderHook(() => useUnlockGate("user-1"));
    await waitFor(() => expect(result.current).toBe("locked"));
    expect(kept).not.toHaveBeenCalled();
  });
});
