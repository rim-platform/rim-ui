import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, createEvent, fireEvent, screen, within } from "@testing-library/react";

import { renderWithProviders as render } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useUnreadStore } from "../../conversations/state/useUnreadStore";
import { useKeybindProfileStore } from "../../commands/state/useKeybindProfileStore";
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
const sendMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("../api/useMessages", () => ({
  useSendMessageMutation: () => ({ mutateAsync: sendMutateAsync }),
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

// Every other request the real composer makes stays pending.
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: () => new Promise(() => {}) },
}));

// A placeholder composer, or the real one when `real` is set.
const composer = vi.hoisted(() => ({ real: false }));
vi.mock("./Composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Composer")>();
  return {
    ...actual,
    Composer: (props: Parameters<typeof actual.Composer>[0]) =>
      composer.real ? <actual.Composer {...props} /> : <div data-testid="composer" />,
  };
});
const incoming = vi.hoisted(() => ({ requests: [] as { id: string; conversationId: string }[] }));
vi.mock("../../relay/api/useDmRequests", () => ({
  usePendingDmRequests: () => ({ data: incoming.requests }),
}));
vi.mock("../../relay/components/DmRequestBar", () => ({
  DmRequestBar: ({ request }: { request: { id: string } }) => (
    <div data-testid="request-bar">{request.id}</div>
  ),
}));
// The message menu: one placeholder item per message, or the real menu when `real` is set.
const messageMenu = vi.hoisted(() => ({ real: false }));
vi.mock("../hooks/useMessageContextMenu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useMessageContextMenu")>();
  return {
    ...actual,
    useMessageContextMenu: (options: Parameters<typeof actual.useMessageContextMenu>[0]) => {
      const real = actual.useMessageContextMenu(options);
      if (messageMenu.real) return real;
      return {
        getItems: ({ messageId }: { messageId: string }) => [
          { id: "actions", label: `Actions for ${messageId}`, onSelect: () => {} },
        ],
        dialog: null,
      };
    },
  };
});
vi.mock("../../workspaces/api/useMyServerRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../workspaces/api/useMyServerRole")>()),
  useCanModerate: () => true,
}));
const allRights = { message: true, thread: true, reaction: true, pin: true };
const posting = vi.hoisted(() => ({
  rights: { message: true, thread: true, reaction: true, pin: true },
}));
vi.mock("../../conversations/api/useChannelPosting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../conversations/api/useChannelPosting")>()),
  usePostingRights: () => posting.rights,
}));
vi.mock("../../plugins/api/usePluginCommands", () => ({
  usePluginContextMenuCommands: () => [],
}));
vi.mock("./TypingIndicator", () => ({ TypingIndicator: () => null }));

// The open conversation and whether its other member has the viewer's DM as a pending request.
const dmRequest = vi.hoisted(() => ({ pending: false, conversation: undefined as unknown }));
vi.mock("../../conversations/api/useDmRequestPending", () => ({
  useDmRequestPending: () => dmRequest.pending,
}));
vi.mock("../../conversations/api/useConversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../conversations/api/useConversation")>()),
  useConversation: () => ({ data: dmRequest.conversation }),
}));

// --- Render-counting MessageItem spy --------------------------------------
// Wraps a counting component in the real memo comparator so a count only
// increments when the real MessageItem would have re-rendered.

const renderCounts = new Map<string, number>();
const seenHandlers: unknown[] = [];
// Rows render the real MessageItem when `real` is set.
const messageItem = vi.hoisted(() => ({ real: false }));

