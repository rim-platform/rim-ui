import { afterEach, describe, expect, it } from "vitest";

import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { getCurrentCommandContext } from "./commandContext";

afterEach(() => {
  useWorkspaceStore.getState().clearWorkspaceId();
  useShellStore.getState().reset();
});

describe("getCurrentCommandContext", () => {
  it("returns null when no workspace is selected", () => {
    expect(getCurrentCommandContext()).toBeNull();
  });

  it("returns workspaceId only when shell state is empty", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");

    expect(getCurrentCommandContext()).toEqual({ workspaceId: "ws-1" });
  });

  it("includes conversationId when a conversation is selected", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-9");

    expect(getCurrentCommandContext()).toEqual({
      workspaceId: "ws-1",
      conversationId: "conv-9",
    });
  });

  it("includes threadId only when a thread is open", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-9");
    useShellStore.getState().openThreadForMessage("msg-root-1");

    expect(getCurrentCommandContext()).toEqual({
      workspaceId: "ws-1",
      conversationId: "conv-9",
      threadId: "msg-root-1",
    });
  });

  it("omits threadId after the thread is closed even if rootMessageId lingers", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().openThreadForMessage("msg-root-1");
    useShellStore.getState().closeThread();

    const ctx = getCurrentCommandContext();
    expect(ctx).not.toBeNull();
    expect(ctx).not.toHaveProperty("threadId");
  });

  it("includes focusedSurface when set", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setFocusedSurface("composer");

    expect(getCurrentCommandContext()).toEqual({
      workspaceId: "ws-1",
      focusedSurface: "composer",
    });
  });

  it("merges all populated fields together", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-9");
    useShellStore.getState().openThreadForMessage("msg-root-1");
    useShellStore.getState().setFocusedSurface("mainSurface");

    expect(getCurrentCommandContext()).toEqual({
      workspaceId: "ws-1",
      conversationId: "conv-9",
      threadId: "msg-root-1",
      focusedSurface: "mainSurface",
    });
  });
});
