import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { fakeServerInfo } from "../../../test/serverInfo";
import { routeRequests } from "../../conversations/__fixtures__/conversations";
import { useAuthStore } from "../../auth/state/useAuthStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { queryClient } from "../../../core/query/queryClient";
import { useMyTimeoutReason } from "./useMyTimeoutReason";

const until = "2030-01-01T10:00:00Z";

function serve(capabilities: string[]) {
  routeRequests(requestMock, {
    "query ServerInfo {": () => ({ serverInfo: { ...fakeServerInfo(), capabilities } }),
    "query MyTimeoutReason(": () => ({
      serverMembers: [
        { userId: "other", timeoutReason: null },
        { userId: "me", timeoutReason: "flooding" },
      ],
    }),
  });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const sent = () =>
  requestMock.mock.calls.map(([document]) => /query (\w+)/.exec(String(document))?.[1]);

describe("useMyTimeoutReason", () => {
  beforeEach(() => {
    queryClient.clear();
    requestMock.mockReset();
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
  });

  it("reads the viewer's reason from a server with member_timeout_changed", async () => {
    serve(["member_timeout_changed"]);
    const { result } = renderHook(() => useMyTimeoutReason("ws-1", until), { wrapper });
    await waitFor(() => expect(result.current).toBe("flooding"));
  });

  it("is null and asks nothing from a server without the capability", async () => {
    serve([]);
    const { result } = renderHook(() => useMyTimeoutReason("ws-1", until), { wrapper });
    await waitFor(() => expect(sent()).toEqual(["ServerInfo"]));
    expect(result.current).toBeNull();
  });

  it("sends nothing without a timeout", () => {
    serve(["member_timeout_changed"]);
    const { result } = renderHook(() => useMyTimeoutReason("ws-1", null), { wrapper });
    expect(result.current).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
