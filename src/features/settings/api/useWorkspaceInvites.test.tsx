import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { INVITES_PAGE_SIZE, useWorkspaceInvites } from "./useWorkspaceInvites";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const cursor = { createdAt: "2026-10-01T00:00:00Z", inviteId: "inv-2" };

describe("useWorkspaceInvites", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("asks for the newest page first and pages towards older invites from next", async () => {
    requestMock
      .mockResolvedValueOnce({
        workspaceInvites: {
          items: [{ id: "inv-1" }, { id: "inv-2" }],
          next: cursor,
          pageInfo: { hasNext: true, hasPrev: false },
        },
      })
      .mockResolvedValueOnce({
        workspaceInvites: {
          items: [{ id: "inv-3" }],
          next: null,
          pageInfo: { hasNext: false, hasPrev: true },
        },
      });
    const { result } = renderHook(() => useWorkspaceInvites("ws-1"), { wrapper });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    expect(requestMock.mock.calls[0][1]).toEqual({
      serverId: "ws-1",
      dir: "AFTER",
      cursor: null,
      limit: INVITES_PAGE_SIZE,
    });

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(requestMock.mock.calls[1][1]).toEqual({
      serverId: "ws-1",
      dir: "AFTER",
      cursor,
      limit: INVITES_PAGE_SIZE,
    });
    expect(result.current.data?.pages.flatMap((p) => p.items.map((i) => i.id))).toEqual([
      "inv-1",
      "inv-2",
      "inv-3",
    ]);
  });

  it("fetches nothing without a workspace or when disabled", () => {
    renderHook(() => useWorkspaceInvites(null), { wrapper });
    renderHook(() => useWorkspaceInvites("ws-1", false), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });
});
