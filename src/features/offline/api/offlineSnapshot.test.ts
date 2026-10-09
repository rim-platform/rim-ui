import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClientError } from "graphql-request";

const safeInvokeMock = vi.fn();
let account: { endpoint: string; userId: string } | null = null;

vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => safeInvokeMock(...args),
}));

vi.mock("../../messages/api/messageCache", async (importOriginal) => ({
  isServerUnreachable: (await importOriginal<typeof import("../../messages/api/messageCache")>())
    .isServerUnreachable,
  currentCacheAccount: () => account,
}));

import { useOfflineStore } from "../state/useOfflineStore";
import { withOfflineSnapshot } from "./offlineSnapshot";

const ALICE = { endpoint: "http://localhost:8080/api", userId: "alice" };

function unauthorized() {
  return new ClientError(
    { status: 401, headers: new Headers(), errors: [{ message: "unauthenticated" }] },
    { query: "query Me { me { id } }" },
  );
}

describe("withOfflineSnapshot", () => {
  beforeEach(() => {
    safeInvokeMock.mockReset().mockResolvedValue({ ok: true, value: null });
    account = ALICE;
    useOfflineStore.setState({ offline: false });
  });

  it("saves every server answer as the snapshot", async () => {
    const value = await withOfflineSnapshot("inbox", "ws-1", async () => ({ items: ["dm"] }));

    expect(value).toEqual({ items: ["dm"] });
    expect(safeInvokeMock).toHaveBeenCalledWith("message_cache_snapshot_put", {
      account: ALICE,
      kind: "inbox",
      workspaceId: "ws-1",
      value: { items: ["dm"] },
    });
  });

  it("keeps no answer that arrives after the account changed", async () => {
    const value = await withOfflineSnapshot("me", null, async () => {
      account = { ...ALICE, userId: "bob" };
      return { id: "alice" };
    });
    expect(value).toEqual({ id: "alice" });
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });

  it("answers with the saved copy when the server cannot be reached", async () => {
    safeInvokeMock.mockResolvedValue({
      ok: true,
      value: { value: [{ id: "ws-1", name: "Acme" }], savedAt: 1 },
    });

    const value = await withOfflineSnapshot("servers", null, () =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

    expect(value).toEqual([{ id: "ws-1", name: "Acme" }]);
    // A saved copy is never passed off as live: the app switches to offline mode.
    expect(useOfflineStore.getState().offline).toBe(true);
    expect(safeInvokeMock).toHaveBeenCalledWith("message_cache_snapshot_get", {
      account: ALICE,
      kind: "servers",
      workspaceId: null,
    });
  });

  it("never replaces an answer the server gave", async () => {
    const err = unauthorized();
    await expect(withOfflineSnapshot("me", null, () => Promise.reject(err))).rejects.toBe(err);
    expect(safeInvokeMock).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().offline).toBe(false);
  });

  it("rethrows when nothing was saved on this device", async () => {
    const err = new TypeError("Failed to fetch");
    await expect(
      withOfflineSnapshot("joinedChannels", "ws-1", () => Promise.reject(err)),
    ).rejects.toBe(err);
  });

  it("is just the fetch outside the desktop app", async () => {
    account = null;
    const err = new TypeError("Failed to fetch");
    expect(await withOfflineSnapshot("me", null, async () => "fresh")).toBe("fresh");
    await expect(withOfflineSnapshot("me", null, () => Promise.reject(err))).rejects.toBe(err);
    expect(safeInvokeMock).not.toHaveBeenCalled();
  });
});
