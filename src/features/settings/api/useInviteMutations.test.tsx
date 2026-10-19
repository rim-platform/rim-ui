import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import {
  INVITE_EXPIRY_DAYS,
  inviteExpiresAt,
  useCreateInviteMutation,
  useJoinServerByInviteMutation,
  useRevokeInviteMutation,
} from "./useInviteMutations";

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

/** A wrapper around `qc`, with `invalidateQueries` spied on. */
function spiedClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { invalidate, wrapper: Wrapper };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("invite expiry", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers nothing past the server's 30 days and nothing that never expires", () => {
    expect([...INVITE_EXPIRY_DAYS]).toEqual([1, 7, 30]);
    const now = Date.parse("2026-10-19T12:00:00Z");
    for (const days of INVITE_EXPIRY_DAYS) {
      const at = Date.parse(inviteExpiresAt(days, now));
      expect(at).toBeGreaterThan(now);
      expect(at).toBeLessThanOrEqual(now + 30 * DAY_MS);
      expect(now + days * DAY_MS - at).toBeLessThanOrEqual(10 * 60 * 1000);
    }
  });

  it("sends expiresAt when a lifetime is picked, and refetches the invite list", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    requestMock.mockResolvedValue({ createInvite: { inviteToken: "t", inviteId: "i" } });
    const { invalidate, wrapper: spied } = spiedClient();
    const { result } = renderHook(() => useCreateInviteMutation(), { wrapper: spied });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "ws-1", expiresInDays: 30 });
    });

    expect(requestMock.mock.calls[0][1]).toEqual({
      input: {
        serverId: "ws-1",
        maxUses: 10,
        role: "MEMBER",
        expiresAt: "2026-11-18T11:50:00.000Z",
      },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.workspaceInvites("ws-1") });
  });
});

describe("useRevokeInviteMutation", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("revokes by invite id and refetches that workspace's invite list", async () => {
    requestMock.mockResolvedValue({
      revokeInvite: { id: "inv-1", state: "REVOKED", revokedAt: "2026-10-19T12:00:00Z" },
    });
    const { invalidate, wrapper: spied } = spiedClient();
    const { result } = renderHook(() => useRevokeInviteMutation(), { wrapper: spied });

    await act(async () => {
      await result.current.mutateAsync({ serverId: "ws-1", inviteId: "inv-1" });
    });

    expect(String(requestMock.mock.calls[0][0])).toContain("mutation RevokeInvite");
    expect(requestMock.mock.calls[0][1]).toEqual({ inviteId: "inv-1" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.workspaceInvites("ws-1") });
  });

  it("leaves the list alone when the server refuses", async () => {
    requestMock.mockRejectedValue(new Error("FORBIDDEN"));
    const { invalidate, wrapper: spied } = spiedClient();
    const { result } = renderHook(() => useRevokeInviteMutation(), { wrapper: spied });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ serverId: "ws-1", inviteId: "inv-1" }),
      ).rejects.toThrow("FORBIDDEN");
    });

    expect(invalidate).not.toHaveBeenCalled();
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
