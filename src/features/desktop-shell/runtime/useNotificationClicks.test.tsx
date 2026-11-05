import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const invoke = vi.hoisted(() => vi.fn());
const request = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request },
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke,
}));
const plugin = vi.hoisted(() => ({
  handler: null as null | ((event: unknown) => void),
  unregister: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  onAction: vi.fn((cb: (event: unknown) => void) => {
    plugin.handler = cb;
    return Promise.resolve({ unregister: plugin.unregister });
  }),
}));

import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useNotificationClicks } from "./useNotificationClicks";

const TARGET = { workspaceId: "ws-2", conversationId: "c-9", messageId: "m-5" };

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

function showCalls() {
  return invoke.mock.calls.filter(([name]) => name === "desktop_show_window");
}

async function click(extra: unknown, actionId = "tap") {
  await act(async () => {
    plugin.handler?.({
      actionId,
      inputValue: null,
      notification: extra === undefined ? null : { id: 1, extra },
    });
    await Promise.resolve();
  });
}

async function mount() {
  const hook = renderHook(() => useNotificationClicks(), { wrapper });
  await waitFor(() => expect(plugin.handler).not.toBeNull());
  return hook;
}

describe("useNotificationClicks", () => {
  beforeEach(() => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    invoke.mockImplementation(() => Promise.resolve(null));
    useAuthStore.setState({ session: { userId: "u-1" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({
      selectedConversationId: "c-1",
      highlightedMessageId: null,
      isThreadOpen: false,
      selectedRootMessageId: null,
      mainSurface: { kind: "settings" } as never,
    });
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    invoke.mockReset();
    request.mockReset();
    plugin.handler = null;
    plugin.unregister.mockClear();
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.setState({
      selectedConversationId: null,
      highlightedMessageId: null,
      isThreadOpen: false,
      selectedRootMessageId: null,
      mainSurface: { kind: "conversation" },
    });
  });

  it("opens the message in the open workspace", async () => {
    useWorkspaceStore.setState({ workspaceId: "ws-2" });
    const setWorkspaceId = vi.spyOn(useWorkspaceStore.getState(), "setWorkspaceId");
    await mount();
    await click({ rimMessage: TARGET });
    expect(showCalls()).toHaveLength(1);
    expect(setWorkspaceId).not.toHaveBeenCalled();
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
    expect(useShellStore.getState().selectedConversationId).toBe("c-9");
    expect(useShellStore.getState().highlightedMessageId).toBe("m-5");
    setWorkspaceId.mockRestore();
  });

  it("switches workspace first when the message is in another one", async () => {
    await mount();
    await click({ rimMessage: TARGET });
    expect(showCalls()).toHaveLength(1);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-2");
    expect(useShellStore.getState().selectedConversationId).toBe("c-9");
    expect(useShellStore.getState().highlightedMessageId).toBe("m-5");
  });

  it("opens a thread reply in its thread", async () => {
    request.mockResolvedValue({ thread: { id: "t-3", rootMessageId: "m-root" } });
    await mount();
    await click({ rimMessage: { ...TARGET, threadId: "t-3" } });
    await waitFor(() => expect(useShellStore.getState().highlightedMessageId).toBe("m-5"));
    expect(request).toHaveBeenCalledWith(expect.stringContaining("NotificationThreadRoot"), {
      serverId: "ws-2",
      conversationId: "c-9",
      threadId: "t-3",
    });
    expect(useShellStore.getState().selectedConversationId).toBe("c-9");
    expect(useShellStore.getState().isThreadOpen).toBe(true);
    expect(useShellStore.getState().selectedRootMessageId).toBe("m-root");
  });

  it.each([
    ["a missing thread", TARGET],
    ["a null thread", { ...TARGET, threadId: null }],
  ])("opens the message without a thread with %s", async (_name, rimMessage) => {
    await mount();
    await click({ rimMessage });
    expect(request).not.toHaveBeenCalled();
    expect(useShellStore.getState().highlightedMessageId).toBe("m-5");
    expect(useShellStore.getState().isThreadOpen).toBe(false);
  });

  it.each([
    ["no target", {}],
    ["a target that is not an object", { rimMessage: "ws-2" }],
    ["a null target", { rimMessage: null }],
    ["a target with a missing id", { rimMessage: { workspaceId: "ws-2", conversationId: "c-9" } }],
    ["a target with an id of the wrong type", { rimMessage: { ...TARGET, messageId: 5 } }],
    ["a thread of the wrong type", { rimMessage: { ...TARGET, threadId: 7 } }],
    ["no notification", undefined],
  ])("only shows the window with %s", async (_name, extra) => {
    await mount();
    await click(extra);
    expect(showCalls()).toHaveLength(1);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    expect(useShellStore.getState().selectedConversationId).toBe("c-1");
    expect(useShellStore.getState().highlightedMessageId).toBeNull();
  });

  it("only shows the window with no session", async () => {
    useAuthStore.setState({ session: null });
    await mount();
    await click({ rimMessage: TARGET });
    expect(showCalls()).toHaveLength(1);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    expect(useShellStore.getState().selectedConversationId).toBe("c-1");
  });

  it("does nothing for an action other than a click on the notification", async () => {
    await mount();
    await click({ rimMessage: TARGET }, "reply");
    expect(showCalls()).toHaveLength(0);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
  });

  it("still opens the message when showing the window fails", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("no")));
    await mount();
    await click({ rimMessage: TARGET });
    expect(useShellStore.getState().selectedConversationId).toBe("c-9");
  });

  it("stops listening when unmounted", async () => {
    const { unmount } = await mount();
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    expect(plugin.unregister).toHaveBeenCalledTimes(1);
  });

  it("unregisters a listener that arrives after unmounting", async () => {
    const { unmount } = renderHook(() => useNotificationClicks(), { wrapper });
    unmount();
    await waitFor(() => expect(plugin.unregister).toHaveBeenCalledTimes(1));
  });
});
