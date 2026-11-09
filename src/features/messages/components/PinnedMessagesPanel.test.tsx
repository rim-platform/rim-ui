import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { queryKeys } from "../../../core/query/keys";
import type { MessageItem } from "../../../core/types/messages";
import { useShellStore } from "../../../shell/state/useShellStore";
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

import { toast } from "../../../shared/toast";
import { CommandInitiator } from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import {
  backendCommand,
  COMMAND_OK,
  paletteInput,
  serveHostCommands,
} from "../../../test/clickCommands";
import { PinnedMessagesPanel } from "./PinnedMessagesPanel";

const UNPIN = backendCommand("chat.unpin_message");

function pinned(overrides: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "m-1",
    serverId: "ws-1",
    conversationId: "c-1",
    authorId: "u-alice",
    author: { id: "u-alice", username: "alice", displayName: "Alice", avatarUrl: null },
    text: "the release is on Friday",
    hasAttachments: false,
    isPinned: true,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    sentAt: "2026-10-09T00:00:00Z",
    reactions: [],
    attachments: [],
    linkPreviews: [],
    ...overrides,
  } as MessageItem;
}

function serve() {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query PinnedMessages": () => ({ pinnedMessages: [pinned()] }),
    "mutation UnpinMessage": () => ({ unpinMessage: true }),
    "mutation ExecuteCommand": () => ({ executeCommand: COMMAND_OK }),
  });
}

function renderPanel() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <PinnedMessagesPanel workspaceId="ws-1" conversationId="c-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return qc;
}

function labels(): string[] {
  return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
}

describe("PinnedMessagesPanel — context menu", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.info).mockReset();
    useShellStore.getState().reset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it("offers Jump to message, Copy text and Unpin message", async () => {
    serve();
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("the release is on Friday"));
    expect(labels()).toEqual(["Jump to message", "Copy text", "Unpin message"]);
  });

  it("opens from the keyboard on a focused pinned message", async () => {
    serve();
    renderPanel();
    await screen.findByText("the release is on Friday");
    const item = document.querySelector("[data-pinned-item]") as HTMLElement;
    fireEvent.keyDown(item, { key: "ContextMenu" });
    expect(screen.getByRole("menu", { name: "Pinned message actions" })).toBeInTheDocument();
  });

  it("jumps to the message when the timeline has it loaded", async () => {
    serve();
    const qc = renderPanel();
    const text = await screen.findByText("the release is on Friday");
    qc.setQueryData(queryKeys.messages("ws-1", "c-1"), {
      pages: [{ items: [pinned()], pageInfo: { hasNext: false, hasPrev: false } }],
      pageParams: [undefined],
    });
    fireEvent.contextMenu(text);
    fireEvent.click(screen.getByRole("menuitem", { name: "Jump to message" }));
    expect(useShellStore.getState().highlightedMessageId).toBe("m-1");
  });

  it("says so when the message is not loaded in the timeline", async () => {
    serve();
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("the release is on Friday"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Jump to message" }));
    expect(toast.info).toHaveBeenCalledWith("The message is not loaded", expect.anything());
    expect(useShellStore.getState().highlightedMessageId).toBeNull();
  });

  it("copies the message's text", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    serve();
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("the release is on Friday"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy text" }));
    expect(writeText).toHaveBeenCalledWith("the release is on Friday");
  });

  it("unpins the message with the unpin command, as a context-menu run on that message", async () => {
    serve();
    serveHostCommands("ws-1", [UNPIN]);
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("the release is on Friday"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin message" }));
    await waitFor(() => expect(callsTo(requestMock, "mutation ExecuteCommand")).toHaveLength(1));
    const context = { workspaceId: "ws-1", conversationId: "c-1", selectedMessageId: "m-1" };
    expect(callsTo(requestMock, "mutation ExecuteCommand")[0].input).toEqual({
      ...(await paletteInput(UNPIN, context)),
      initiator: CommandInitiator.CONTEXT_MENU,
    });
    expect(callsTo(requestMock, "mutation UnpinMessage")).toEqual([]);
  });

  it("unpins with the unpin mutation on a server that does not list the command", async () => {
    serve();
    serveHostCommands("ws-1", []);
    renderPanel();
    fireEvent.contextMenu(await screen.findByText("the release is on Friday"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin message" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation UnpinMessage")).toEqual([
        { input: { serverId: "ws-1", conversationId: "c-1", messageId: "m-1" } },
      ]),
    );
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toEqual([]);
  });

  it("names its close button", async () => {
    serve();
    renderPanel();
    await screen.findByText("the release is on Friday");
    expect(screen.getByRole("button", { name: "Close pinned messages" })).toBeInTheDocument();
  });
});
