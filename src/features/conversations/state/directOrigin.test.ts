import { beforeEach, describe, expect, it } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { applicableDirectOrigin, rememberDirectOrigin, returnFromDirect } from "./directOrigin";
import { selectDirectConversation } from "./directSelection";

const dan = { principalId: "rimp1_dan", relayUrls: [], name: "Dan" };

function startRelay() {
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
}

/** The viewer in Acme Team with #design open. */
function inDesign() {
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useShellStore.getState().setSelectedConversationId("c-design");
}

/** Opens `dm-dan` of the direct space from wherever the viewer is. */
function openDanFromHere() {
  rememberDirectOrigin("direct-1", "dm-dan");
  selectDirectConversation("direct-1", "dm-dan");
}

beforeEach(() => {
  queryClient.clear();
  queryClient.setQueryData(queryKeys.myServers(), [
    { id: "direct-1", name: "Direct", owner: null },
    { id: "ws-1", name: "Acme Team", owner: null },
    { id: "ws-2", name: "Beta", owner: null },
  ]);
  useRelayStore.getState().reset();
  startRelay();
  useShellStore.getState().reset();
  useWorkspaceStore.setState({ workspaceId: null });
});

describe("direct origin", () => {
  it("remembers the workspace and its conversation when a DM opens from it", () => {
    inDesign();
    openDanFromHere();
    expect(useShellStore.getState().directOrigin).toEqual({
      workspaceId: "ws-1",
      conversationId: "c-design",
      spaceId: "direct-1",
      openedId: "dm-dan",
    });
    expect(applicableDirectOrigin()).toEqual(useShellStore.getState().directOrigin);
  });

  it("remembers nothing when the DM opens from Direct messages", () => {
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    openDanFromHere();
    expect(useShellStore.getState().directOrigin).toBeNull();

    useWorkspaceStore.setState({ workspaceId: null });
    rememberDirectOrigin("direct-1", "dm-dan");
    expect(useShellStore.getState().directOrigin).toBeNull();
  });

  it("applies to the opened DM and its draft only", () => {
    inDesign();
    openDanFromHere();
    useShellStore.getState().setSelectedConversationId("dm-other");
    expect(applicableDirectOrigin()).toBeNull();
    useShellStore.getState().setSelectedConversationId("dm-dan");
    expect(applicableDirectOrigin()).not.toBeNull();

    useShellStore.getState().setDirectOrigin(null);
    inDesign();
    rememberDirectOrigin("direct-1", null);
    useWorkspaceStore.getState().setWorkspaceId("direct-1");
    useShellStore.getState().openDraftDirect({ spaceId: "direct-1", member: dan });
    expect(applicableDirectOrigin()).toMatchObject({ workspaceId: "ws-1", openedId: null });
    useShellStore.getState().setSelectedConversationId("dm-other");
    expect(applicableDirectOrigin()).toBeNull();
  });

  it("returns to the workspace and its conversation and forgets the origin", () => {
    inDesign();
    openDanFromHere();
    expect(returnFromDirect()).toBe(true);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    expect(useShellStore.getState().selectedConversationId).toBe("c-design");
    expect(useShellStore.getState().directOrigin).toBeNull();
    expect(returnFromDirect()).toBe(false);
  });

  it("forgets the origin when another workspace opens, keeps it inside Direct messages", () => {
    inDesign();
    openDanFromHere();
    useShellStore.getState().setSelectedConversationId("dm-other");
    useWorkspaceStore.getState().setWorkspaceId("direct-1");
    expect(useShellStore.getState().directOrigin).not.toBeNull();

    useWorkspaceStore.getState().setWorkspaceId("ws-2");
    expect(useShellStore.getState().directOrigin).toBeNull();

    inDesign();
    openDanFromHere();
    useWorkspaceStore.getState().clearWorkspaceId();
    expect(useShellStore.getState().directOrigin).toBeNull();

    inDesign();
    openDanFromHere();
    useShellStore.getState().reset();
    expect(useShellStore.getState().directOrigin).toBeNull();
  });

  it("drops the origin and stays put when the workspace is no longer the viewer's", () => {
    inDesign();
    openDanFromHere();
    queryClient.setQueryData(queryKeys.myServers(), [
      { id: "direct-1", name: "Direct", owner: null },
    ]);
    expect(returnFromDirect()).toBe(false);
    expect(useWorkspaceStore.getState().workspaceId).toBe("direct-1");
    expect(useShellStore.getState().selectedConversationId).toBe("dm-dan");
    expect(useShellStore.getState().directOrigin).toBeNull();
  });

  it("returns to a workspace on another server", () => {
    useRelayStore.getState().addSpace({
      account: "e|rimp1_me",
      spaceId: "ws-far",
      hostServerId: "rims1_far",
      kind: "workspace",
      name: "Far Team",
    });
    useWorkspaceStore.setState({ workspaceId: "ws-far" });
    useShellStore.getState().setSelectedConversationId(null);
    openDanFromHere();
    expect(returnFromDirect()).toBe(true);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-far");
    expect(useShellStore.getState().selectedConversationId).toBeNull();
  });
});