vi.mock("./MessageItem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./MessageItem")>();
  const { areMessageItemPropsEqual } = await import("./message-item/areMessageItemPropsEqual");
  const React = await import("react");
  type Props = React.ComponentProps<typeof actual.MessageItem>;
  function CountingMessageItem(props: Props) {
    const id = props.view.message.id;
    renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
    seenHandlers.push(props.handlers);
    if (messageItem.real) return <actual.MessageItem {...props} />;
    return (
      <div
        data-message-id={id}
        id={`message-${id}`}
        role="option"
        aria-selected={props.view.isSelected ?? false}
        data-editing={props.view.isEditing ? "true" : undefined}
        data-highlighted={props.view.isHighlighted ? "true" : undefined}
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

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import { makeConversation } from "../../conversations/__fixtures__/conversations";
import { MessageTimeline } from "./MessageTimeline";
import { useReplyTargetStore } from "../state/useReplyTargetStore";
import { MARK_SEEN_DELAY_MS } from "./timeline/useMarkSeen";

// --- Layout harness -------------------------------------------------------
// jsdom does no layout, and the timeline is virtualized: with a zero-height
// viewport nothing renders. Give the scroll container a fixed viewport and
// every measured row a fixed height, and make scrolling behave like a browser:
// scrollTop clamps and fires "scroll" asynchronously, and a ResizeObserver
// reports each observed row's size in the next frame.

const VIEWPORT = 300;
const ROW = 50;
const PADDING = 12;

const patched = ["offsetHeight", "offsetWidth", "clientHeight", "scrollHeight", "scrollTop"];
const originalDescriptors = new Map<string, PropertyDescriptor | undefined>();
const scrollTops = new WeakMap<HTMLElement, number>();

function contentHeight(el: HTMLElement): number {
  const list = el.querySelector<HTMLElement>("[data-virtual-list]");
  return list ? parseFloat(list.style.height) || 0 : 0;
}

function isList(el: HTMLElement): boolean {
  return el.hasAttribute("data-message-list");
}

/** Heights of rows that grew after their first measurement, by message id. */
const rowHeights = new Map<string, number>();

/** The live observers, with the rows each one watches. */
const observers = new Set<{
  observer: SyncResizeObserver;
  callback: ResizeObserverCallback;
  targets: Set<Element>;
}>();

function messageIdOf(row: HTMLElement): string | null {
  return row.querySelector("[data-message-id]")?.getAttribute("data-message-id") ?? null;
}

class SyncResizeObserver {
  private readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    observers.add({ observer: this, callback, targets: this.targets });
  }
  observe(target: Element) {
    this.targets.add(target);
    // Browsers deliver resize observations after layout, i.e. after the
    // frame's scroll events; a frame callback keeps that order.
    requestAnimationFrame(() => {
      if (!target.isConnected) return;
      const size = (target as HTMLElement).offsetHeight;
      const entry = {
        target,
        borderBoxSize: [{ blockSize: size, inlineSize: 800 }],
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    });
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
}

/** Give the row holding message `id` a new height and report it, as a browser's observer would. */
function growRow(id: string, height: number) {
  rowHeights.set(id, height);
  act(() => {
    for (const { observer, callback, targets } of observers) {
      for (const target of targets) {
        if (!target.isConnected || messageIdOf(target as HTMLElement) !== id) continue;
        const entry = {
          target,
          borderBoxSize: [{ blockSize: height, inlineSize: 800 }],
        } as unknown as ResizeObserverEntry;
        callback([entry], observer as unknown as ResizeObserver);
      }
    }
  });
}

function installLayout() {
  for (const prop of patched) {
    originalDescriptors.set(prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
  }
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        if (isList(this)) return VIEWPORT;
        if (this.hasAttribute("data-index")) return rowHeights.get(messageIdOf(this) ?? "") ?? ROW;
        return 0;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return isList(this) ? 800 : 0;
      },
    },
    clientHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isList(this) ? VIEWPORT : 0;
      },
    },
    scrollHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isList(this) ? Math.max(VIEWPORT, contentHeight(this)) : 0;
      },
    },
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) {
        // Shrinking content clamps the offset, as in a browser.
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        return Math.min(scrollTops.get(this) ?? 0, max);
      },
      set(this: HTMLElement, value: number) {
        const max = Math.max(0, this.scrollHeight - this.clientHeight);
        const next = Math.min(Math.max(0, value), max);
        if (next === this.scrollTop) return;
        scrollTops.set(this, next);
        queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
      },
    },
  });
  HTMLElement.prototype.scrollTo = function scrollTo(
    this: HTMLElement,
    arg?: ScrollToOptions | number,
  ) {
    if (typeof arg === "object" && arg.top !== undefined) this.scrollTop = arg.top;
  } as typeof HTMLElement.prototype.scrollTo;
  vi.stubGlobal("ResizeObserver", SyncResizeObserver);
}

