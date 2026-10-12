import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { server } from "../../../test/mocks/server";
import { mockGraphQLQuery, mockGraphQLMutation } from "../../../test/mocks/graphql";
import {
  useWorkspaceState,
  useWorkspaceStateList,
  useSetWorkspaceState,
} from "./useWorkspaceState";
import { WorkspaceStateScopeGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useRelayStore } from "../../relay/state/useRelayStore";

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  }

  return { Wrapper, qc };
}

const MOCK_ENTRY = {
  id: "entry-1",
  serverId: "server-1",
  key: "theme.mode",
  value: "dark",
  scope: "SERVER",
  userId: null,
  version: 1,
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("useWorkspaceState", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("fetches a single workspace state entry", async () => {
    server.use(mockGraphQLQuery("WorkspaceState", { workspaceState: MOCK_ENTRY }));

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useWorkspaceState("server-1", "theme.mode", WorkspaceStateScopeGql.SERVER),
      { wrapper: Wrapper },
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_ENTRY);
  });

  it("is disabled when serverId is undefined", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspaceState(undefined, "theme.mode"), {
      wrapper: Wrapper,
    });

    // Query should not fire — stays in pending/idle state
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when key is undefined", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspaceState("server-1", undefined), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
  });

  it("defaults scope to SERVER", async () => {
    server.use(mockGraphQLQuery("WorkspaceState", { workspaceState: MOCK_ENTRY }));

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspaceState("server-1", "theme.mode"), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(MOCK_ENTRY);
  });
});

describe("useWorkspaceStateList", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("fetches a list of workspace state entries", async () => {
    server.use(
      mockGraphQLQuery("WorkspaceStateList", {
        workspaceStateList: [MOCK_ENTRY],
      }),
    );

    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => useWorkspaceStateList("server-1", "theme.", WorkspaceStateScopeGql.SERVER),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([MOCK_ENTRY]);
  });

  it("is disabled when serverId is undefined", () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkspaceStateList(undefined, "theme."), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("workspace state in a direct space", () => {
  afterEach(() => useRelayStore.getState().reset());

  it("asks for no entry and no list", () => {
    startRelayWithDirectSpace();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () => ({
        entry: useWorkspaceState(DIRECT_SPACE_ID, "theme.mode"),
        list: useWorkspaceStateList(DIRECT_SPACE_ID, "theme."),
      }),
      { wrapper: Wrapper },
    );

    expect(result.current.entry.fetchStatus).toBe("idle");
    expect(result.current.list.fetchStatus).toBe("idle");
  });
});

describe("useSetWorkspaceState", () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it("calls the mutation and invalidates caches on success", async () => {
    const updatedEntry = { ...MOCK_ENTRY, value: "light", version: 2 };
    server.use(
      mockGraphQLMutation("SetWorkspaceState", {
        setWorkspaceState: updatedEntry,
      }),
    );

    const { Wrapper, qc } = createWrapper();

    // Seed cache to verify invalidation
    qc.setQueryData(queryKeys.workspaceState("server-1", "SERVER", "theme.mode"), MOCK_ENTRY);

    const { result } = renderHook(() => useSetWorkspaceState(), {
      wrapper: Wrapper,
    });

    result.current.mutate({
      serverId: "server-1",
      key: "theme.mode",
      value: "light",
      scope: WorkspaceStateScopeGql.SERVER,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // After mutation success, the cache should be invalidated (state becomes stale/removed)
    const cacheState = qc.getQueryState(
      queryKeys.workspaceState("server-1", "SERVER", "theme.mode"),
    );
    expect(cacheState?.isInvalidated).toBe(true);
  });
});

describe("queryKeys.workspaceState", () => {
  it("builds the correct query key", () => {
    expect(queryKeys.workspaceState("s1", "SERVER", "k1")).toEqual([
      "workspaceState",
      "s1",
      "SERVER",
      "k1",
    ]);
  });

  it("defaults scope to SERVER when undefined", () => {
    expect(queryKeys.workspaceState("s1", undefined, "k1")).toEqual([
      "workspaceState",
      "s1",
      "SERVER",
      "k1",
    ]);
  });
});

describe("queryKeys.workspaceStateList", () => {
  it("builds the correct query key", () => {
    expect(queryKeys.workspaceStateList("s1", "USER", "prefix.")).toEqual([
      "workspaceStateList",
      "s1",
      "USER",
      "prefix.",
    ]);
  });
});
