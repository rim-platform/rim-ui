import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createClient, type ClientOptions } from "graphql-ws";
import type { ReactNode } from "react";

vi.mock("graphql-ws", () => ({
  createClient: vi.fn(() => ({ subscribe: vi.fn(), dispose: vi.fn() })),
}));

import { createTestQueryClient } from "../../../test/utils";
import { useRecentActivityStore } from "../../conversations/state/useRecentActivityStore";
import { useOfflineStore } from "../../offline/state/useOfflineStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useAuthStore } from "../state/useAuthStore";
import { useSessionEndedSignOut } from "./signOut";

/** The options wsClient created its graphql-ws client with. */
const options = vi.mocked(createClient).mock.calls[0][0] as ClientOptions;

/** The server closes the WebSocket with `code`. */
function serverCloses(code: number) {
  act(() => options.on?.closed?.(new CloseEvent("close", { code })));
}

describe("useSessionEndedSignOut", () => {
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    useAuthStore.setState({
      session: { userId: "alice" },
      sessionEnded: false,
      csrfToken: "tok-alice",
    });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useOfflineStore.setState({ offline: true });
    queryClient.setQueryData(["me"], { id: "alice" });
    useRecentActivityStore.getState().record({
      workspaceId: "ws-1",
      conversationId: "c-1",
      threadId: null,
      authorId: "bob",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ session: null, sessionEnded: false });
  });

  it("signs out to sign-in once when the server closes the socket because the session ended", () => {
    const clear = vi.spyOn(queryClient, "clear");
    renderHook(() => useSessionEndedSignOut(), { wrapper });

    serverCloses(4401);
    serverCloses(4401);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      session: null,
      sessionEnded: true,
      csrfToken: null,
    });
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
    expect(useOfflineStore.getState().offline).toBe(false);
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
    expect(useRecentActivityStore.getState().entries).toEqual([]);
  });

  it("keeps the session through any other close, and stops listening once unmounted", () => {
    const { unmount } = renderHook(() => useSessionEndedSignOut(), { wrapper });

    serverCloses(1006);
    expect(useAuthStore.getState()).toMatchObject({
      session: { userId: "alice" },
      sessionEnded: false,
    });

    unmount();
    serverCloses(4401);
    expect(useAuthStore.getState().session).toEqual({ userId: "alice" });
  });
});
