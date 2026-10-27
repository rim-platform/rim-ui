import { http, HttpResponse } from "msw";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { server } from "../../../test/mocks/server";
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
const fixture = vi.hoisted(() => ({
  rootText: "the root",
  rootAuthorId: "u-alice",
  editedAt: null as string | null,
}));

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
  useE2eeConversation: () => ({ encrypted: false, sendBlock: null }),
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
      rootAuthorId: fixture.rootAuthorId,
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
        { ...reply("r-other", "u-bob", "bob's reply"), editedAt: fixture.editedAt },
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

function serve(
  viewerRole: ServerMemberRoleGql = ServerMemberRoleGql.MEMBER,
  extra: Record<string, (vars: Record<string, unknown>) => unknown> = {},
) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole },
    }),
    "query PinnedMessages": () => ({ pinnedMessages: [{ id: "r-other" }] }),
    "mutation UnpinMessage": () => ({ unpinMessage: true }),
    ...extra,
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

/** The textarea of the open edit form, which has the message text as its value. */
function editBox(): HTMLTextAreaElement | null {
  const all = Array.from(
    document.querySelectorAll<HTMLTextAreaElement>("[data-panel='threadPane'] textarea"),
  );
  return all.find((el) => el.closest("[data-owns-escape]") !== null) ?? null;
}

function labels(): string[] {
  return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
}

