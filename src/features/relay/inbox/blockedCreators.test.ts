import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { makeConversation } from "../../conversations/__fixtures__/conversations";
import { useContactStore } from "../contacts/useContactStore";
import { useBlockedConversations } from "../state/useBlockedConversations";
import { useRelayStore } from "../state/useRelayStore";

const fetchBlockedPrincipals = vi.hoisted(() => vi.fn());
const fetchServerMembers = vi.hoisted(() => vi.fn());
vi.mock("../api/relayApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchBlockedPrincipals,
}));
vi.mock("../../workspaces/api/useServerMembers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchServerMembers,
}));

import {
  blockedCreatorConversations,
  blockedListUnsupported,
  blockedPersonName,
  withoutBlockedCreators,
  resetBlockedCreators,
} from "./blockedCreators";

const alice = { userId: "u-alice", principalId: "rimp1_alice" };
const carol = { userId: "u-carol", principalId: "rimp1_carol" };
const blockedAlice = {
  principalId: "rimp1_alice",
  userId: null,
  username: null,
  displayName: null,
  blockedAt: "2026-10-01T00:00:00Z",
};

const dm = makeConversation({
  id: "dm",
  serverId: "remote-direct",
  conversationType: ConversationTypeEnum.DIRECT,
  createdBy: "u-alice",
});
const group = makeConversation({
  id: "group",
  serverId: "remote-direct",
  conversationType: ConversationTypeEnum.GROUP,
  createdBy: "u-alice",
});
const carolGroup = makeConversation({
  id: "carol-group",
  serverId: "remote-direct",
  conversationType: ConversationTypeEnum.GROUP,
  createdBy: "u-carol",
});

function page(...items: ReturnType<typeof makeConversation>[]) {
  return { items, pageInfo: { hasNext: false, hasPrev: false } };
}

beforeEach(() => {
  fetchBlockedPrincipals.mockReset();
  fetchServerMembers.mockReset();
  queryClient.clear();
  useBlockedConversations.getState().reset();
  useRelayStore.getState().reset();
  useContactStore.setState({ aliases: {} });
  resetBlockedCreators();
  useRelayStore.getState().addSpace({
    account: "a",
    spaceId: "remote-direct",
    hostServerId: "rims1_host",
    kind: "direct",
  });
  fetchBlockedPrincipals.mockResolvedValue([blockedAlice]);
  fetchServerMembers.mockResolvedValue([alice, carol]);
});

describe("blockedCreatorConversations", () => {
  it("names the DMs and groups whose creator's principal is blocked", () => {
    expect(
      blockedCreatorConversations(
        [dm, group, carolGroup],
        [alice, carol],
        new Set(["rimp1_alice"]),
      ),
    ).toEqual({ dm: "rimp1_alice", group: "rimp1_alice" });
  });

  it("hides nothing for a creator it cannot name", () => {
    const blocked = new Set(["rimp1_alice"]);
    expect(blockedCreatorConversations([{ id: "x", createdBy: null }], [alice], blocked)).toEqual(
      {},
    );
    expect(blockedCreatorConversations([dm], [carol], blocked)).toEqual({});
    expect(
      blockedCreatorConversations([dm], [{ userId: "u-alice", principalId: null }], blocked),
    ).toEqual({});
  });

  it("hides nothing when nobody is blocked", () => {
    expect(blockedCreatorConversations([dm, group], [alice], new Set())).toEqual({});
  });
});

