import { afterEach, describe, expect, it } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { getCurrentCommandContext } from "../../agent/tools/commandContext";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { currentCommandContext } from "./commandContext";

/** Opens the thread rooted at `rootId` in `conversationId`, with its query loaded as `threadId`. */
function openLoadedThread(conversationId: string, rootId: string, threadId: string): void {
  useShellStore.getState().setSelectedConversationId(conversationId);
  useShellStore.getState().openThreadForMessage(rootId);
  queryClient.setQueryData(queryKeys.threadByRoot("ws-1", conversationId, rootId), {
    id: threadId,
  });
}

afterEach(() => {
  useWorkspaceStore.getState().clearWorkspaceId();
  useShellStore.getState().reset();
  queryClient.clear();
});

describe("currentCommandContext", () => {
  it("is empty when no workspace is selected", () => {
    useShellStore.getState().setSelectedConversationId("conv-9");

    expect(currentCommandContext()).toEqual({});
  });

  it("holds only the workspace when no conversation is open", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");

    expect(currentCommandContext()).toEqual({ workspaceId: "ws-1" });
  });

  it("holds the open conversation, its open thread and the focused surface", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    openLoadedThread("conv-9", "msg-root-1", "thread-1");
    useShellStore.getState().setFocusedSurface("threadPane");

    expect(currentCommandContext()).toEqual({
      workspaceId: "ws-1",
      conversationId: "conv-9",
      threadId: "thread-1",
      focusedSurface: "threadPane",
    });
  });

  it("replaces the open conversation and thread with a target's and keeps the focused surface", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    openLoadedThread("conv-9", "msg-root-1", "thread-1");
    useShellStore.getState().setFocusedSurface("mainSurface");

    expect(
      currentCommandContext({
        workspaceId: "ws-2",
        conversationId: "conv-3",
        selectedMessageId: "msg-7",
      }),
    ).toEqual({
      workspaceId: "ws-2",
      conversationId: "conv-3",
      selectedMessageId: "msg-7",
      focusedSurface: "mainSurface",
    });
    expect(
      currentCommandContext({
        workspaceId: "ws-1",
        conversationId: "conv-9",
        threadId: "thread-5",
        selectedMessageId: "msg-8",
      }),
    ).toMatchObject({ threadId: "thread-5", selectedMessageId: "msg-8" });
  });

  it("is the context the agent sends", () => {
    expect(getCurrentCommandContext()).toBeNull();

    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    expect(getCurrentCommandContext()).toEqual(currentCommandContext());

    openLoadedThread("conv-9", "msg-root-1", "thread-1");
    useShellStore.getState().setFocusedSurface("composer");
    expect(getCurrentCommandContext()).toEqual(currentCommandContext());
  });
});