describe("ThreadPanel — message context menu", () => {
  beforeEach(() => {
    fixture.rootText = "the root";
    fixture.rootAuthorId = "u-alice";
    fixture.editedAt = null;
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-1", selectedRootMessageId: "root-1" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  it("offers Edit message on the viewer's reply, without Reply in thread", async () => {
    serve();
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("my reply"));
    expect(labels()).toEqual([
      "Add reaction",
      "Copy text",
      "Forward…",
      "Pin message",
      "Edit message",
      "Delete message…",
    ]);
  });

  it("edits the viewer's reply in place from its menu", async () => {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation EditMessage": () => ({
        editMessage: { id: "r-own", text: "my reply (fixed)", isDeleted: false, sentAt: "" },
      }),
    });
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("my reply"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit message" }));
    const box = editBox() as HTMLTextAreaElement;
    expect(box.value).toBe("my reply");
    fireEvent.change(box, { target: { value: "my reply (fixed)" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation EditMessage")).toEqual([
        {
          input: {
            serverId: "ws-1",
            conversationId: "c-1",
            messageId: "r-own",
            text: "my reply (fixed)",
          },
        },
      ]),
    );
    await waitFor(() => expect(editBox()).toBeNull());
  });

  it("keeps the form open and says so when the edit fails", async () => {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation EditMessage": () => {
        throw new Error("nope");
      },
    });
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("my reply"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit message" }));
    const box = editBox() as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "changed" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Failed to save. Try again.")).toBeInTheDocument();
    expect(editBox()).not.toBeNull();
  });

  it("edits the root message from the pane without a thread", async () => {
    fixture.rootAuthorId = "me";
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation EditMessage": () => ({
        editMessage: { id: "root-1", text: "new root", isDeleted: false, sentAt: "" },
      }),
    });
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("the root"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit message" }));
    const box = editBox() as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "new root" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation EditMessage")).toEqual([
        {
          input: {
            serverId: "ws-1",
            conversationId: "c-1",
            messageId: "root-1",
            text: "new root",
          },
        },
      ]),
    );
  });

  it("e edits the viewer's newest reply when the pane has the focus", async () => {
    serve();
    await renderPanel();
    const pane = document.querySelector('[data-panel="threadPane"]') as HTMLElement;
    pane.focus();
    fireEvent.keyDown(pane, { key: "e" });
    expect((editBox() as HTMLTextAreaElement).value).toBe("my new reply");
  });

  it("e on someone else's focused reply does nothing", async () => {
    serve();
    await renderPanel();
    const row = screen.getByText("bob's reply").closest("[data-message-id]") as HTMLElement;
    const button = within(row).getAllByRole("button")[0];
    button.focus();
    fireEvent.keyDown(button, { key: "e" });
    expect(editBox()).toBeNull();
  });

  it("e in the reply box types the letter", async () => {
    serve();
    await renderPanel();
    const reply = document.querySelector("[data-panel='threadPane'] textarea") as HTMLElement;
    reply.focus();
    fireEvent.keyDown(reply, { key: "e" });
    expect(editBox()).toBeNull();
  });

  it("Escape in the edit form cancels the edit and keeps the thread open", async () => {
    useShellStore.setState({ isThreadOpen: true });
    serve();
    await renderPanel();
    fireEvent.contextMenu(screen.getByText("my reply"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit message" }));
    const box = editBox() as HTMLTextAreaElement;
    expect(box.closest("[data-owns-escape]")).not.toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(editBox()).toBeNull();
    expect(useShellStore.getState().isThreadOpen).toBe(true);
  });

  it("marks an edited reply in the thread pane", async () => {
    fixture.editedAt = "2026-10-09T01:00:00Z";
    serve();
    await renderPanel();
    const row = screen.getByText("bob's reply").closest("[data-message-id]") as HTMLElement;
    expect(within(row).getByText("(edited)")).toBeInTheDocument();
    expect(screen.getAllByText("(edited)")).toHaveLength(1);
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
      "Edit message",
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
    fireEvent.contextMenu((await screen.findAllByText("Bob"))[0]);
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

  it("names the root's author from the member list when the cached root carries no author", async () => {
    serve();
    await renderPanel();
    const root = (await screen.findByText("the root")).closest<HTMLElement>(
      '[data-message-id="root-1"]',
    )!;
    expect(await within(root).findByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Unknown user")).toBeNull();
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

describe("ThreadPanel — reply box", () => {
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

  /** Serves the panel's reads and answers a reply with `r-new`, plus `extra` handlers. */
  function serveReplies(extra: Record<string, (vars: Record<string, unknown>) => unknown> = {}) {
    serve(ServerMemberRoleGql.MEMBER, {
      "mutation ReplyToMessage": () => ({ replyToMessage: reply("r-new", "me", "x") }),
      ...extra,
    });
  }

  function box(): HTMLTextAreaElement {
    return screen.getByLabelText("Reply in thread");
  }

  function replyInputs(): Record<string, unknown>[] {
    return callsTo(requestMock, "mutation ReplyToMessage").map(
      (vars) => vars.input as Record<string, unknown>,
    );
  }

  it("offers the mention list and sends a picked member as a mention", async () => {
    serveReplies();
    await renderPanel();
    await waitFor(() =>
      expect(callsTo(requestMock, "query ServerMembers").length).toBeGreaterThan(0),
    );
    fireEvent.change(box(), { target: { value: "cc @ali", selectionStart: 7 } });
    fireEvent.click(await screen.findByRole("button", { name: /Alice/ }));
    fireEvent.submit(box().closest("form")!);
    await waitFor(() => expect(replyInputs()).toHaveLength(1));
    expect(replyInputs()[0]).toEqual({
      serverId: "ws-1",
      conversationId: "c-1",
      rootMessageId: "root-1",
      text: "cc <@u-alice>",
    });
  });

  it("offers Insert emoji and Attach file", async () => {
    serveReplies();
    await renderPanel();
    expect(screen.getByRole("button", { name: "Insert emoji" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach file" })).toBeInTheDocument();
  });

  it("attaches a dropped file to the reply it sends", async () => {
    serveReplies({
      "mutation CreateAttachment": () => ({
        createAttachment: { attachmentId: "att-1", uploadToken: "token" },
      }),
      "mutation FinalizeAttachment": () => ({
        finalizeAttachment: { id: "att-1", status: "READY" },
      }),
    });
    server.use(http.post("*/api/files/upload", () => new HttpResponse(null, { status: 204 })));
    await renderPanel();
    const form = box().closest("form")!;
    fireEvent.drop(form, { dataTransfer: { files: [new File(["x"], "notes.txt")] } });
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: "file for you" } });
    fireEvent.submit(form);
    await waitFor(() => expect(callsTo(requestMock, "mutation CreateAttachment")).toHaveLength(1));
    const input = callsTo(requestMock, "mutation CreateAttachment")[0].input as {
      messageId: string;
    };
    expect(input.messageId).toBe("r-new");
  });

  it("sends / text as a reply and offers no command list", async () => {
    serveReplies();
    await renderPanel();
    fireEvent.change(box(), { target: { value: "/hello", selectionStart: 6 } });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.submit(box().closest("form")!);
    await waitFor(() => expect(replyInputs()).toHaveLength(1));
    expect(replyInputs()[0].text).toBe("/hello");
  });

  it("keeps the conversation composer's marker off the reply box", async () => {
    serveReplies();
    await renderPanel();
    expect(document.querySelector("[data-composer-input]")).toBeNull();
    expect(document.querySelector("[data-thread-composer-input]")).not.toBeNull();
  });
});