function uninstallLayout() {
  for (const prop of patched) {
    const descriptor = originalDescriptors.get(prop);
    if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo;
  vi.unstubAllGlobals();
}

/** Let queued scroll events and the virtualizer's re-render settle. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
  }
}

function messageList(): HTMLElement {
  return screen.getByRole("listbox", { name: "Messages" });
}

function maxScrollTop(): number {
  const list = messageList();
  return list.scrollHeight - list.clientHeight;
}

/** Distance from the top of the viewport to the row holding `id`, or null if unmounted. */
function rowViewportOffset(id: string): number | null {
  const row = document
    .querySelector(`[data-message-id="${id}"]`)
    ?.closest<HTMLElement>("[data-index]");
  if (!row) return null;
  const match = /translateY\((-?[\d.]+)px\)/.exec(row.style.transform);
  return match ? parseFloat(match[1]) - messageList().scrollTop : null;
}

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

function range(from: number, to: number): MessageItemData[] {
  return Array.from({ length: to - from }, (_, i) => makeMessage(from + i));
}

function resetCounts() {
  renderCounts.clear();
  seenHandlers.length = 0;
}

beforeEach(() => {
  installLayout();
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
  cleanup();
  uninstallLayout();
  rowHeights.clear();
  observers.clear();
  vi.clearAllMocks();
  messageMenu.real = false;
  composer.real = false;
  messageItem.real = false;
  posting.rights = allRights;
  useReplyTargetStore.setState({ targets: {} });
  dmRequest.pending = false;
  dmRequest.conversation = undefined;
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

describe("MessageTimeline virtualization", () => {
  it("mounts only the rows near the viewport", async () => {
    setMessages(range(0, 200));
    render(<MessageTimeline />);
    await settle();

    const mounted = document.querySelectorAll("[data-index]").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(40);
    // Lands on the newest message.
    expect(screen.getByText("message 199")).toBeInTheDocument();
    expect(screen.queryByText("message 0")).not.toBeInTheDocument();
    expect(messageList().scrollTop).toBe(maxScrollTop());
  });

  it("keeps the viewport anchored when an older page is prepended", async () => {
    setMessages(range(10, 30));
    const { rerender } = render(<MessageTimeline />);
    await settle();

    // Scroll to the very top, where the sentinel would request the next page.
    act(() => messageList().scrollTo({ top: 0 }));
    await settle();
    const before = rowViewportOffset("m-010");
    expect(before).toBe(PADDING);

    // Pages are in load order (newest first); the older page goes last.
    dataState.current = {
      ...dataState.current,
      pages: [page(range(10, 30)), page(range(0, 10))],
    };
    rerender(<MessageTimeline />);
    await settle();

    // The message that was first before the prepend is exactly where it was on
    // screen, because the scroll offset grew by the (still estimated) height of
    // the new rows.
    expect(rowViewportOffset("m-010")).toBe(before);
    expect(messageList().scrollTop).toBeGreaterThanOrEqual(10 * ROW);

    // Scrolling up mounts and measures the prepended rows; their real heights
    // differ from the estimate, and the correction must not move the anchor.
    const top = messageList().scrollTop;
    act(() => messageList().scrollTo({ top: top - 2 * ROW }));
    await settle();
    expect(screen.getByText("message 9")).toBeInTheDocument();
    expect(rowViewportOffset("m-010")).toBe(before! + 2 * ROW);
  });

  it("follows a new message when the user is at the bottom", async () => {
    setMessages(range(0, 20));
    const { rerender } = render(<MessageTimeline />);
    await settle();
    expect(messageList().scrollTop).toBe(maxScrollTop());
    const oldMax = maxScrollTop();

    setMessages(range(0, 21));
    rerender(<MessageTimeline />);
    await settle();

    expect(maxScrollTop()).toBeGreaterThan(oldMax);
    expect(messageList().scrollTop).toBe(maxScrollTop());
    expect(screen.getByText("message 20")).toBeInTheDocument();
  });

  it("does not move the viewport for a new message when scrolled up", async () => {
    setMessages(range(0, 20));
    const { rerender } = render(<MessageTimeline />);
    await settle();

    act(() => messageList().scrollTo({ top: 100 }));
    await settle();

    setMessages(range(0, 21));
    rerender(<MessageTimeline />);
    await settle();

    expect(messageList().scrollTop).toBe(100);
    expect(screen.queryByText("message 20")).not.toBeInTheDocument();
  });

  it("scrolls to the bottom for the user's own new message even when scrolled up", async () => {
    setMessages(range(0, 20));
    const { rerender } = render(<MessageTimeline />);
    await settle();

    act(() => messageList().scrollTo({ top: 100 }));
    await settle();

    const own = makeMessage(20, {
      authorId: "me",
      author: { id: "me", username: "me", displayName: null, avatarUrl: null },
    });
    setMessages([...range(0, 20), own]);
    rerender(<MessageTimeline />);
    await settle();

    expect(messageList().scrollTop).toBe(maxScrollTop());
    expect(screen.getByText("message 20")).toBeInTheDocument();
  });

  it("keeps a growing newest message in view when the user is at the bottom", async () => {
    setMessages(range(0, 20));
    render(<MessageTimeline />);
    await settle();
    const oldMax = maxScrollTop();

    growRow("m-019", 150);
    await settle();

    expect(maxScrollTop()).toBe(oldMax + 100);
    expect(messageList().scrollTop).toBe(maxScrollTop());
  });

  it("does not move the viewport when a row grows while scrolled up", async () => {
    setMessages(range(0, 20));
    render(<MessageTimeline />);
    await settle();
    act(() => messageList().scrollTo({ top: 100 }));
    await settle();

    growRow("m-019", 150);
    await settle();

    expect(messageList().scrollTop).toBe(100);
  });

  it("keeps the visible rows in place when the oldest loaded message drops off while scrolled up", async () => {
    setMessages(range(0, 30));
    const { rerender } = render(<MessageTimeline />);
    await settle();
    act(() => messageList().scrollTo({ top: 500 }));
    await settle();
    const before = rowViewportOffset("m-015");
    expect(before).not.toBeNull();

    // A refetch of the newest page slides the loaded window by one message.
    setMessages(range(1, 31));
    rerender(<MessageTimeline />);
    await settle();

    expect(rowViewportOffset("m-015")).toBe(before);
    expect(screen.queryByText("message 30")).not.toBeInTheDocument();
  });

  it("keeps the visible rows in place when a message above the viewport is deleted", async () => {
    setMessages(range(0, 30));
    const { rerender } = render(<MessageTimeline />);
    await settle();
    act(() => messageList().scrollTo({ top: 500 }));
    await settle();
    const before = rowViewportOffset("m-015");
    expect(before).not.toBeNull();

    setMessages(range(0, 30).filter((m) => m.id !== "m-005"));
    rerender(<MessageTimeline />);
    await settle();

    expect(rowViewportOffset("m-015")).toBe(before);
  });

  it("does not move the rows when the first visible row itself is gone", async () => {
    setMessages(range(0, 30));
    const { rerender } = render(<MessageTimeline />);
    await settle();
    act(() => messageList().scrollTo({ top: 500 }));
    await settle();

    // Rows as tall as the estimate, so measuring the new rows corrects nothing.
    for (const m of range(40, 60)) rowHeights.set(m.id, 64);
    setMessages(range(40, 60));
    rerender(<MessageTimeline />);
    await settle();

    expect(messageList().scrollTop).toBe(500);
  });

  it("stays at the end when a refetch drops the oldest message and the newest row grows", async () => {
    setMessages(range(0, 20));
    const { rerender } = render(<MessageTimeline />);
    await settle();
    expect(messageList().scrollTop).toBe(maxScrollTop());

    act(() => {
      setMessages(range(1, 20));
      rowHeights.set("m-019", 300);
      rerender(<MessageTimeline />);
      for (const { observer, callback, targets } of observers) {
        for (const target of targets) {
          if (!target.isConnected || messageIdOf(target as HTMLElement) !== "m-019") continue;
          const entry = {
            target,
            borderBoxSize: [{ blockSize: 300, inlineSize: 800 }],
          } as unknown as ResizeObserverEntry;
          callback([entry], observer as unknown as ResizeObserver);
        }
      }
    });
    await settle();

    expect(maxScrollTop()).toBe(18 * ROW + 300 + 2 * PADDING - VIEWPORT);
    expect(messageList().scrollTop).toBe(maxScrollTop());
  });

  it("k from the first visible row scrolls the off-screen row above into view", async () => {
    setMessages(range(0, 30));
    render(<MessageTimeline />);
    await settle();
    const list = messageList();

    act(() => useShellStore.setState({ navigationMode: true }));
    await settle();
    expect(screen.getByText("message 29").getAttribute("aria-selected")).toBe("true");

    // Walk up until the selection is the first fully visible row.
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(list, { key: "k" });
      await settle();
    }
    expect(screen.getByText("message 24").getAttribute("aria-selected")).toBe("true");
    expect(rowViewportOffset("m-024")).toBe(0);
    const offsetAbove = rowViewportOffset("m-023");
    expect(offsetAbove).toBe(-ROW); // fully above the viewport

    const scrollTopBefore = list.scrollTop;

    fireEvent.keyDown(list, { key: "k" });
    await settle();

    expect(screen.getByText("message 23").getAttribute("aria-selected")).toBe("true");
    expect(rowViewportOffset("m-023")).toBe(0);
    expect(list.scrollTop).toBeLessThan(scrollTopBefore);
    expect(list.getAttribute("aria-activedescendant")).toBe("message-m-023");
  });

  it("jumps to and highlights an unmounted message requested by search", async () => {
    setMessages(range(0, 60));
    render(<MessageTimeline />);
    await settle();
    expect(screen.queryByText("message 5")).not.toBeInTheDocument();

    act(() => useShellStore.setState({ highlightedMessageId: "m-005" }));
    await settle();

    const row = screen.getByText("message 5");
    expect(row.getAttribute("data-highlighted")).toBe("true");
    // Centred: row start minus half the viewport (less half a row).
    expect(messageList().scrollTop).toBe(PADDING + 5 * ROW - (VIEWPORT - ROW) / 2);
  });

  it("opens a conversation with unread messages on the New messages divider", async () => {
    const items = range(0, 60);
    useUnreadStore.setState({ watermarks: { "conv-1": items[39].sentAt } });
    setMessages(items);
    render(<MessageTimeline />);
    await settle();

    expect(screen.getByRole("separator", { name: "New messages" })).toBeInTheDocument();
    // The divider sits inside the first unread row, which is aligned to the top.
    expect(rowViewportOffset("m-040")).toBe(0);
    useUnreadStore.setState({ watermarks: {} });
  });

  it("requests the next older page when the top sentinel becomes visible", async () => {
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    dataState.current = {
      pages: [page(range(0, 20))],
      hasNextPage: true,
      isFetchingNextPage: false,
    };
    render(<MessageTimeline />);
    await settle();
    expect(callbacks.length).toBeGreaterThan(0);

    const latest = callbacks[callbacks.length - 1];
    act(() =>
      latest([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
    );
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("lands on the newest message after switching to an already-loaded conversation", async () => {
    setMessages(range(0, 30));
    const { rerender } = render(<MessageTimeline />);
    await settle();
    act(() => messageList().scrollTo({ top: 0 }));
    await settle();

    const other = range(100, 140).map((m) => ({ ...m, conversationId: "conv-2" }));
    setMessages(other);
    act(() => useShellStore.setState({ selectedConversationId: "conv-2" }));
    rerender(<MessageTimeline />);
    await settle();

    expect(messageList().scrollTop).toBe(maxScrollTop());
    expect(screen.getByText("message 139")).toBeInTheDocument();
  });

  it("tells the server a conversation is read when it opens at the bottom without scrolling", async () => {
    setMessages(range(0, 30));
    const { rerender } = render(<MessageTimeline />);
    await settle();
    act(() => messageList().scrollTo({ top: 0 }));
    await settle();

    // Three rows fit the viewport: opening this conversation fires no scroll event.
    const short = range(100, 103).map((m) => ({ ...m, conversationId: "conv-2" }));
    useUnreadStore.getState().setCounts("ws-1", { "conv-2": 3 });
    setMessages(short);
    act(() => useShellStore.setState({ selectedConversationId: "conv-2" }));
    rerender(<MessageTimeline />);
    await settle();
    await act(() => new Promise((resolve) => setTimeout(resolve, MARK_SEEN_DELAY_MS)));

    expect(markAsRead.mutate).toHaveBeenCalledWith({
      conversationId: "conv-2",
      workspaceId: "ws-1",
      readAt: short[2].sentAt,
    });
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
  });

  it("keeps the row being edited mounted while it is scrolled out of view", async () => {
    setMessages(range(0, 60));
    render(<MessageTimeline />);
    await settle();

    act(() => useShellStore.setState({ editingMessageId: "m-059" }));
    await settle();
    expect(screen.getByText("message 59").getAttribute("data-editing")).toBe("true");

    act(() => messageList().scrollTo({ top: 0 }));
    await settle();

    expect(screen.getByText("message 0")).toBeInTheDocument();
    // Far outside the window, but still mounted so an unsaved draft survives.
    expect(screen.getByText("message 59").getAttribute("data-editing")).toBe("true");
    expect(screen.queryByText("message 40")).not.toBeInTheDocument();
  });
});

describe("MessageTimeline keyboard", () => {
  it("shows the NAVIGATE hints inside the message area, not over the composer", () => {
    setMessages([0, 1, 2].map((i) => makeMessage(i)));
    render(<MessageTimeline />);
    const list = screen.getByRole("listbox", { name: "Messages" });
    fireEvent.focus(list);
    const hints = screen.getByText("NAVIGATE");
    expect(list.parentElement).toContainElement(hints);
    expect(list.parentElement).not.toContainElement(screen.getByTestId("composer"));
  });

  it("jumps to the first and last message with Home and End", () => {
    setMessages([0, 1, 2, 3, 4].map((i) => makeMessage(i)));
    render(<MessageTimeline />);
    const list = screen.getByRole("listbox", { name: "Messages" });
    act(() => useShellStore.setState({ navigationMode: true }));

    fireEvent.keyDown(list, { key: "Home" });
    expect(screen.getByText("message 0").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getByText("message 4").getAttribute("aria-selected")).toBe("true");
  });

  it("opens the selected message's actions with the context-menu key or Shift+F10", () => {
    setMessages([0, 1, 2].map((i) => makeMessage(i)));
    render(<MessageTimeline />);
    const list = screen.getByRole("listbox", { name: "Messages" });
    act(() => useShellStore.setState({ navigationMode: true }));

    fireEvent.keyDown(list, { key: "ContextMenu" });
    expect(screen.getByRole("menuitem", { name: "Actions for m-002" })).toBeInTheDocument();

    fireEvent.keyDown(list, { key: "k" });
    fireEvent.keyDown(list, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menuitem", { name: "Actions for m-001" })).toBeInTheDocument();
  });

  it("leaves the context-menu key to a link or attachment in the row that took it", () => {
    setMessages([0, 1, 2].map((i) => makeMessage(i)));
    render(<MessageTimeline />);
    const list = screen.getByRole("listbox", { name: "Messages" });
    act(() => useShellStore.setState({ navigationMode: true }));

    const taken = createEvent.keyDown(screen.getByText("message 2"), { key: "ContextMenu" });
    taken.preventDefault();
    fireEvent(screen.getByText("message 2"), taken);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.keyDown(list, { key: "ContextMenu" });
    expect(screen.getByRole("menuitem", { name: "Actions for m-002" })).toBeInTheDocument();
  });

  it("keeps Escape in the list in Vim mode: it drops the selection, not the mode", () => {
    useKeybindProfileStore.getState().setVimMode(true);
    try {
      setMessages([0, 1].map((i) => makeMessage(i)));
      render(<MessageTimeline />);
      const list = screen.getByRole("listbox", { name: "Messages" });
      act(() => useShellStore.setState({ navigationMode: true }));
      expect(screen.getByText("message 1").getAttribute("aria-selected")).toBe("true");

      fireEvent.keyDown(list, { key: "Escape" });
      expect(screen.getByText("message 1").getAttribute("aria-selected")).toBe("false");
      expect(useShellStore.getState().navigationMode).toBe(true);
    } finally {
      useKeybindProfileStore.getState().setVimMode(false);
    }
  });

  it("keeps the newest message clear of the NAVIGATE hints when navigation starts at the bottom", async () => {
    setMessages(range(0, 20));
    render(<MessageTimeline />);
    await settle();
    const oldMax = maxScrollTop();

    act(() => useShellStore.setState({ navigationMode: true }));
    await settle();

    expect(maxScrollTop()).toBe(oldMax + 36);
    expect(messageList().scrollTop).toBe(maxScrollTop());
    expect(rowViewportOffset("m-019")! + ROW).toBeLessThanOrEqual(VIEWPORT - 36);
  });

  it("selects the pressed message without scrolling when a pointer press focuses the list", async () => {
    setMessages(range(0, 30));
    render(<MessageTimeline />);
    await settle();
    act(() => messageList().scrollTo({ top: 100 }));
    await settle();

    const row = document.querySelector<HTMLElement>("[data-index] [data-message-id]")!;
    fireEvent.mouseDown(row);
    act(() => messageList().focus());
    await settle();

    expect(row.getAttribute("aria-selected")).toBe("true");
    expect(messageList().scrollTop).toBe(100);
  });

  it("keeps its place at the bottom while a pointer press focuses the list", async () => {
    setMessages(range(0, 20));
    render(<MessageTimeline />);
    await settle();
    const before = messageList().scrollTop;
    expect(before).toBe(maxScrollTop());

    const row = document.querySelector<HTMLElement>('[data-message-id="m-019"]')!;
    fireEvent.mouseDown(row);
    act(() => messageList().focus());
    await settle();

    expect(useShellStore.getState().navigationMode).toBe(true);
    expect(messageList().scrollTop).toBe(before);
    expect(row.getAttribute("aria-selected")).toBe("true");

    fireEvent.mouseUp(window);
    act(() => useShellStore.setState({ navigationMode: false }));
    await settle();
    act(() => useShellStore.setState({ navigationMode: true }));
    await settle();
    expect(messageList().scrollTop).toBe(maxScrollTop());
  });
});

describe("MessageTimeline — the menu of an own message for a moderator", () => {
  it("offers the author's actions when the cached copy carries no author object", () => {
    messageMenu.real = true;
    setMessages([makeMessage(0), makeMessage(1, { authorId: "me", author: null })]);
    render(<MessageTimeline />);
    const list = screen.getByRole("listbox", { name: "Messages" });
    act(() => useShellStore.setState({ navigationMode: true }));

    fireEvent.keyDown(list, { key: "ContextMenu" });

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Edit message" })).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitem", { name: "Delete message…" })).toHaveLength(1);
    expect(within(menu).queryByRole("menuitem", { name: "Report message…" })).toBeNull();
    expect(within(menu).queryByText("Moderation")).toBeNull();
  });

  it("still offers a moderator's actions on another member's message", () => {
    messageMenu.real = true;
    setMessages([makeMessage(0, { authorId: "me", author: null }), makeMessage(1)]);
    render(<MessageTimeline />);
    const list = screen.getByRole("listbox", { name: "Messages" });
    act(() => useShellStore.setState({ navigationMode: true }));

    fireEvent.keyDown(list, { key: "ContextMenu" });

    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Edit message" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Report message…" })).toBeInTheDocument();
    expect(within(menu).getByText("Moderation")).toBeInTheDocument();
  });
});

describe("MessageTimeline — DM sent as a request", () => {
  beforeEach(() => {
    dmRequest.conversation = makeConversation({
      id: "conv-1",
      title: null,
      conversationType: ConversationTypeEnum.DIRECT,
      memberIds: ["me", "u-alice"],
      memberCount: 2,
    });
  });

  /** `count` messages the viewer sent. */
  function sent(count: number) {
    setMessages(range(0, count).map((m) => ({ ...m, authorId: "me" })));
  }

  it("says the DM went as a request, and once the held messages are used, that the rest waits", () => {
    dmRequest.pending = true;
    sent(1);
    const { unmount } = render(<MessageTimeline />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sent as a request; u-alice has not accepted yet.",
    );
    expect(screen.queryByText(/The rest waits/)).not.toBeInTheDocument();
    unmount();

    sent(2);
    render(<MessageTimeline />);
    expect(screen.getByText("The rest waits for u-alice's acceptance.")).toBeInTheDocument();
  });

  it("says nothing once the request is accepted", () => {
    sent(3);
    render(<MessageTimeline />);
    expect(screen.queryByText(/Sent as a request/)).not.toBeInTheDocument();
  });
});

describe("MessageTimeline — a request the viewer received", () => {
  afterEach(() => {
    incoming.requests = [];
  });

  it("shows the request's decision instead of the composer", () => {
    incoming.requests = [{ id: "req-1", conversationId: "conv-1" }];
    setMessages(range(0, 1));
    render(<MessageTimeline />);
    expect(screen.getByTestId("request-bar")).toHaveTextContent("req-1");
    expect(screen.queryByTestId("composer")).not.toBeInTheDocument();
  });

  it("keeps the composer for a conversation without one", () => {
    incoming.requests = [{ id: "req-2", conversationId: "another" }];
    setMessages(range(0, 1));
    render(<MessageTimeline />);
    expect(screen.getByTestId("composer")).toBeInTheDocument();
    expect(screen.queryByTestId("request-bar")).not.toBeInTheDocument();
  });
});

describe("MessageTimeline — an empty conversation", () => {
  function group(encryptedAt: string | null) {
    return makeConversation({
      id: "conv-1",
      title: null,
      conversationType: ConversationTypeEnum.GROUP,
      memberIds: ["me", "u-alice", "u-bob"],
      memberCount: 3,
      encryptedAt,
    });
  }

  it("says an empty encrypted conversation is end-to-end encrypted", () => {
    dmRequest.conversation = group("2026-10-15T00:00:00Z");
    const { unmount } = render(<MessageTimeline />);
    expect(screen.getByText("No messages yet. Start the conversation below.")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-empty-encrypted")).toHaveTextContent(
      "This conversation is end-to-end encrypted.",
    );
    unmount();

    dmRequest.conversation = group(null);
    render(<MessageTimeline />);
    expect(screen.queryByTestId("timeline-empty-encrypted")).toBeNull();
  });
});

describe("MessageTimeline — reply", () => {
  beforeEach(() => {
    messageMenu.real = true;
    messageItem.real = true;
    composer.real = true;
    dmRequest.conversation = makeConversation();
  });

  it("Reply from the menu quotes the message above the composer", async () => {
    const parent = makeMessage(0, { text: "Lunch at noon?" });
    setMessages([parent]);
    sendMutateAsync.mockResolvedValue({ sendMessage: { id: "m-new" } });
    const { rerender } = render(<MessageTimeline />);
    await settle();

    fireEvent.contextMenu(screen.getByText("Lunch at noon?"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply" }));

    expect(screen.getByText("Replying to")).toBeInTheDocument();
    const bar = screen.getByText("Replying to").parentElement!;
    expect(within(bar).getByText("alice")).toBeInTheDocument();
    expect(within(bar).getByText("Lunch at noon?")).toBeInTheDocument();
    const textbox = document.querySelector<HTMLTextAreaElement>("[data-composer-input]")!;
    expect(textbox).toHaveFocus();
    expect(useShellStore.getState().navigationMode).toBe(false);

    fireEvent.change(textbox, { target: { value: "agreed" } });
    fireEvent.keyDown(textbox, { key: "Enter" });
    await act(async () => {});
    expect(sendMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1", parentMessageId: parent.id }),
    );
    expect(screen.queryByText("Replying to")).not.toBeInTheDocument();

    setMessages([
      parent,
      makeMessage(1, { id: "m-new", authorId: "me", text: "agreed", parentMessageId: parent.id }),
    ]);
    rerender(<MessageTimeline />);
    await settle();
    expect(
      document.querySelector(`[data-message-id="m-new"] [data-reply-quote="${parent.id}"]`),
    ).toHaveTextContent("Lunch at noon?");
  });

  it("keeps rows memoized when a new message is appended where the viewer can reply", () => {
    messageItem.real = false;
    composer.real = false;
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

  it("offers no Reply in a moderators-only channel to a member", async () => {
    posting.rights = { message: false, thread: false, reaction: false, pin: false };
    composer.real = false;
    setMessages([makeMessage(0, { text: "Lunch at noon?" })]);
    render(<MessageTimeline />);
    await settle();

    fireEvent.contextMenu(screen.getByText("Lunch at noon?"));
    expect(screen.queryByRole("menuitem", { name: "Reply" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();

    const list = messageList();
    fireEvent.focus(list);
    const hints = screen.getByText("NAVIGATE").parentElement!;
    expect(within(hints).getByText("Copy")).toBeInTheDocument();
    expect(within(hints).queryByText("Reply")).not.toBeInTheDocument();
    expect(within(hints).queryByText("Pin")).not.toBeInTheDocument();
    expect(within(hints).queryByText("Thread")).not.toBeInTheDocument();
    fireEvent.keyDown(list, { key: "r" });
    expect(useReplyTargetStore.getState().targets).toEqual({});
  });
});
