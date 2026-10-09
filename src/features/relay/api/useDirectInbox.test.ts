import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "../../conversations/types";
import type { PredecessorView } from "./relayApi";
import { supersededConversations } from "./useDirectInbox";

function conversation(id: string, serverId: string): ConversationSummary {
  return { id, serverId } as ConversationSummary;
}

function successor(id: string, hostServerId: string, conversationId: string): PredecessorView {
  return { id, memberIds: [], predecessor: { hostServerId, conversationId } };
}

describe("supersededConversations", () => {
  const hostOf = (spaceId: string) => (spaceId === "remote-space" ? "rims1_remote" : null);

  it("shows a conversation continued elsewhere once, as its successor", () => {
    const items = [conversation("old", "remote-space"), conversation("new", "direct-1")];
    const predecessors = new Map([["new", successor("new", "rims1_remote", "old")]]);
    const { hidden, nonCanonical } = supersededConversations(
      items,
      predecessors,
      hostOf,
      "rims1_me",
    );
    expect([...hidden]).toEqual(["old"]);
    expect(nonCanonical).toEqual([]);
  });

  it("keeps the successor with the smaller id and gives up the other", () => {
    const items = [
      conversation("old", "remote-space"),
      conversation("0199-b", "direct-1"),
      conversation("0199-a", "remote-space"),
    ];
    const predecessors = new Map([
      ["0199-b", successor("0199-b", "rims1_remote", "old")],
      ["0199-a", successor("0199-a", "rims1_remote", "old")],
    ]);
    const { hidden, nonCanonical } = supersededConversations(
      items,
      predecessors,
      hostOf,
      "rims1_me",
    );
    expect(hidden).toEqual(new Set(["old", "0199-b"]));
    expect(nonCanonical.map((c) => c.id)).toEqual(["0199-b"]);
  });

  it("matches a predecessor by host as well as id", () => {
    const items = [conversation("same-id", "direct-1"), conversation("new", "remote-space")];
    const predecessors = new Map([["new", successor("new", "rims1_elsewhere", "same-id")]]);
    expect(supersededConversations(items, predecessors, hostOf, "rims1_me").hidden.size).toBe(0);
  });
});
