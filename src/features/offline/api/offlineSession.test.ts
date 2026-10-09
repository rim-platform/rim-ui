import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const safeInvokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => safeInvokeMock(...args),
}));

import { getGraphqlEndpoint } from "../../../core/graphql/config";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { loadSessionRecord, persistSessionRecord, saveSessionRecord } from "./offlineSession";

const endpoint = getGraphqlEndpoint();

describe("persistSessionRecord", () => {
  let unsubscribe: () => void;
  const save = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    save.mockClear();
    useAuthStore.setState({ session: null });
    unsubscribe = persistSessionRecord(save);
  });

  afterEach(() => unsubscribe());

  it("records a sign-in and the sign-out after it", () => {
    useAuthStore.getState().setSession({ userId: "alice" });
    useAuthStore.getState().clearSession();

    expect(save.mock.calls).toEqual([
      [{ state: "signedIn", endpoint, userId: "alice" }],
      [{ state: "signedOut", endpoint }],
    ]);
  });

  it("writes nothing when the user did not change", () => {
    useAuthStore.getState().setSession({ userId: "alice" });
    useAuthStore.getState().setSession({ userId: "alice" });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("loadSessionRecord", () => {
  beforeEach(() => {
    safeInvokeMock.mockReset();
  });

  it("reads the keyring record for this server", async () => {
    safeInvokeMock.mockResolvedValue({
      ok: true,
      value: { state: "signedIn", endpoint, userId: "alice" },
    });
    expect(await loadSessionRecord()).toEqual({ state: "signedIn", endpoint, userId: "alice" });
    expect(safeInvokeMock).toHaveBeenCalledWith("offline_session_load", { endpoint });
  });

  it("is null when the keyring cannot be read", async () => {
    safeInvokeMock.mockResolvedValue({
      ok: false,
      error: { kind: "backend_error", code: "UNKNOWN", message: "no keyring" },
    });
    expect(await loadSessionRecord()).toBeNull();
  });

  // Runs last: after a save, this run answers from memory.
  it("answers with a sign-out saved this run, before the keyring write lands", async () => {
    safeInvokeMock.mockReturnValue(new Promise(() => {}));
    void saveSessionRecord({ state: "signedOut", endpoint });
    expect(await loadSessionRecord()).toEqual({ state: "signedOut", endpoint });
  });
});
