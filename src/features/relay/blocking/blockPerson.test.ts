import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import type { ConversationSummaryPage } from "../../conversations/types";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useContactStore } from "../contacts/useContactStore";
import { useRelayStore } from "../state/useRelayStore";
import { useBlockPersonStore } from "./useBlockPersonStore";

const blockPrincipal = vi.hoisted(() => vi.fn());
const requestCacheSync = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../api/relayApi", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  blockPrincipal,
}));
vi.mock("../../messages/runtime/messageCacheSync", () => ({ requestCacheSync }));
vi.mock("../../../shared/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { blockActionFor, blockPerson, blockTargetOf, refreshAfterBlockChange } from "./blockPerson";

const ALICE = {
  userId: "u-alice",
  username: "alice",
  displayName: "Alice A.",
  principalId: "rimp1_alice",
};
const members = [
  ALICE,
  { userId: "me", username: "me", displayName: "Me", principalId: "rimp1_me" },
  { userId: "u-nokey", username: "nokey", displayName: "No Key", principalId: null },
];

function page(...ids: string[]): ConversationSummaryPage {
  return {
    items: ids.map((id) => ({ id })) as ConversationSummaryPage["items"],
    pageInfo: { hasNext: false, hasPrev: false },
  };
}

/** Primes a conversation list whose refetch serves each page of `pages` in turn. */
async function primeList(qc: QueryClient, spaceId: string, ...pages: ConversationSummaryPage[]) {
  const queryFn = vi.fn();
  pages.forEach((p, i) => queryFn.mockResolvedValueOnce(p).mockName(`page ${i}`));
  queryFn.mockResolvedValue(pages[pages.length - 1]);
  await qc.prefetchQuery({ queryKey: queryKeys.conversations(spaceId), queryFn });
  return queryFn;
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "home" },
      { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d1" },
      [{ account: "a", spaceId: "remote", hostServerId: "rims1_host", kind: "direct" }],
    );
  useContactStore.setState({ aliases: {} });
  useShellStore.getState().reset();
  useWorkspaceStore.setState({ workspaceId: "home" });
  useUnreadStore.setState({ counts: {}, spaceOf: {} });
  useBlockPersonStore.getState().close();
  queryClient.setQueryData(queryKeys.serverMembers("home"), members);
});

describe("blockTargetOf", () => {
  it("names a member with a principal id as someone to block, by their contact name first", () => {
    expect(blockTargetOf("u-alice")).toEqual({ principalId: "rimp1_alice", name: "Alice A." });
    useContactStore.setState({ aliases: { rimp1_alice: "Ally" } });
    expect(blockTargetOf("u-alice", "home")).toEqual({ principalId: "rimp1_alice", name: "Ally" });
    blockActionFor("u-alice")?.();
    expect(useBlockPersonStore.getState().target).toEqual({
      principalId: "rimp1_alice",
      name: "Ally",
    });
  });

  it("names nobody for the viewer, a member without a principal id, someone blocked already or with the relay off", () => {
    expect(blockTargetOf("me")).toBeNull();
    expect(blockTargetOf("u-nokey")).toBeNull();
    expect(blockTargetOf("u-unknown")).toBeNull();
    expect(blockActionFor("me")).toBeUndefined();
    queryClient.setQueryData(queryKeys.myBlockedPrincipals, [{ principalId: "rimp1_alice" }]);
    expect(blockTargetOf("u-alice")).toBeNull();
    queryClient.setQueryData(queryKeys.myBlockedPrincipals, []);
    expect(blockTargetOf("u-alice")).not.toBeNull();
    useRelayStore.getState().reset();
    expect(blockTargetOf("u-alice")).toBeNull();
  });
});

describe("blockPerson", () => {
  const target = { principalId: "rimp1_alice", name: "Alice" };

  it("blocks, refreshes the lists, closes the open conversation the block hid and says so", async () => {
    const qc = new QueryClient();
    await primeList(qc, "home", page("dm", "other"), page("other"));
    useShellStore.getState().setSelectedConversationId("dm");
    useUnreadStore.getState().setCounts("home", { dm: 2 });
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    await expect(blockPerson(qc, target)).resolves.toBe(true);

    expect(blockPrincipal).toHaveBeenCalledWith("rimp1_alice");
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(useUnreadStore.getState().counts).toEqual({});
    expect(toastSuccess).toHaveBeenCalledWith("Blocked Alice.", {
      description:
        "Your DMs with them and the groups they started stay hidden until you unblock them in Settings → Direct messages.",
    });
    const keys = invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(queryKeys.myBlockedPrincipals);
    expect(keys).toContainEqual(queryKeys.relayContacts);
    expect(keys).toContainEqual(["conversations"]);
  });

  it("leaves the open conversation alone when the block hid another", async () => {
    const qc = new QueryClient();
    await primeList(qc, "home", page("dm", "other"), page("other"));
    useShellStore.getState().setSelectedConversationId("other");
    await blockPerson(qc, target);
    expect(useShellStore.getState().selectedConversationId).toBe("other");
  });

  it("says why when blocking fails, and refreshes and closes nothing", async () => {
    const qc = new QueryClient();
    const queryFn = await primeList(qc, "home", page("dm"));
    useShellStore.getState().setSelectedConversationId("dm");
    blockPrincipal.mockRejectedValue({ response: { status: 400, errors: [] } });
    await expect(blockPerson(qc, target)).resolves.toBe(false);
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Could not block Alice"));
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(useShellStore.getState().selectedConversationId).toBe("dm");
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe("refreshAfterBlockChange", () => {
  it("catches up a conversation that comes back after an unblock", async () => {
    const qc = new QueryClient();
    await primeList(qc, "home", page("a"), page("a", "dm"));
    const { back, gone } = await refreshAfterBlockChange(qc);
    expect([...(back.get("home") ?? [])]).toEqual(["dm"]);
    expect(gone.size).toBe(0);
    expect(requestCacheSync).toHaveBeenCalledWith("home", ["dm"]);
  });

  it("leaves spaces of other servers to the hide runtime", async () => {
    const qc = new QueryClient();
    await primeList(qc, "remote", page("a", "dm"), page("a"));
    const { back, gone } = await refreshAfterBlockChange(qc);
    expect(gone.size).toBe(0);
    expect(back.size).toBe(0);
    expect(requestCacheSync).not.toHaveBeenCalled();
  });
});
