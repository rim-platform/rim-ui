import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  blockedConversationIdsIn,
  blockedPrincipalOf,
  isBlockedConversation,
  useBlockedConversations,
} from "./useBlockedConversations";

beforeEach(() => useBlockedConversations.getState().reset());

describe("useBlockedConversations", () => {
  it("answers per space and keeps the state when the same conversations are recorded again", () => {
    const { setIn } = useBlockedConversations.getState();
    setIn("remote-direct", { dm: "rimp1_alice" });
    expect(isBlockedConversation("remote-direct", "dm")).toBe(true);
    expect(isBlockedConversation("other-space", "dm")).toBe(false);
    expect(isBlockedConversation(null, "dm")).toBe(false);
    expect(blockedPrincipalOf("remote-direct", "dm")).toBe("rimp1_alice");
    expect(blockedPrincipalOf("remote-direct", "nope")).toBeNull();
    expect([...blockedConversationIdsIn("remote-direct")]).toEqual(["dm"]);
    expect(blockedConversationIdsIn("other-space").size).toBe(0);

    const subscriber = vi.fn();
    const unsubscribe = useBlockedConversations.subscribe(subscriber);
    setIn("remote-direct", { dm: "rimp1_alice" });
    expect(subscriber).not.toHaveBeenCalled();
    setIn("remote-direct", { dm: "rimp1_alice", group: "rimp1_alice" });
    expect(subscriber).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
