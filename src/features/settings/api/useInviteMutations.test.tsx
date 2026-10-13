import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useCreateInviteMutation, useJoinServerByInviteMutation } from "./useInviteMutations";

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
      input: { serverId: "ws-1", maxUses: 10, role: "MEMBER" },
    });
  });

  it("omits recipientEmail when it's an empty string", async () => {
    requestMock.mockResolvedValue({ createInvite: { inviteToken: "tok", inviteId: "inv-1" } });
    const { result } = renderHook(() => useCreateInviteMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "ws-1", recipientEmail: "" });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      input: { serverId: "ws-1", maxUses: 10, role: "MEMBER" },
    });
  });

  it("sends a guest role when asked", async () => {
    requestMock.mockResolvedValue({ createInvite: { inviteToken: "t", inviteId: "i" } });
    const { result } = renderHook(() => useCreateInviteMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "ws-1", role: ServerMemberRoleGql.GUEST });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      input: { serverId: "ws-1", maxUses: 10, role: "GUEST" },
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
      input: {
        serverId: "ws-1",
        maxUses: 10,
        role: "MEMBER",
        recipientEmail: "teammate@example.com",
      },
    });
  });

  it("sends fewer uses when asked", async () => {
    requestMock.mockResolvedValue({ createInvite: { inviteToken: "t", inviteId: "i" } });
    const { result } = renderHook(() => useCreateInviteMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "ws-1", maxUses: 3 });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      input: { serverId: "ws-1", maxUses: 3, role: "MEMBER" },
    });
  });
});

describe("useJoinServerByInviteMutation", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("refetches the workspace list after joining", async () => {
    requestMock.mockResolvedValue({ joinServerByInvite: { serverId: "ws-2" } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useJoinServerByInviteMutation(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });

    await act(async () => {
      await result.current.mutateAsync("tok");
    });

    expect(requestMock.mock.calls[0][1]).toEqual({ input: { inviteToken: "tok" } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
  });
});
