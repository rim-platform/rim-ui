import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

import { renderWithProviders as render } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import type { MessageItem as MessageItemData, MessagesPage } from "../../../core/types/messages";

// --- Controlled data sources ---------------------------------------------

interface TimelineData {
  pages: MessagesPage[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}

const dataState: { current: TimelineData } = {
  current: { pages: [], hasNextPage: false, isFetchingNextPage: false },
};
const fetchNextPage = vi.fn();

vi.mock("../api/useMessages", () => ({
  useConversationMessages: () => ({
    data: { pages: dataState.current.pages, pageParams: [] },
    isPending: false,
    isError: false,
    hasNextPage: dataState.current.hasNextPage,
    isFetchingNextPage: dataState.current.isFetchingNextPage,
    fetchNextPage,
  }),
}));

const editMutateAsync = vi.fn();
const editMutation = { mutateAsync: editMutateAsync, isError: false };
vi.mock("../api/useEditMessage", () => ({
  useEditMessageMutation: () => editMutation,
}));

const toggleMutate = vi.fn();
const toggleMutation = { mutate: toggleMutate };
vi.mock("../api/useToggleReaction", () => ({
  useToggleReactionMutation: () => toggleMutation,
}));

const deleteMessage = vi.fn();
vi.mock("../hooks/useDeleteMessage", () => ({
  useDeleteMessage: () => deleteMessage,
}));

const memberLookup = {
  map: new Map<string, { displayName: string; isCurrentUser: boolean }>(),
  resolve: (userId: string) => ({ displayName: userId, isCurrentUser: userId === "me" }),
};
vi.mock("../../workspaces/hooks/useMemberLookup", () => ({
  useMemberLookup: () => memberLookup,
}));

vi.mock("../../lenses/api/useLenses", () => ({
  useLenses: () => ({ data: [] }),
  useApplyLens: () => ({ data: undefined, isPending: false, isError: false }),
}));

const markAsRead = { mutate: vi.fn() };
vi.mock("../../conversations/api/useMarkAsRead", () => ({
  useMarkAsRead: () => markAsRead,
}));

vi.mock("./Composer", () => ({ Composer: () => null }));
vi.mock("./TypingIndicator", () => ({ TypingIndicator: () => null }));

// --- Render-counting MessageItem spy --------------------------------------
// Wraps a counting component in the real memo comparator so a count only
// increments when the real MessageItem would have re-rendered.

const renderCounts = new Map<string, number>();
const seenHandlers: unknown[] = [];

vi.mock("./MessageItem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./MessageItem")>();
  const { areMessageItemPropsEqual } = await import("./message-item/areMessageItemPropsEqual");
  const React = await import("react");
  type Props = React.ComponentProps<typeof actual.MessageItem>;
  function CountingMessageItem(props: Props) {
    const id = props.view.message.id;
    renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
    seenHandlers.push(props.handlers);
    return (
      <div
        data-message-id={id}
        id={`message-${id}`}
        role="option"
        aria-selected={props.view.isSelected ?? false}
        data-editing={props.view.isEditing ? "true" : undefined}
      >
        {props.view.message.text}
      </div>
    );
  }
  return {
    ...actual,
    MessageItem: React.memo(CountingMessageItem, areMessageItemPropsEqual),
  };
});

import { MessageTimeline } from "./MessageTimeline";

// --- Fixtures -------------------------------------------------------------

function makeMessage(index: number, overrides: Partial<MessageItemData> = {}): MessageItemData {
  const id = `m-${String(index).padStart(3, "0")}`;
  return {
    id,
    serverId: "ws-1",
    conversationId: "conv-1",
    threadId: null,
    rootThreadId: null,
    authorId: index % 2 === 0 ? "alice" : "bob",
    author: {
      id: index % 2 === 0 ? "alice" : "bob",
      username: index % 2 === 0 ? "alice" : "bob",
      displayName: null,
      avatarUrl: null,
    },
    text: `message ${index}`,
    hasAttachments: false,
    parentMessageId: null,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    // 10 minutes apart so no two messages are grouped.
    sentAt: new Date(Date.UTC(2026, 0, 1, 0, index * 10)).toISOString(),
    reactions: [],
    attachments: [],
    linkPreviews: [],
    ...overrides,
  };
}

