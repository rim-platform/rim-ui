import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ClientError } from "graphql-request";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useOfflineStore } from "../state/useOfflineStore";

const requestMock = vi.fn();
const wsConnectedListeners: (() => void)[] = [];

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../core/graphql/wsClient", () => ({
  onWsConnected: (listener: () => void) => {
    wsConnectedListeners.push(listener);
    return () => wsConnectedListeners.splice(wsConnectedListeners.indexOf(listener), 1);
  },
}));

import { checkSession, OFFLINE_RECHECK_MS, useOfflineReconnect } from "./useOfflineReconnect";

const networkDown = () => new TypeError("Failed to fetch");
const unauthorized = () =>
  new ClientError(
    { status: 401, headers: new Headers(), errors: [{ message: "unauthenticated" }] },
    { query: "query OfflineSessionCheck { me { id } }" },
  );

describe("checkSession", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("is online when the server still knows the user", async () => {
    requestMock.mockResolvedValue({ me: { id: "alice" } });
    expect(await checkSession("alice")).toBe("online");
  });

  it("is signed out when the server refuses the session", async () => {
    requestMock.mockRejectedValue(unauthorized());
    expect(await checkSession("alice")).toBe("signedOut");
  });

  it("is signed out when the cookie now belongs to someone else", async () => {
    requestMock.mockResolvedValue({ me: { id: "bob" } });
    expect(await checkSession("alice")).toBe("signedOut");
  });

  it("stays offline while the server cannot be reached", async () => {
    requestMock.mockRejectedValue(networkDown());
    expect(await checkSession("alice")).toBe("offline");
  });
});

describe("useOfflineReconnect", () => {
  const qc = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    vi.useFakeTimers();
    requestMock.mockReset();
    useAuthStore.setState({ session: { userId: "alice" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useOfflineStore.setState({ offline: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useOfflineStore.setState({ offline: false });
  });

  it("does nothing while online", async () => {
    useOfflineStore.setState({ offline: false });
    renderHook(() => useOfflineReconnect(), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_RECHECK_MS * 2));
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("keeps retrying offline, then leaves offline mode and refetches when the server is back", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    requestMock.mockRejectedValue(networkDown());
    renderHook(() => useOfflineReconnect(), { wrapper });

    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_RECHECK_MS));
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(useOfflineStore.getState().offline).toBe(true);

    requestMock.mockResolvedValue({ me: { id: "alice" } });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useOfflineStore.getState().offline).toBe(false);
    expect(useAuthStore.getState().session).toEqual({ userId: "alice" });
    expect(invalidate).toHaveBeenCalled();
  });

  it("re-checks when the WebSocket connects", async () => {
    requestMock.mockResolvedValue({ me: { id: "alice" } });
    renderHook(() => useOfflineReconnect(), { wrapper });

    await act(async () => {
      for (const listener of [...wsConnectedListeners]) listener();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(useOfflineStore.getState().offline).toBe(false);
  });

  it("signs out to the sign-in screen when the session expired while offline", async () => {
    requestMock.mockRejectedValue(unauthorized());
    renderHook(() => useOfflineReconnect(), { wrapper });

    await act(() => vi.advanceTimersByTimeAsync(OFFLINE_RECHECK_MS));

    expect(useAuthStore.getState().session).toBeNull();
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(useOfflineStore.getState().offline).toBe(false);
  });
});
