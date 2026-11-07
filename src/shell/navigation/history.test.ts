import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { HISTORY_LIMIT, useShellStore } from "../state/useShellStore";
import { goBack, goForward, useNavigationHistory } from "./history";

const shell = () => useShellStore.getState();
/** Lets the history record what the last steps changed. */
const settle = () => act(() => Promise.resolve());
const openConversation = (id: string) => shell().setSelectedConversationId(id);
const where = () => ({
  workspaceId: useWorkspaceStore.getState().workspaceId,
  surface: shell().mainSurface.kind,
  conversationId: shell().selectedConversationId,
});

describe("navigation history", () => {
  beforeEach(() => {
    shell().reset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    shell().setSelectedConversationId("c-1");
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    shell().reset();
  });

  it("records each place opened, and goes back and forward through them", async () => {
    const { unmount } = renderHook(() => useNavigationHistory());
    await settle();
    openConversation("c-2");
    await settle();
    shell().setMainSurface({ kind: "settings" });
    await settle();
    expect(shell().history).toHaveLength(3);

    expect(goBack()).toBe(true);
    await settle();
    expect(where()).toEqual({
      workspaceId: "ws-1",
      surface: "conversation",
      conversationId: "c-2",
    });
    expect(goBack()).toBe(true);
    await settle();
    expect(where()).toEqual({
      workspaceId: "ws-1",
      surface: "conversation",
      conversationId: "c-1",
    });
    expect(goBack()).toBe(false);
    await settle();

    expect(goForward()).toBe(true);
    await settle();
    expect(goForward()).toBe(true);
    await settle();
    expect(where().surface).toBe("settings");
    expect(goForward()).toBe(false);
    await settle();
    // Going back and forward records nothing new.
    expect(shell().history).toHaveLength(3);
    unmount();
  });

  it("drops what was forward when a new place opens after Back", async () => {
    const { unmount } = renderHook(() => useNavigationHistory());
    await settle();
    openConversation("c-2");
    await settle();
    openConversation("c-3");
    await settle();
    goBack();
    await settle();
    goBack();
    await settle();
    openConversation("c-9");
    await settle();
    expect(shell().history.map((p) => p.conversationId)).toEqual(["c-1", "c-9"]);
    expect(goForward()).toBe(false);
    await settle();
    unmount();
  });

  it("goes back across workspaces, to the conversation that was open there", async () => {
    const { unmount } = renderHook(() => useNavigationHistory());
    await settle();
    useWorkspaceStore.getState().setWorkspaceId("ws-2");
    await settle();
    openConversation("c-20");
    await settle();
    // The workspace and the conversation it opens on are one place.
    expect(shell().history).toHaveLength(2);

    goBack();
    await settle();
    expect(where()).toEqual({
      workspaceId: "ws-1",
      surface: "conversation",
      conversationId: "c-1",
    });
    goForward();
    await settle();
    expect(where()).toEqual({
      workspaceId: "ws-2",
      surface: "conversation",
      conversationId: "c-20",
    });
    unmount();
  });

  it("keeps at most the newest places, dropping the oldest", async () => {
    const { unmount } = renderHook(() => useNavigationHistory());
    await settle();
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      openConversation(`c-x${i}`);
      await settle();
    }
    expect(shell().history).toHaveLength(HISTORY_LIMIT);
    expect(shell().history[0].conversationId).toBe("c-x10");
    expect(shell().historyIndex).toBe(HISTORY_LIMIT - 1);
    unmount();
  });

  it("records nothing for a place that did not change", async () => {
    const { unmount } = renderHook(() => useNavigationHistory());
    await settle();
    shell().setMainSurface({ kind: "conversation" });
    await settle();
    openConversation("c-1");
    await settle();
    expect(shell().history).toHaveLength(1);
    unmount();
  });
});
