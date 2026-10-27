import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import type { WorkspaceEvent } from "../../../core/events/types";
import { renderWithProviders } from "../../../test/utils";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useUnreadEventHandler } from "../../conversations/state/useUnreadEventHandler";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useRelayStore } from "../state/useRelayStore";

type Observer = { next: (result: { data?: { workspaceEvents: string } }) => void };

const ws = vi.hoisted(() => ({
  subscriptions: new Map<string, Observer>(),
  connected: [] as (() => void)[],
}));

vi.mock("../../../core/graphql/wsClient", () => ({
  wsClient: {
    subscribe: (request: { variables: { workspaceId: string } }, observer: Observer) => {
      ws.subscriptions.set(request.variables.workspaceId, observer);
      return () => ws.subscriptions.delete(request.variables.workspaceId);
    },
  },
  onWsConnected: (handler: () => void) => {
    ws.connected.push(handler);
    return () => {
      ws.connected = ws.connected.filter((h) => h !== handler);
    };
  },
}));

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => ({ data: [{ id: "ws-1", name: "Acme", owner: null }] }),
}));

import { WorkspaceRail } from "../../../shell/components/WorkspaceRail";
import { useDirectSpaceRuntime } from "./useDirectSpaceRuntime";

/** What the shell runs from sign-in, with the workspace rail showing the badge. */
function SignedInShell() {
  useDirectSpaceRuntime();
  useUnreadEventHandler();
  return <WorkspaceRail />;
}

/** The requests sent for `root` about `spaceId`. */
function requestsFor(root: string, spaceId: string) {
  return requestMock.mock.calls.filter(
    ([document, variables]: [string, Record<string, unknown>]) =>
      document.includes(`${root}(`) &&
      (variables.workspaceId === spaceId || variables.serverId === spaceId),
  );
}

function newMessage(conversationId: string): WorkspaceEvent {
  return {
    type: "NewMessage",
    workspace_id: DIRECT_SPACE_ID,
    conversation_id: conversationId,
    message: {
      id: "m-1",
      server_id: DIRECT_SPACE_ID,
      conversation_id: conversationId,
      thread_id: null,
      root_thread_id: null,
      author_id: "u-2",
      text: "hi",
      has_attachments: false,
      parent_message_id: null,
      forwarded_from_message_id: null,
      is_deleted: false,
      sent_at: "2026-10-12T10:00:00Z",
      reactions: [],
    },
  } as unknown as WorkspaceEvent;
}

beforeEach(() => {
  ws.subscriptions.clear();
  ws.connected = [];
  requestMock.mockReset();
  requestMock.mockImplementation(async (document: string, variables: Record<string, unknown>) => {
    if (document.includes("unreadCounts(")) {
      return {
        unreadCounts:
          variables.workspaceId === DIRECT_SPACE_ID ? [{ conversationId: "dm-1", count: 2 }] : [],
      };
    }
    if (document.includes("myUnreadNotificationCount(")) return { myUnreadNotificationCount: 1 };
    throw new Error(`unexpected request: ${document}`);
  });
  useUnreadStore.setState({ counts: {}, spaceOf: {} });
  useAuthStore.setState({ session: { userId: "u1" } });
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
});

afterEach(() => {
  useRelayStore.getState().reset();
  useAuthStore.setState({ session: null });
  useWorkspaceStore.setState({ workspaceId: null });
});

describe("the direct space at sign-in", () => {
  it("loads its counts and subscribes while a workspace is open, badges Direct messages and restores on reconnect", async () => {
    renderWithProviders(<SignedInShell />);
    expect(ws.subscriptions.size).toBe(0);
    // The rail loads the open workspace's menu data; nothing goes out about the direct space.
    expect(
      requestMock.mock.calls.filter(
        ([, variables]: [string, Record<string, unknown> | undefined]) =>
          variables?.workspaceId === DIRECT_SPACE_ID || variables?.serverId === DIRECT_SPACE_ID,
      ),
    ).toEqual([]);

    act(() => startRelayWithDirectSpace());

    expect(
      await screen.findByRole("button", { name: "Direct messages (2 unread)" }),
    ).toBeInTheDocument();
    expect([...ws.subscriptions.keys()]).toEqual([DIRECT_SPACE_ID]);
    await waitFor(() =>
      expect(requestsFor("myUnreadNotificationCount", DIRECT_SPACE_ID)).toHaveLength(1),
    );
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");

    act(() =>
      ws.subscriptions.get(DIRECT_SPACE_ID)?.next({
        data: { workspaceEvents: JSON.stringify(newMessage("dm-2")) },
      }),
    );
    expect(screen.getByRole("button", { name: "Direct messages (3 unread)" })).toBeInTheDocument();

    expect(requestsFor("unreadCounts", DIRECT_SPACE_ID)).toHaveLength(1);
    act(() => ws.connected.forEach((handler) => handler()));
    act(() => ws.connected.forEach((handler) => handler()));
    await waitFor(() => expect(requestsFor("unreadCounts", DIRECT_SPACE_ID)).toHaveLength(2));
  });
});
