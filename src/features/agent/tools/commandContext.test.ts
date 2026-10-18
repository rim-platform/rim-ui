import { afterEach, describe, expect, it } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { currentPluginContext } from "../../plugins/runtime/pluginContext";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { getCurrentCommandContext } from "./commandContext";

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

  it("sends the open thread's own id as threadId, not its root message's", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    openLoadedThread("conv-9", "msg-root-1", "thread-1");

    expect(getCurrentCommandContext()).toEqual({
      workspaceId: "ws-1",
      conversationId: "conv-9",
      threadId: "thread-1",
    });
  });

  it("sends the same threadId a plugin command gets", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    openLoadedThread("conv-9", "msg-root-1", "thread-1");

    expect(getCurrentCommandContext()?.threadId).toBe(currentPluginContext().threadId);
  });

  it("omits threadId while the open root message has no thread or its query has not loaded", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-9");
    useShellStore.getState().openThreadForMessage("msg-root-1");

    expect(getCurrentCommandContext()).not.toHaveProperty("threadId");

    queryClient.setQueryData(queryKeys.threadByRoot("ws-1", "conv-9", "msg-root-1"), null);

    expect(getCurrentCommandContext()).not.toHaveProperty("threadId");
  });

  it("omits threadId after the thread is closed even if rootMessageId lingers", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    openLoadedThread("conv-9", "msg-root-1", "thread-1");
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
    openLoadedThread("conv-9", "msg-root-1", "thread-1");
    useShellStore.getState().setFocusedSurface("mainSurface");

    expect(getCurrentCommandContext()).toEqual({
      workspaceId: "ws-1",
      conversationId: "conv-9",
      threadId: "thread-1",
      focusedSurface: "mainSurface",
    });
  });
});
