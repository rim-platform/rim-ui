import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useCreateInviteMutation } from "./useInviteMutations";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useCreateInviteMutation", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("sends the input without recipientEmail when not provided", async () => {
    requestMock.mockResolvedValue({ createInvite: { inviteToken: "tok", inviteId: "inv-1" } });
    const { result } = renderHook(() => useCreateInviteMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "ws-1" });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      input: { serverId: "ws-1", maxUses: 10 },
    });
  });

  it("omits recipientEmail when it's an empty string", async () => {
    requestMock.mockResolvedValue({ createInvite: { inviteToken: "tok", inviteId: "inv-1" } });
    const { result } = renderHook(() => useCreateInviteMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "ws-1", recipientEmail: "" });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      input: { serverId: "ws-1", maxUses: 10 },
    });
  });

  it("sends recipientEmail when provided", async () => {
    requestMock.mockResolvedValue({ createInvite: { inviteToken: "tok", inviteId: "inv-1" } });
    const { result } = renderHook(() => useCreateInviteMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        serverId: "ws-1",
        recipientEmail: "teammate@example.com",
      });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      input: { serverId: "ws-1", maxUses: 10, recipientEmail: "teammate@example.com" },
    });
  });
});
