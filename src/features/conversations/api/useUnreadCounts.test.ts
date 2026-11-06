import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fakeServerInfo } from "../../../test/serverInfo";
import { useBlockedConversations } from "../../relay/state/useBlockedConversations";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { READ_MARKER } from "../../updater/api/serverCapabilities";
import { useUnreadStore } from "../state/useUnreadStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { fetchUnreadCounts } from "./useUnreadCounts";

beforeEach(() => {
  requestMock.mockReset().mockResolvedValue({
    unreadCounts: [
      { conversationId: "c-hidden", count: 4 },
      { conversationId: "c-other", count: 2 },
    ],
  });
  useUnreadStore.setState({ counts: {}, spaceOf: {}, markers: {}, countSources: {} });
  useBlockedConversations.getState().reset();
  useRelayStore.setState({ spaces: {} });
  queryClient.clear();
});

/** The documents sent asking for unread counts. */
function countDocuments(): string[] {
  return requestMock.mock.calls
    .map(([document]) => String(document))
    .filter((document) => document.includes("unreadCounts("));
}

describe("fetchUnreadCounts", () => {
  it("on a server without read markers asks as before and keeps none", async () => {
    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities: [] }));
    await fetchUnreadCounts("ws-1");
    expect(countDocuments()).toHaveLength(1);
    expect(countDocuments()[0]).not.toContain("unreadAfter");
    const state = useUnreadStore.getState();
    expect(state.counts).toEqual({ "c-hidden": 4, "c-other": 2 });
    expect(state.markers).toEqual({});
    expect(state.countSources).toEqual({ "ws-1": "plain" });
  });

  it("keeps the markers of a server that lists read_marker", async () => {
    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: [READ_MARKER] }),
    );
    requestMock.mockResolvedValue({
      unreadCounts: [{ conversationId: "c-1", count: 3, unreadAfter: "2026-11-06T10:00:00Z" }],
    });
    await fetchUnreadCounts("ws-1");
    expect(countDocuments()[0]).toContain("unreadAfter");
    const state = useUnreadStore.getState();
    expect(state.markers).toEqual({ "c-1": "2026-11-06T10:00:00Z" });
    expect(state.countSources).toEqual({ "ws-1": "markers" });
  });

  it("goes by the capability of the space's own host, not the connected server's", async () => {
    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: [READ_MARKER] }),
    );
    useRelayStore.setState({
      spaces: {
        remote: { account: "a", spaceId: "remote", hostServerId: "old-host", kind: "workspace" },
      },
    });
    queryClient.setQueryData(queryKeys.hostCapabilities("old-host"), []);
    await fetchUnreadCounts("remote");
    expect(countDocuments()[0]).not.toContain("unreadAfter");
    expect(useUnreadStore.getState().countSources).toEqual({ remote: "plain" });
  });

  it("asks a newer host for markers while the connected server has none", async () => {
    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities: [] }));
    useRelayStore.setState({
      spaces: {
        remote: { account: "a", spaceId: "remote", hostServerId: "new-host", kind: "workspace" },
      },
    });
    queryClient.setQueryData(queryKeys.hostCapabilities("new-host"), [READ_MARKER]);
    requestMock.mockResolvedValue({
      unreadCounts: [{ conversationId: "c-1", count: 3, unreadAfter: "2026-11-06T10:00:00Z" }],
    });
    await fetchUnreadCounts("remote");
    expect(countDocuments()[0]).toContain("unreadAfter");
    expect(useUnreadStore.getState().markers).toEqual({ "c-1": "2026-11-06T10:00:00Z" });
  });

  it("leaves hidden conversations out of a space's unread counts", async () => {
    useBlockedConversations.getState().setIn("remote-direct", { "c-hidden": "rimp1_alice" });
    const items = await fetchUnreadCounts("remote-direct");
    expect(items).toEqual([{ conversationId: "c-other", count: 2 }]);
    expect(useUnreadStore.getState().counts).toEqual({ "c-other": 2 });
  });
});
