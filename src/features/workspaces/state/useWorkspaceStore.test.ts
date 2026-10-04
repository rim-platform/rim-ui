import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("starts with null workspaceId", () => {
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
  });

  it("sets workspaceId", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
  });

  it("clears selected conversation when workspace changes", () => {
    useShellStore.getState().setSelectedConversationId("conv-1");
    useWorkspaceStore.getState().setWorkspaceId("ws-2");
    expect(useShellStore.getState().selectedConversationId).toBeNull();
  });

  it("clears workspaceId", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useWorkspaceStore.getState().clearWorkspaceId();
    expect(useWorkspaceStore.getState().workspaceId).toBeNull();
  });
});