describe("withoutBlockedCreators", () => {
  it("leaves a remote direct space's conversations started by someone blocked out and records them", async () => {
    const result = await withoutBlockedCreators("remote-direct", page(dm, group, carolGroup));
    expect(result.items.map((c) => c.id)).toEqual(["carol-group"]);
    expect(useBlockedConversations.getState().bySpace["remote-direct"]).toEqual({
      dm: "rimp1_alice",
      group: "rimp1_alice",
    });
  });

  it("passes this relay's direct space and workspaces unchanged and asks nothing", async () => {
    useRelayStore.setState({
      info: { serverId: "rims1_relay", roles: [], directSpaceId: "home-direct" },
    });
    const input = page(dm);
    expect(await withoutBlockedCreators("home-direct", input)).toBe(input);
    expect(await withoutBlockedCreators("ws-1", input)).toBe(input);
    expect(fetchBlockedPrincipals).not.toHaveBeenCalled();
    expect(fetchServerMembers).not.toHaveBeenCalled();
  });

  it("asks the members once more for a creator they do not name, and only once", async () => {
    const dave = makeConversation({
      id: "dave-dm",
      serverId: "remote-direct",
      createdBy: "u-dave",
    });
    fetchBlockedPrincipals.mockResolvedValue([
      blockedAlice,
      { ...blockedAlice, principalId: "rimp1_dave" },
    ]);
    fetchServerMembers
      .mockResolvedValueOnce([alice, carol])
      .mockResolvedValueOnce([alice, carol, { userId: "u-dave", principalId: "rimp1_dave" }]);
    const result = await withoutBlockedCreators("remote-direct", page(dave, carolGroup));
    expect(result.items.map((c) => c.id)).toEqual(["carol-group"]);
    expect(fetchServerMembers).toHaveBeenCalledTimes(2);

    fetchServerMembers.mockReset();
    fetchServerMembers.mockResolvedValue([alice, carol]);
    queryClient.clear();
    const erin = makeConversation({
      id: "erin-dm",
      serverId: "remote-direct",
      createdBy: "u-erin",
    });
    await withoutBlockedCreators("remote-direct", page(erin));
    await withoutBlockedCreators("remote-direct", page(erin));
    expect(fetchServerMembers).toHaveBeenCalledTimes(2);
  });

  it("keeps what was recorded for the space when the members cannot be read", async () => {
    await withoutBlockedCreators("remote-direct", page(dm, carolGroup));
    expect(useBlockedConversations.getState().bySpace["remote-direct"]).toEqual({
      dm: "rimp1_alice",
    });
    queryClient.clear();
    fetchServerMembers.mockRejectedValue(new Error("offline"));
    const result = await withoutBlockedCreators("remote-direct", page(dm, group, carolGroup));
    expect(result.items.map((c) => c.id)).toEqual(["group", "carol-group"]);
    expect(useBlockedConversations.getState().bySpace["remote-direct"]).toEqual({
      dm: "rimp1_alice",
    });
  });

  it("hides nothing on a server that does not know the blocked list, and asks it only once", async () => {
    fetchBlockedPrincipals.mockRejectedValue({
      response: { errors: [{ message: 'Cannot query field "myBlockedPrincipals"' }] },
    });
    const first = await withoutBlockedCreators("remote-direct", page(dm));
    const second = await withoutBlockedCreators("remote-direct", page(dm));
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(fetchBlockedPrincipals).toHaveBeenCalledTimes(1);
    expect(blockedListUnsupported()).toBe(true);
  });
});

describe("blockedPersonName", () => {
  it("names a blocked person by alias, then member list, then this server's account, then short principal", () => {
    expect(blockedPersonName("remote-direct", "rimp1_alice")).not.toBe("Alice");
    queryClient.setQueryData(queryKeys.myBlockedPrincipals, [
      { ...blockedAlice, displayName: "Alice Account", username: "alice" },
    ]);
    expect(blockedPersonName("remote-direct", "rimp1_alice")).toBe("Alice Account");
    queryClient.setQueryData(queryKeys.serverMembers("remote-direct"), [
      { userId: "u-alice", principalId: "rimp1_alice", displayName: "", username: "alice-host" },
    ]);
    expect(blockedPersonName("remote-direct", "rimp1_alice")).toBe("alice-host");
    useContactStore.setState({ aliases: { rimp1_alice: "Ali" } });
    expect(blockedPersonName("remote-direct", "rimp1_alice")).toBe("Ali");
  });
});
