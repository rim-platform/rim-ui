import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  JoinRequestStatus,
  PublicJoinLinkMode,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import {
  joinRequestBadge,
  useAcceptJoinRequest,
  useDeclineJoinRequest,
  useJoinByPublicLink,
  useJoinRequestCount,
  useJoinRequests,
  useMyJoinRequests,
  usePublicJoinLink,
  usePublicJoinLinkPreview,
  useReissuePublicJoinLink,
  useUpdatePublicJoinLink,
  useWithdrawJoinRequest,
  type JoinRequestRow,
  type PublicJoinLinkSettings,
} from "./publicJoinLink";

const TOKEN = "rim_pjl_AAAAAAAAAAAAAAAAAAAAAA";

const link: PublicJoinLinkSettings = {
  serverId: "ws-1",
  enabled: true,
  mode: PublicJoinLinkMode.DIRECT,
  role: ServerMemberRoleGql.MEMBER,
  enabledAt: "2026-10-20T10:00:00Z",
  issuedAt: "2026-10-20T10:00:00Z",
  token: TOKEN,
  url: `https://rim.example.org/join/${TOKEN}`,
  joinsLastDay: 0,
  joinsLastWeek: 0,
  openRequests: 0,
};

const request: JoinRequestRow = {
  id: "jr-1",
  serverId: "ws-1",
  workspaceName: "Acme",
  userId: "u1",
  message: null,
  status: JoinRequestStatus.OPEN,
  createdAt: "2026-10-23T10:00:00Z",
  expiresAt: "2026-11-22T10:00:00Z",
  user: null,
};

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, invalidate, wrapper };
}

describe("public join link query keys", () => {
  it("keys the link, its preview, the requests with their count, and the viewer's requests", () => {
    expect(queryKeys.publicJoinLink("ws-1")).toEqual(["publicJoinLink", "ws-1"]);
    expect(queryKeys.publicJoinLinkPreview(TOKEN)).toEqual(["publicJoinLinkPreview", TOKEN, null]);
    expect(queryKeys.publicJoinLinkPreview(TOKEN, "u1")).toEqual([
      "publicJoinLinkPreview",
      TOKEN,
      "u1",
    ]);
    expect(queryKeys.joinRequests("ws-1")).toEqual(["joinRequests", "ws-1"]);
    // Under the requests' key, so invalidating the requests refreshes the count too.
    expect(queryKeys.joinRequestCount("ws-1").slice(0, 2)).toEqual(queryKeys.joinRequests("ws-1"));
    expect(queryKeys.myJoinRequests()).toEqual(["myJoinRequests"]);
  });
});

