import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { RETRY_FIRST_MS, RETRY_MAX_MS } from "../../../shared/utils/retryWithBackoff";
import { createTestQueryClient } from "../../../test/utils";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useRelayStore } from "../state/useRelayStore";

const fetchRelayInfo = vi.hoisted(() => vi.fn());
const wsConnected = vi.hoisted(() => new Set<() => void>());

vi.mock("../api/relayApi", () => ({ fetchRelayInfo }));
vi.mock("../../../core/graphql/wsClient", () => ({
  onWsConnected: (listener: () => void) => {
    wsConnected.add(listener);
    return () => wsConnected.delete(listener);
  },
}));

import { useRelayRuntime } from "./relayRuntime";

describe("useRelayRuntime", () => {
  const qc = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);

  /** Signs in and mounts the runtime, whose first start fails (the server is not up). */
  function mount() {
    fetchRelayInfo.mockRejectedValue(new TypeError("Failed to fetch"));
    useAuthStore.setState({ session: { userId: "alice" } });
    return renderHook(() => useRelayRuntime(), { wrapper });
  }

  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    fetchRelayInfo.mockReset();
    wsConnected.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    useAuthStore.setState({ session: null });
    useOfflineStore.setState({ offline: false });
    useRelayStore.getState().reset();
  });

  it("retries a failed start on a doubling timer until the relay is running", async () => {
    mount();
    await advance(0);
    expect(fetchRelayInfo).toHaveBeenCalledTimes(1);

    await advance(RETRY_FIRST_MS);
    expect(fetchRelayInfo).toHaveBeenCalledTimes(2);
    await advance(RETRY_FIRST_MS);
    expect(fetchRelayInfo).toHaveBeenCalledTimes(2);
    await advance(RETRY_FIRST_MS);
    expect(fetchRelayInfo).toHaveBeenCalledTimes(3);

    useRelayStore.setState({ info: { serverId: "s", roles: [], directSpaceId: "d" } });
    await advance(RETRY_MAX_MS * 3);
    expect(fetchRelayInfo).toHaveBeenCalledTimes(3);
  });

  it("waits while offline and retries as soon as the app leaves offline mode", async () => {
    useOfflineStore.setState({ offline: true });
    mount();
    await advance(RETRY_MAX_MS * 3);
    expect(fetchRelayInfo).toHaveBeenCalledTimes(1);

    await act(async () => {
      useOfflineStore.getState().setOffline(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchRelayInfo).toHaveBeenCalledTimes(2);
  });

  it("retries when the WebSocket connects, never alongside a start still running", async () => {
    mount();
    await advance(0);
    fetchRelayInfo.mockReturnValue(new Promise(() => undefined));
    const connect = () =>
      act(async () => {
        for (const listener of [...wsConnected]) listener();
        await vi.advanceTimersByTimeAsync(0);
      });

    await connect();
    expect(fetchRelayInfo).toHaveBeenCalledTimes(2);
    await connect();
    await advance(RETRY_MAX_MS * 3);
    expect(fetchRelayInfo).toHaveBeenCalledTimes(2);
  });

  it("stops retrying on sign-out", async () => {
    mount();
    await advance(0);
    await act(async () => {
      useAuthStore.setState({ session: null });
    });

    await advance(RETRY_MAX_MS * 3);
    expect(fetchRelayInfo).toHaveBeenCalledTimes(1);
    expect(wsConnected.size).toBe(0);
  });
});
