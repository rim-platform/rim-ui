import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryKeys } from "../../../core/query/keys";
import { createTestQueryClient } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { selectDirectConversation } from "../../conversations/state/directSelection";
import { useContactStore } from "../contacts/useContactStore";
import { blockedPrincipalIds, resetBlockedCreators } from "../inbox/blockedCreators";
import { useBlockedConversations } from "../state/useBlockedConversations";
import { useRelayStore } from "../state/useRelayStore";

const fetchBlockedPrincipals = vi.hoisted(() => vi.fn());
const wsConnected = vi.hoisted(() => new Set<() => void>());
const processWelcomes = vi.hoisted(() => vi.fn(async () => []));
const requestCacheSync = vi.hoisted(() => vi.fn());
const reconcileSpace = vi.hoisted(() => vi.fn(async () => undefined));
const toastInfo = vi.hoisted(() => vi.fn());

vi.mock("../api/relayApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchBlockedPrincipals,
}));
vi.mock("../../../core/graphql/wsClient", () => ({
  onWsConnected: (listener: () => void) => {
    wsConnected.add(listener);
    return () => wsConnected.delete(listener);
  },
}));
vi.mock("../../e2ee/runtime/session", () => ({ e2eeSession: async () => ({}) }));
vi.mock("../../e2ee/runtime/groups", () => ({ processWelcomes }));
vi.mock("../../messages/runtime/messageCacheSync", () => ({ requestCacheSync }));
vi.mock("./relayRuntime", () => ({ relayProcessor: () => ({ reconcileSpace }) }));
vi.mock("../../../shared/toast", () => ({ toast: { info: toastInfo } }));

import { useBlockedConversationsRuntime } from "./useBlockedConversationsRuntime";

const aliceBlocked = {
  principalId: "rimp1_alice",
  userId: null,
  username: null,
  displayName: null,
  blockedAt: "2026-10-01T00:00:00Z",
};