describe("public join link hooks", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("reads the Owner's link under its key", async () => {
    routeRequests(requestMock, { "query PublicJoinLink": () => ({ publicJoinLink: link }) });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => usePublicJoinLink("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(link));
    expect(qc.getQueryData(queryKeys.publicJoinLink("ws-1"))).toEqual(link);
    expect(callsTo(requestMock, "query PublicJoinLink")).toEqual([{ serverId: "ws-1" }]);
  });

  it("puts the answer of a change and of a new token in the link's cache", async () => {
    routeRequests(requestMock, {
      "mutation UpdatePublicJoinLink": () => ({
        updatePublicJoinLink: { ...link, mode: PublicJoinLinkMode.REQUESTS },
      }),
      "mutation ReissuePublicJoinLink": () => ({
        reissuePublicJoinLink: { ...link, token: "rim_pjl_BBBBBBBBBBBBBBBBBBBBBB" },
      }),
    });
    const { qc, wrapper } = setup();
    const update = renderHook(() => useUpdatePublicJoinLink(), { wrapper });
    await act(() =>
      update.result.current.mutateAsync({ serverId: "ws-1", mode: PublicJoinLinkMode.REQUESTS }),
    );
    expect(qc.getQueryData<PublicJoinLinkSettings>(queryKeys.publicJoinLink("ws-1"))?.mode).toBe(
      PublicJoinLinkMode.REQUESTS,
    );

    const reissue = renderHook(() => useReissuePublicJoinLink(), { wrapper });
    await act(() => reissue.result.current.mutateAsync("ws-1"));
    expect(qc.getQueryData<PublicJoinLinkSettings>(queryKeys.publicJoinLink("ws-1"))?.token).toBe(
      "rim_pjl_BBBBBBBBBBBBBBBBBBBBBB",
    );
  });

  it("keys a preview by the signed-in account and never retries an invalid link", async () => {
    routeRequests(requestMock, {
      "query PublicJoinLinkPreview": () => {
        throw Object.assign(new Error("not found"), {
          response: { errors: [{ message: "not found", extensions: { code: "NOT_FOUND" } }] },
        });
      },
    });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => usePublicJoinLinkPreview(TOKEN, "u1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(callsTo(requestMock, "query PublicJoinLinkPreview")).toEqual([{ token: TOKEN }]);
    expect(qc.getQueryState(queryKeys.publicJoinLinkPreview(TOKEN, "u1"))?.status).toBe("error");
  });

  it("refreshes the workspaces and the link pages after a join", async () => {
    routeRequests(requestMock, {
      "mutation JoinByPublicLink": () => ({
        joinByPublicLink: { outcome: "JOINED", serverId: "ws-1", joinRequest: null },
      }),
    });
    const { qc, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useJoinByPublicLink(), { wrapper });
    await act(() => result.current.mutateAsync({ token: TOKEN }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myServers() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["publicJoinLinkPreview"] });
    expect(qc.getQueryData(queryKeys.myJoinRequests())).toBeUndefined();
  });

  it("puts a filed request in the viewer's requests", async () => {
    routeRequests(requestMock, {
      "mutation JoinByPublicLink": () => ({
        joinByPublicLink: { outcome: "REQUESTED", serverId: "ws-1", joinRequest: request },
      }),
    });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useJoinByPublicLink(), { wrapper });
    await act(() => result.current.mutateAsync({ token: TOKEN, message: "hi" }));
    expect(callsTo(requestMock, "mutation JoinByPublicLink")).toEqual([
      { token: TOKEN, message: "hi" },
    ]);
    expect(qc.getQueryData(queryKeys.myJoinRequests())).toEqual([request]);
  });

  it("pages the requests by cursor, 50 at a time", async () => {
    routeRequests(requestMock, {
      "query JoinRequests(": (vars) => ({
        joinRequests: {
          items: vars.cursor ? [] : [request],
          next: { createdAt: request.createdAt, requestId: request.id },
          prev: null,
          pageInfo: { hasNext: !vars.cursor, hasPrev: false },
        },
      }),
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useJoinRequests("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    expect(callsTo(requestMock, "query JoinRequests(")).toEqual([
      { serverId: "ws-1", dir: "AFTER", cursor: null, limit: 50 },
      {
        serverId: "ws-1",
        dir: "AFTER",
        cursor: { createdAt: request.createdAt, requestId: request.id },
        limit: 50,
      },
    ]);
  });

  it("counts the first page of 100 requests for the badge", async () => {
    routeRequests(requestMock, {
      "query JoinRequestCount": () => ({
        joinRequests: { items: [{ id: "a" }, { id: "b" }], pageInfo: { hasNext: false } },
      }),
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useJoinRequestCount("ws-1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ count: 2, more: false }));
    expect(callsTo(requestMock, "query JoinRequestCount")).toEqual([
      { serverId: "ws-1", dir: "AFTER", limit: 100 },
    ]);
  });

  it("writes the badge as the number, 100+ past a page, and nothing for none", () => {
    expect(joinRequestBadge(undefined)).toBeNull();
    expect(joinRequestBadge({ count: 0, more: false })).toBeNull();
    expect(joinRequestBadge({ count: 7, more: false })).toBe("7");
    expect(joinRequestBadge({ count: 100, more: true })).toBe("100+");
  });

  it.each([
    ["accepting", "mutation AcceptJoinRequest", () => useAcceptJoinRequest()],
    ["declining", "mutation DeclineJoinRequest", () => useDeclineJoinRequest()],
  ])("refreshes the workspace's requests and link after %s", async (_name, needle, hook) => {
    routeRequests(requestMock, {
      [needle]: (vars) => ({
        acceptJoinRequest: { id: vars.requestId, status: JoinRequestStatus.ACCEPTED },
        declineJoinRequest: { id: vars.requestId, status: JoinRequestStatus.DECLINED },
      }),
    });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(hook, { wrapper });
    await act(() => result.current.mutateAsync({ serverId: "ws-1", requestId: "jr-1" }));
    expect(callsTo(requestMock, needle)).toEqual([{ serverId: "ws-1", requestId: "jr-1" }]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.joinRequests("ws-1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.publicJoinLink("ws-1") });
  });

  it("refreshes the members after an acceptance", async () => {
    routeRequests(requestMock, {
      "mutation AcceptJoinRequest": () => ({
        acceptJoinRequest: { id: "jr-1", status: JoinRequestStatus.ACCEPTED },
      }),
    });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useAcceptJoinRequest(), { wrapper });
    await act(() => result.current.mutateAsync({ serverId: "ws-1", requestId: "jr-1" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.serverMembers("ws-1") });
  });

  it("drops a withdrawn request from the viewer's requests and refreshes the link pages", async () => {
    let open = [request];
    routeRequests(requestMock, {
      "query MyJoinRequests": () => ({ myJoinRequests: open }),
      "mutation WithdrawJoinRequest": (vars) => {
        open = [];
        return { withdrawJoinRequest: { id: vars.requestId, serverId: "ws-1" } };
      },
    });
    const { qc, invalidate, wrapper } = setup();
    const mine = renderHook(() => useMyJoinRequests(), { wrapper });
    await waitFor(() => expect(mine.result.current.data).toEqual([request]));

    const withdraw = renderHook(() => useWithdrawJoinRequest(), { wrapper });
    await act(() => withdraw.result.current.mutateAsync("jr-1"));

    expect(callsTo(requestMock, "mutation WithdrawJoinRequest")).toEqual([{ requestId: "jr-1" }]);
    expect(qc.getQueryData(queryKeys.myJoinRequests())).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.myJoinRequests() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["publicJoinLinkPreview"] });
  });
});
