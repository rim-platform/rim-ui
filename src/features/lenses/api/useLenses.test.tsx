import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryKeys } from "../../../core/query/keys";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import {
  FilterField,
  FilterLogic,
  FilterOp,
  useApplyLens,
  useCreateLensMutation,
  useDeleteLensMutation,
  useLenses,
  useUpdateLensMutation,
} from "./useLenses";
import type { ChannelLens } from "./useLenses";

let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const filterSpec = {
  conditions: [{ field: FilterField.HAS_LINKS, op: FilterOp.EQ, value: true }],
  logic: FilterLogic.AND,
};

const lens: ChannelLens = {
  id: "lens-1",
  serverId: "ws-1",
  conversationId: "conv-1",
  createdBy: "me",
  name: "Links",
  filterSpec,
  isShared: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("lens api hooks", () => {
  beforeEach(() => {
    requestMock.mockReset();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });

  it("does not list lenses until both workspace and conversation are known", () => {
    renderHook(() => useLenses("ws-1", undefined), { wrapper });
    renderHook(() => useLenses(undefined, "conv-1"), { wrapper });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("lists a conversation's lenses", async () => {
    requestMock.mockResolvedValue({ channelLenses: [lens] });
    const { result } = renderHook(() => useLenses("ws-1", "conv-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([lens]);
    expect(requestMock.mock.calls[0][0]).toContain("query ChannelLenses");
    expect(requestMock.mock.calls[0][1]).toEqual({ serverId: "ws-1", conversationId: "conv-1" });
  });

  it("only applies a lens once one is selected, with a 50-message limit", async () => {
    const { rerender, result } = renderHook(
      ({ lensId }: { lensId: string | null }) => useApplyLens("ws-1", "conv-1", lensId),
      { wrapper, initialProps: { lensId: null } },
    );
    expect(requestMock).not.toHaveBeenCalled();

    requestMock.mockResolvedValue({ applyChannelLens: [{ id: "m-1" }] });
    rerender({ lensId: "lens-1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [{ id: "m-1" }] });
    expect(requestMock.mock.calls[0][0]).toContain("query ApplyChannelLens");
    expect(requestMock.mock.calls[0][1]).toEqual({
      serverId: "ws-1",
      conversationId: "conv-1",
      lensId: "lens-1",
      limit: 50,
    });
  });

  it("creates a lens and invalidates the conversation's lens list", async () => {
    requestMock.mockResolvedValue({ createChannelLens: lens });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateLensMutation(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        serverId: "ws-1",
        conversationId: "conv-1",
        name: "Links",
        filterSpec,
        isShared: true,
      }),
    );

    expect(requestMock.mock.calls[0][0]).toContain("mutation CreateChannelLens");
    expect(requestMock.mock.calls[0][1]).toEqual({
      input: {
        serverId: "ws-1",
        conversationId: "conv-1",
        name: "Links",
        filterSpec,
        isShared: true,
      },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.lenses("ws-1", "conv-1") });
  });

  it("updates a lens and invalidates both the list and the lens's applied results", async () => {
    requestMock.mockResolvedValue({ updateChannelLens: lens });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateLensMutation(), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        lensId: "lens-1",
        serverId: "ws-1",
        conversationId: "conv-1",
        name: "Only links",
        filterSpec,
        isShared: false,
      }),
    );

    expect(requestMock.mock.calls[0][0]).toContain("mutation UpdateChannelLens");
    // The update input carries no conversationId; it is only used for cache keys.
    expect(requestMock.mock.calls[0][1]).toEqual({
      input: {
        serverId: "ws-1",
        lensId: "lens-1",
        name: "Only links",
        filterSpec,
        isShared: false,
      },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.lenses("ws-1", "conv-1") });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.lensMessages("ws-1", "conv-1", "lens-1"),
    });
  });

  it("deletes a lens and invalidates the conversation's lens list", async () => {
    requestMock.mockResolvedValue({ deleteChannelLens: true });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteLensMutation(), { wrapper });

    await act(() =>
      result.current.mutateAsync({ lensId: "lens-1", serverId: "ws-1", conversationId: "conv-1" }),
    );

    expect(requestMock.mock.calls[0][0]).toContain("mutation DeleteChannelLens");
    expect(requestMock.mock.calls[0][1]).toEqual({ serverId: "ws-1", lensId: "lens-1" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.lenses("ws-1", "conv-1") });
  });
});
