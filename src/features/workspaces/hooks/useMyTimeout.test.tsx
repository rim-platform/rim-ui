import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { workspaceMembers } from "../../conversations/__fixtures__/conversations";
import { useTimeoutStore } from "../state/useTimeoutStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useMyTimeout } from "./useMyTimeout";

function membersWithMyTimeout(timeoutUntil: string | null) {
  return {
    serverMembers: workspaceMembers.map((m) => (m.userId === "me" ? { ...m, timeoutUntil } : m)),
  };
}

function setup(): { qc: QueryClient; wrapper: (props: { children: ReactNode }) => ReactNode } {
  const qc = createTestQueryClient();
  return {
    qc,
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  };
}

describe("useMyTimeout", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useAuthStore.setState({ session: { userId: "me" } });
    useTimeoutStore.setState({ byWorkspace: {} });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("is null without a timeout", async () => {
    requestMock.mockResolvedValue(membersWithMyTimeout(null));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useMyTimeout("ws-1"), { wrapper });
    await waitFor(() => expect(qc.getQueryData(queryKeys.serverMembers("ws-1"))).toBeDefined());
    expect(result.current).toBeNull();
  });

  it("reads the viewer's own timeoutUntil from the member directory", async () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    requestMock.mockResolvedValue(membersWithMyTimeout(until));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyTimeout("ws-1"), { wrapper });
    await waitFor(() => expect(result.current).toBe(until));
  });

  it("uses a TIMED_OUT error noted after the member list was fetched", async () => {
    requestMock.mockResolvedValue(membersWithMyTimeout(null));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useMyTimeout("ws-1"), { wrapper });
    await waitFor(() => expect(qc.getQueryData(queryKeys.serverMembers("ws-1"))).toBeDefined());

    const until = new Date(Date.now() + 60_000).toISOString();
    act(() => useTimeoutStore.getState().noteTimeout("ws-1", until));
    expect(result.current).toBe(until);
  });

  it("lets a member list fetched after the error win (a moderator cleared it)", async () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    useTimeoutStore.getState().noteTimeout("ws-1", until);
    await new Promise((r) => setTimeout(r, 5));
    requestMock.mockResolvedValue(membersWithMyTimeout(null));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useMyTimeout("ws-1"), { wrapper });
    await waitFor(() => expect(qc.getQueryData(queryKeys.serverMembers("ws-1"))).toBeDefined());
    expect(result.current).toBeNull();
  });

  it("clears itself when the timeout runs out", async () => {
    const until = new Date(Date.now() + 150).toISOString();
    requestMock.mockResolvedValue(membersWithMyTimeout(until));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMyTimeout("ws-1"), { wrapper });
    await waitFor(() => expect(result.current).toBe(until));
    await waitFor(() => expect(result.current).toBeNull(), { timeout: 2000 });
  });
});