describe("useBlockedConversationsRuntime", () => {
  let qc = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

  function startRelay() {
    useRelayStore
      .getState()
      .setStarted(
        { serverId: "rims1_relay", roles: [], directSpaceId: "home-direct" },
        { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d" },
        [
          { account: "a", spaceId: "remote-direct", hostServerId: "rims1_host", kind: "direct" },
          { account: "a", spaceId: "remote-direct-2", hostServerId: "rims1_host2", kind: "direct" },
          { account: "a", spaceId: "remote-ws", hostServerId: "rims1_host", kind: "workspace" },
        ],
      );
  }

  beforeEach(() => {
    qc = createTestQueryClient();
    fetchBlockedPrincipals.mockReset().mockResolvedValue([aliceBlocked]);
    processWelcomes.mockClear();
    requestCacheSync.mockClear();
    reconcileSpace.mockClear();
    toastInfo.mockClear();
    wsConnected.clear();
    useBlockedConversations.getState().reset();
    useRelayStore.getState().reset();
    useShellStore.getState().reset();
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
    useContactStore.setState({ aliases: { rimp1_alice: "Alice" } });
    useWorkspaceStore.setState({ workspaceId: "remote-direct" });
    resetBlockedCreators();
    startRelay();
  });

  afterEach(() => {
    useRelayStore.getState().reset();
    useBlockedConversations.getState().reset();
    useWorkspaceStore.setState({ workspaceId: null });
  });

  function conversationsInvalidated(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls
      .map(([filters]) => (filters as { queryKey?: readonly unknown[] }).queryKey)
      .filter((key) => key?.[0] === "conversations")
      .map((key) => key?.[1]);
  }

  it("refreshes every remote direct space's list, unseen ones too, when the blocked people change", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useBlockedConversationsRuntime(), { wrapper });
    await waitFor(() =>
      expect(conversationsInvalidated(spy).sort()).toEqual(["remote-direct", "remote-direct-2"]),
    );
  });

  it("leaves the lists alone when the list matches what the last filtering used", async () => {
    await blockedPrincipalIds();
    fetchBlockedPrincipals.mockClear();
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useBlockedConversationsRuntime(), { wrapper });
    await waitFor(() => expect(fetchBlockedPrincipals).toHaveBeenCalled());
    await act(async () => undefined);
    expect(conversationsInvalidated(spy)).toEqual([]);
  });

  it("asks the blocked list again when the WebSocket reconnects", async () => {
    renderHook(() => useBlockedConversationsRuntime(), { wrapper });
    await waitFor(() => expect(fetchBlockedPrincipals).toHaveBeenCalledTimes(1));
    expect(wsConnected.size).toBe(1);
    act(() => [...wsConnected].forEach((listener) => listener()));
    await waitFor(() => expect(fetchBlockedPrincipals).toHaveBeenCalledTimes(2));
  });

  it("stops asking a server that does not know the blocked list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchBlockedPrincipals.mockRejectedValue({
        response: { errors: [{ message: "Cannot query field" }] },
      });
      renderHook(() => useBlockedConversationsRuntime(), { wrapper });
      await waitFor(() => expect(fetchBlockedPrincipals).toHaveBeenCalledTimes(1));
      await act(() => vi.advanceTimersByTimeAsync(600_000));
      expect(fetchBlockedPrincipals).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the local unread count of a conversation as it is hidden", () => {
    useUnreadStore.getState().setCounts("remote-direct", { dm: 3, other: 1 });
    renderHook(() => useBlockedConversationsRuntime(), { wrapper });
    act(() => useBlockedConversations.getState().setIn("remote-direct", { dm: "rimp1_alice" }));
    expect(useUnreadStore.getState().counts).toEqual({ other: 1 });
  });

  it("closes the open conversation once it is hidden, goes to Direct messages and says why", () => {
    useShellStore.getState().setSelectedConversationId("dm");
    useShellStore.getState().setMainSurface({ kind: "conversation" });
    renderHook(() => useBlockedConversationsRuntime(), { wrapper });
    act(() => useBlockedConversations.getState().setIn("remote-direct", { dm: "rimp1_alice" }));
    expect(useWorkspaceStore.getState().workspaceId).toBe("home-direct");
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(toastInfo).toHaveBeenCalledWith(
      "Conversation hidden",
      expect.objectContaining({
        id: "blocked-conversation:dm",
        description: expect.stringContaining("You blocked Alice."),
      }),
    );
  });

  it("closes a hidden conversation behind another page without a toast", () => {
    useShellStore.getState().setSelectedConversationId("dm");
    useShellStore.getState().setMainSurface({ kind: "dm-requests", workspaceId: null });
    renderHook(() => useBlockedConversationsRuntime(), { wrapper });
    act(() => useBlockedConversations.getState().setIn("remote-direct", { dm: "rimp1_alice" }));
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("never lets a hidden conversation be selected", () => {
    useBlockedConversations.getState().setIn("remote-direct", { dm: "rimp1_alice" });
    useWorkspaceStore.setState({ workspaceId: "home-direct" });
    renderHook(() => useBlockedConversationsRuntime(), { wrapper });
    selectDirectConversation("remote-direct", "dm");
    expect(useShellStore.getState().selectedConversationId).toBeNull();
  });

  it("catches a conversation up when it comes back", async () => {
    renderHook(() => useBlockedConversationsRuntime(), { wrapper });
    act(() => useBlockedConversations.getState().setIn("remote-direct", { dm: "rimp1_alice" }));
    const spy = vi.spyOn(qc, "invalidateQueries");
    act(() => useBlockedConversations.getState().setIn("remote-direct", {}));
    await waitFor(() => expect(requestCacheSync).toHaveBeenCalledWith("remote-direct", ["dm"]));
    expect(processWelcomes).toHaveBeenCalled();
    expect(reconcileSpace).toHaveBeenCalledWith("remote-direct");
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);
    expect(keys).toContainEqual(queryKeys.messages("remote-direct", "dm"));
    expect(keys).toContainEqual(queryKeys.cachedTimeline("remote-direct", "dm"));
    expect(keys).toContainEqual(queryKeys.unreadCounts("remote-direct"));
  });
});
