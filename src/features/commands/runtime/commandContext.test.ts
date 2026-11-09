import { afterEach, describe, expect, it } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { getCurrentCommandContext } from "../../agent/tools/commandContext";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useSelectedMessageStore } from "../../messages/state/useSelectedMessageStore";
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
  useSelectedMessageStore.getState().clear();
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

  it("holds the message selected in the open conversation's list", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-9");
    useSelectedMessageStore
      .getState()
      .select({ workspaceId: "ws-1", conversationId: "conv-9", messageId: "msg-4" });

    expect(currentCommandContext()).toMatchObject({
      conversationId: "conv-9",
      selectedMessageId: "msg-4",
    });
  });

  it("leaves out a message selected in another conversation or workspace", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-9");
    const select = useSelectedMessageStore.getState().select;

    select({ workspaceId: "ws-1", conversationId: "conv-2", messageId: "msg-4" });
    expect(currentCommandContext().selectedMessageId).toBeUndefined();
    select({ workspaceId: "ws-2", conversationId: "conv-9", messageId: "msg-4" });
    expect(currentCommandContext().selectedMessageId).toBeUndefined();
  });

  it("takes a target's message in place of the list's", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-9");
    useSelectedMessageStore
      .getState()
      .select({ workspaceId: "ws-1", conversationId: "conv-9", messageId: "msg-4" });

    expect(
      currentCommandContext({ workspaceId: "ws-1", conversationId: "conv-9" }).selectedMessageId,
    ).toBeUndefined();
  });

  it("never gives the agent the selected message", () => {
    useWorkspaceStore.getState().setWorkspaceId("ws-1");
    useShellStore.getState().setSelectedConversationId("conv-9");
    useSelectedMessageStore
      .getState()
      .select({ workspaceId: "ws-1", conversationId: "conv-9", messageId: "msg-4" });

    expect(currentCommandContext().selectedMessageId).toBe("msg-4");
    expect(getCurrentCommandContext()).toEqual({ workspaceId: "ws-1", conversationId: "conv-9" });
  });
});

describe("useSelectedMessageStore", () => {
  afterEach(() => useSelectedMessageStore.getState().clear());

  it("clears a conversation's selection only for that conversation", () => {
    const store = useSelectedMessageStore.getState();
    store.select({ workspaceId: "ws-1", conversationId: "conv-9", messageId: "msg-4" });

    store.clear("conv-2");
    expect(useSelectedMessageStore.getState().selection).not.toBeNull();
    store.clear("conv-9");
    expect(useSelectedMessageStore.getState().selection).toBeNull();
  });
});