function page(items: MessageItemData[]): MessagesPage {
  return {
    items,
    next: null,
    prev: null,
    pageInfo: { hasNext: false, hasPrev: false },
  };
}

function setMessages(items: MessageItemData[]) {
  dataState.current = { ...dataState.current, pages: [page(items)] };
}

function resetCounts() {
  renderCounts.clear();
  seenHandlers.length = 0;
}

beforeEach(() => {
  resetCounts();
  dataState.current = { pages: [], hasNextPage: false, isFetchingNextPage: false };
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useAuthStore.setState({ session: { userId: "me" } });
  useShellStore.setState({
    selectedConversationId: "conv-1",
    editingMessageId: null,
    highlightedMessageId: null,
    navigationMode: false,
    displayDensity: "comfortable",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("MessageTimeline handler stability", () => {
  it("does not re-render any message when an unrelated store slice changes", () => {
    setMessages([0, 1, 2, 3, 4].map((i) => makeMessage(i)));
    render(<MessageTimeline />);
    expect(renderCounts.get("m-000")).toBe(1);
    resetCounts();

    // A shell-store change that re-renders the timeline (the edit target)
    // but touches only one row.
    act(() => useShellStore.setState({ editingMessageId: "m-002" }));

    expect(renderCounts.get("m-002")).toBe(1);
    for (const id of ["m-000", "m-001", "m-003", "m-004"]) {
      expect(renderCounts.get(id) ?? 0).toBe(0);
    }
  });

  it("re-renders only the previous and next selected rows on j/k navigation", () => {
    setMessages([0, 1, 2, 3, 4].map((i) => makeMessage(i)));
    render(<MessageTimeline />);
    const list = screen.getByRole("listbox", { name: "Messages" });

    // Entering navigation mode auto-selects the newest message.
    act(() => useShellStore.setState({ navigationMode: true }));
    expect(screen.getByText("message 4").getAttribute("aria-selected")).toBe("true");
    resetCounts();

    fireEvent.keyDown(list, { key: "k" });

    expect(screen.getByText("message 3").getAttribute("aria-selected")).toBe("true");
    expect(renderCounts.get("m-004")).toBe(1);
    expect(renderCounts.get("m-003")).toBe(1);
    for (const id of ["m-000", "m-001", "m-002"]) {
      expect(renderCounts.get(id) ?? 0).toBe(0);
    }
  });

  it("passes the same handler references across parent re-renders", () => {
    setMessages([0, 1].map((i) => makeMessage(i)));
    const { rerender } = render(<MessageTimeline />);
    const first = seenHandlers[0];
    resetCounts();

    act(() => useShellStore.setState({ editingMessageId: "m-001" }));
    rerender(<MessageTimeline />);

    // m-001 re-rendered because it is now being edited; it must receive the
    // very same handlers object the first render handed out.
    expect(seenHandlers.length).toBeGreaterThan(0);
    for (const handlers of seenHandlers) expect(handlers).toBe(first);
  });

  it("keeps rows memoized when a new message is appended", () => {
    setMessages([0, 1, 2].map((i) => makeMessage(i)));
    const { rerender } = render(<MessageTimeline />);
    resetCounts();

    setMessages([0, 1, 2, 3].map((i) => makeMessage(i)));
    rerender(<MessageTimeline />);

    expect(renderCounts.get("m-003")).toBe(1);
    for (const id of ["m-000", "m-001", "m-002"]) {
      expect(renderCounts.get(id) ?? 0).toBe(0);
    }
  });
});
