import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { useBlockedConversations } from "../../relay/state/useBlockedConversations";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { resetBlockedCreators } from "../../relay/inbox/blockedCreators";
import { makeConversation } from "../__fixtures__/conversations";

const requestMock = vi.hoisted(() => vi.fn());
const fetchBlockedPrincipals = vi.hoisted(() => vi.fn());
const fetchServerMembers = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../relay/api/relayApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchBlockedPrincipals,
}));
vi.mock("../../workspaces/api/useServerMembers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchServerMembers,
}));

import { fetchInboxConversations } from "./useInboxConversations";

const blockedDm = makeConversation({
  id: "blocked-dm",
  serverId: "remote-direct",
  conversationType: ConversationTypeEnum.DIRECT,
  createdBy: "u-alice",
});
const otherDm = makeConversation({
  id: "other-dm",
  serverId: "remote-direct",
  conversationType: ConversationTypeEnum.DIRECT,
  createdBy: "u-carol",
});

beforeEach(() => {
  requestMock.mockReset();
  fetchBlockedPrincipals.mockReset().mockResolvedValue([
    {
      principalId: "rimp1_alice",
      userId: null,
      username: null,
      displayName: null,
      blockedAt: "",
    },
  ]);
  fetchServerMembers.mockReset().mockResolvedValue([
    { userId: "u-alice", principalId: "rimp1_alice" },
    { userId: "u-carol", principalId: "rimp1_carol" },
  ]);
  requestMock.mockResolvedValue({
    inboxConversations: {
      items: [blockedDm, otherDm],
      pageInfo: { hasNext: false, hasPrev: false },
    },
  });
  queryClient.clear();
  useBlockedConversations.getState().reset();
  useRelayStore.getState().reset();
  resetBlockedCreators();
});

describe("fetchInboxConversations", () => {
  it("a remote direct space's list comes without the conversations someone blocked started", async () => {
    useRelayStore.getState().addSpace({
      account: "a",
      spaceId: "remote-direct",
      hostServerId: "rims1_host",
      kind: "direct",
    });
    const page = await fetchInboxConversations("remote-direct");
    expect(page.items.map((c) => c.id)).toEqual(["other-dm"]);
    expect(useBlockedConversations.getState().bySpace["remote-direct"]).toEqual({
      "blocked-dm": "rimp1_alice",
    });
  });

  it("a workspace's list is the server's answer, unchanged", async () => {
    const page = await fetchInboxConversations("ws-1");
    expect(page.items.map((c) => c.id)).toEqual(["blocked-dm", "other-dm"]);
    expect(fetchBlockedPrincipals).not.toHaveBeenCalled();
  });
});
