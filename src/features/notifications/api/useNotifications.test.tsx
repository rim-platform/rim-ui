import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { useMarkAsRead } from "../../conversations/api/useMarkAsRead";
import { useMarkNotificationsRead } from "./useNotifications";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("notification cache hygiene", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("reading a conversation refetches the unread notification count", async () => {
    requestMock.mockResolvedValue({ markAsRead: true });
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useMarkAsRead(), { wrapper });

    act(() => {
      result.current.mutate({
        workspaceId: "ws-1",
        conversationId: "c-1",
        readAt: "2026-10-05T10:00:00Z",
      });
    });

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.unreadNotificationCount("ws-1") }),
    );
  });

  it("marking notifications read drops the badge at once and then refetches", async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    const { qc, wrapper } = setup();
    qc.setQueryData(queryKeys.unreadNotificationCount("ws-1"), 7);
    const { result } = renderHook(() => useMarkNotificationsRead(), { wrapper });

    act(() => {
      result.current.mutate({ serverId: "ws-1", allBefore: "2026-10-05T10:00:00Z" });
    });

    await waitFor(() => expect(qc.getQueryData(queryKeys.unreadNotificationCount("ws-1"))).toBe(0));
    expect(requestMock.mock.calls[0][1]).toEqual({
      serverId: "ws-1",
      ids: null,
      allBefore: "2026-10-05T10:00:00Z",
    });
  });
});
