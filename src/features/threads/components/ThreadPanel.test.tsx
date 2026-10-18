import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
      rootText: "the root",
      createdAt: "2026-10-09T00:00:00Z",
    },
    status: "success",
    error: null,
  }),
  useThreadMessages: () => ({
    data: {
      items: [reply("r-own", "me", "my reply"), reply("r-other", "u-bob", "bob's reply")],
    },
    status: "success",
    error: null,
  }),
}));

import { ThreadPanel } from "./ThreadPanel";

function serve() {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
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
});
