import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { emptyInbox, routeRequests } from "../__fixtures__/conversations";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { directDraftKey, openDirectWithMember } from "./openDirect";

function startRelay() {
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
}

beforeEach(() => {
  requestMock.mockReset();
  routeRequests(requestMock, {
    "query InboxConversations": () => emptyInbox,
    "query ServerMembers": () => ({ serverMembers: [] }),
  });
  queryClient.clear();
  useRelayStore.getState().reset();
  useShellStore.getState().reset();
  useAuthStore.getState().setSession({ userId: "me" });
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  queryClient.setQueryData(queryKeys.serverMembers("ws-1"), [
    { userId: "u-bob", username: "bob", displayName: "Bob", principalId: "rimp1_bob" },
    { userId: "u-eve", username: "eve", displayName: "", principalId: null },
  ]);
});

describe("openDirectWithMember", () => {
  it("opens a workspace draft for a member without a relay, showing the inbox", async () => {
    await openDirectWithMember("u-bob");
    expect(useShellStore.getState().draftDirect).toEqual({
      workspaceId: "ws-1",
      otherUserId: "u-bob",
    });
    expect(useShellStore.getState().activePanel).toBe("inbox");
  });

  it("opens a draft in this relay's direct space for a member with a principal id", async () => {
    startRelay();
    await openDirectWithMember("u-bob");
    expect(useWorkspaceStore.getState().workspaceId).toBe("direct-1");
    expect(useShellStore.getState().draftDirect).toEqual({
      spaceId: "direct-1",
      member: { principalId: "rimp1_bob", relayUrls: [], name: "Bob" },
    });
  });

  it("keeps a member without a principal id in the workspace", async () => {
    startRelay();
    await openDirectWithMember("u-eve");
    expect(useShellStore.getState().draftDirect).toEqual({
      workspaceId: "ws-1",
      otherUserId: "u-eve",
    });
  });

  it("opens the draft when the conversation list cannot be read", async () => {
    routeRequests(requestMock, {
      "query InboxConversations": () => {
        throw new Error("offline");
      },
    });
    await openDirectWithMember("u-bob");
    expect(useShellStore.getState().draftDirect).toEqual({
      workspaceId: "ws-1",
      otherUserId: "u-bob",
    });
  });
});

describe("directDraftKey", () => {
  it("keys a draft's text apart from any conversation id", () => {
    expect(directDraftKey({ workspaceId: "ws-1", otherUserId: "u-bob" })).toBe(
      "draft-dm:ws-1:u-bob",
    );
    expect(
      directDraftKey({
        spaceId: "direct-1",
        member: { principalId: "rimp1_bob", relayUrls: [], name: "Bob" },
      }),
    ).toBe("draft-dm:direct-1:rimp1_bob");
  });
});
