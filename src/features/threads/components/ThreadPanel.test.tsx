import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  baseReadHandlers,
  callsTo,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();
const fixture = vi.hoisted(() => ({ rootText: "the root" }));

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../plugins/api/usePluginCommands", () => ({
  usePluginContextMenuCommands: () => [],
}));
vi.mock("../../e2ee/hooks/useE2eeConversation", () => ({
  useEncryptedHere: () => false,
  usePrincipalNames: () => ({ userOf: () => undefined }),
}));
vi.mock("../../messages/api/useMessages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../messages/api/useMessages")>()),
  useConversationMessages: () => ({ data: undefined }),
}));

function reply(id: string, authorId: string, text: string) {
  return {
    id,
    serverId: "ws-1",
    conversationId: "c-1",
    threadId: "t-1",
    rootThreadId: null,
    authorId,
    author: { id: authorId, username: authorId, displayName: authorId, avatarUrl: null },
    text,
    hasAttachments: false,
    parentMessageId: null,
    isDeleted: false,
    sentAt: "2026-10-09T00:00:00Z",
    reactions: [],
    linkPreviews: [],
  };
}

vi.mock("../api/useThreads", () => ({
  useThreadByRootMessage: () => ({
    data: {
      id: "t-1",
      serverId: "ws-1",
      conversationId: "c-1",
      rootMessageId: "root-1",
      rootAuthorId: "u-alice",
      rootText: fixture.rootText,
      createdAt: "2026-10-09T00:00:00Z",
    },
    status: "success",
    error: null,
  }),
  useThreadMessages: () => ({
    data: {
      items: [
        reply("r-own", "me", "my reply"),
        reply("r-other", "u-bob", "bob's reply"),
        // An own reply as the `NewMessage` event stores it, without an author object.
        { ...reply("r-own-event", "me", "my new reply"), author: null },
        reply("r-mention", "u-alice", "thanks <@u-bob>"),
      ],
    },
    status: "success",
    error: null,
  }),
}));

import { ThreadPanel } from "./ThreadPanel";

function serve(viewerRole: ServerMemberRoleGql = ServerMemberRoleGql.MEMBER) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole },
    }),
    "query PinnedMessages": () => ({ pinnedMessages: [{ id: "r-other" }] }),
    "mutation UnpinMessage": () => ({ unpinMessage: true }),
  });
}

async function renderPanel() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ThreadPanel />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
  await waitFor(() =>
    expect(qc.getQueryData(queryKeys.pinnedMessages("ws-1", "c-1"))).toBeDefined(),
  );
  return qc;
}

function labels(): string[] {
  return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
}

describe("ThreadPanel — message context menu", () => {
  beforeEach(() => {
    fixture.rootText = "the root";
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-1", selectedRootMessageId: "root-1" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  it("offers the message menu on the viewer's reply, without Reply in thread or Edit", async () => {
    serve();
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("my reply"));
    expect(labels()).toEqual([
      "Add reaction",
      "Copy text",
      "Forward…",
      "Pin message",
      "Delete message…",
    ]);
  });

  it("offers Report on someone else's reply and knows it is pinned", async () => {
    serve();
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("bob's reply"));
    expect(labels()).toEqual([
      "Add reaction",
      "Copy text",
      "Forward…",
      "Unpin message",
      "Report message…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin message" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UnpinMessage")).toEqual([
        { input: { serverId: "ws-1", conversationId: "c-1", messageId: "r-other" } },
      ]),
    );
  });

  it("offers a moderator the author's menu on an own reply that carries no author object", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("my new reply"));
    expect(labels()).toEqual([
      "Add reaction",
      "Copy text",
      "Forward…",
      "Pin message",
      "Delete message…",
    ]);
    expect(screen.queryByText("Moderation")).toBeNull();
  });

  it("opens the report dialog for a reply", async () => {
    serve();
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("bob's reply"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Report message…" }));
    expect(screen.getByRole("dialog", { name: "Report message" })).toBeInTheDocument();
  });

  it("opens the forward dialog for a reply", async () => {
    serve();
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("my reply"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Forward…" }));
    expect(await screen.findByRole("dialog", { name: /forward/i })).toBeInTheDocument();
  });

  it("offers the menu on the thread's root message too", async () => {
    serve();
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("the root"));
    expect(labels()).toContain("Copy text");
    expect(labels()).not.toContain("Reply in thread");
  });

  it("opens the person's menu on a reply's author instead of the message's", async () => {
    serve();
    await renderPanel();
    fireEvent.contextMenu(screen.getAllByText("u-bob")[0]);
    expect(labels()).toContain("Send message");
    expect(labels()).not.toContain("Copy text");
  });
});

describe("ThreadPanel — mentions", () => {
  beforeEach(() => {
    fixture.rootText = "the root";
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-1", selectedRootMessageId: "root-1" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  it("names a mentioned member in the root message instead of the raw token", async () => {
    fixture.rootText = "hey <@u-bob> check this";
    serve();
    await renderPanel();
    // The reply mentions Bob too.
    expect(await screen.findAllByRole("button", { name: "@Bob" })).toHaveLength(2);
    expect(screen.queryByText(/<@u-bob>/)).toBeNull();
  });

  it("names a mentioned member in a reply", async () => {
    serve();
    await renderPanel();
    await screen.findByRole("button", { name: "@Bob" });
    expect(screen.queryByText(/<@u-bob>/)).toBeNull();
  });

  it("offers no Open thread action or thread link on the root", async () => {
    serve();
    await renderPanel();
    expect(screen.queryByLabelText("Open thread")).toBeNull();
    expect(screen.queryByRole("button", { name: "View thread" })).toBeNull();
  });
});

describe("ThreadPanel — mode", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({
      selectedConversationId: "c-1",
      selectedRootMessageId: "root-1",
      navigationMode: true,
    });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  it("switches to COMPOSE when the thread's reply box takes focus", async () => {
    serve();
    await renderPanel();
    expect(useShellStore.getState().navigationMode).toBe(false);
    expect(useShellStore.getState().focusedSurface).toBe("threadPane");
  });

  it("switches to COMPOSE again when the reply box is focused after the list", async () => {
    serve();
    await renderPanel();
    act(() => useShellStore.getState().setNavigationMode(true));
    fireEvent.focus(screen.getByLabelText("Reply in thread"));
    expect(useShellStore.getState().navigationMode).toBe(false);
  });
});
