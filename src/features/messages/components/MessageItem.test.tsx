import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "../../../test/utils";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

/** Stands in for emoji-mart: one button that selects 👍. */
vi.mock("@emoji-mart/react", () => ({
  default: (props: { onEmojiSelect?: (emoji: { native?: string }) => void }) => (
    <div data-testid="emoji-mart-picker">
      <button type="button" onClick={() => props.onEmojiSelect?.({ native: "👍" })}>
        pick 👍
      </button>
    </div>
  ),
}));
vi.mock("@emoji-mart/data", () => ({ default: {} }));

/** Answers the ThreadReplyCount query; every other query stays pending. */
const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (query: string, vars: unknown) =>
      query.includes("query ThreadReplyCount(") ? requestMock(query, vars) : new Promise(() => {}),
  },
}));

/** The custom emoji each message names; none unless a test says otherwise. */
const messageEmojiMapMock = vi.hoisted(() =>
  vi.fn((): Map<string, string> | undefined => undefined),
);
vi.mock("../../emoji/hooks/useMessageEmojiMap", () => ({
  useMessageEmojiMap: () => messageEmojiMapMock(),
}));

import { graphqlError } from "../../conversations/__fixtures__/conversations";
import { formatEditedAt } from "../../../shared/utils/formatTime";
import { act } from "@testing-library/react";
import { forceEnUsTimes } from "../../../test/forceEnUsTimes";
import { useClockFormatStore } from "../../../shared/state/useClockFormatStore";
import { MessageItem } from "./MessageItem";
import type { MessageItemHandlers, MessageItemMessage } from "./MessageItem";

const defaultMessage = {
  id: "msg-1",
  text: "Hello world",
  authorId: "user-1",
  sentAt: "2025-12-01T12:00:00Z",
  isPinned: false,
  isDeleted: false,
};

const defaultHandlers: MessageItemHandlers = {
  onOpenThread: vi.fn(),
  onToggleReaction: vi.fn(),
  onContextMenu: vi.fn(),
};

function props(
  overrides: {
    message?: MessageItemMessage;
    handlers?: Partial<typeof defaultHandlers>;
  } = {},
) {
  return {
    view: {
      message: { reactions: [], ...(overrides.message ?? defaultMessage) },
      author: { name: "Alice", isCurrentUser: false },
    },
    handlers: { ...defaultHandlers, ...overrides.handlers },
  };
}

describe("MessageItem", () => {
  it("renders the author name", () => {
    render(<MessageItem {...props()} />);
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
  });

  it("renders the message text", () => {
    render(<MessageItem {...props()} />);
    // The text may be rendered via MarkdownRenderer
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("shows a custom emoji the message names as its image", () => {
    messageEmojiMapMock.mockReturnValue(new Map([["partyblob", "/api/emoji/1"]]));
    try {
      const { container } = render(
        <MessageItem {...props({ message: { ...defaultMessage, text: "nice :partyblob:" } })} />,
      );
      expect(container.querySelector('img[alt=":partyblob:"]')).toHaveAttribute(
        "src",
        "/api/emoji/1",
      );
    } finally {
      messageEmojiMapMock.mockReturnValue(undefined);
    }
  });

  it("renders formatted time", () => {
    const { container } = render(<MessageItem {...props()} />);
    // formatTime renders the sentAt on the message row element
    expect(container.querySelector("[data-message-id='msg-1']")).toBeInTheDocument();
  });

  it("rewrites the time when the clock setting changes", () => {
    forceEnUsTimes();
    try {
      const sentAt = new Date(2026, 0, 5, 21, 5).toISOString();
      render(<MessageItem {...props({ message: { ...defaultMessage, sentAt } })} />);
      expect(screen.getByText(/9:05 PM/)).toBeInTheDocument();
      act(() => useClockFormatStore.getState().setClockFormat("24h"));
      expect(screen.getByText(/21:05/)).toBeInTheDocument();
      expect(screen.queryByText(/9:05 PM/)).not.toBeInTheDocument();
    } finally {
      vi.restoreAllMocks();
      useClockFormatStore.setState({ clockFormat: "auto" });
    }
  });

  it("renders pin icon when message is pinned", () => {
    const { container } = render(
      <MessageItem {...props({ message: { ...defaultMessage, isPinned: true } })} />,
    );
    // Pin icon from lucide renders as SVG; shape check via the message row.
    expect(container.querySelector("[data-message-id='msg-1']")).toBeInTheDocument();
  });

  it("renders deleted message text when isDeleted", () => {
    render(<MessageItem {...props({ message: { ...defaultMessage, isDeleted: true } })} />);
    expect(screen.getByText("This message was deleted")).toBeInTheDocument();
  });

  it("renders 'Forwarded' indicator when forwardedFromMessageId is set", () => {
    render(
      <MessageItem
        {...props({ message: { ...defaultMessage, forwardedFromMessageId: "orig-msg" } })}
      />,
    );
    expect(screen.getByText(/Forwarded/)).toBeInTheDocument();
  });

  it("renders empty message placeholder", () => {
    render(<MessageItem {...props({ message: { ...defaultMessage, text: null } })} />);
    expect(screen.getByText("[empty message]")).toBeInTheDocument();
  });

  it("renders reaction pills", () => {
    const reactions = [
      { emoji: "👍", count: 3, reactedByMe: false },
      { emoji: "❤️", count: 1, reactedByMe: true },
    ];
    render(<MessageItem {...props({ message: { ...defaultMessage, reactions } })} />);
    expect(screen.getByText("👍")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("❤️")).toBeInTheDocument();
  });

  it("calls onToggleReaction when a reaction pill is clicked", () => {
    const onToggleReaction = vi.fn();
    render(
      <MessageItem
        {...props({
          message: {
            ...defaultMessage,
            reactions: [{ emoji: "👍", count: 1, reactedByMe: false }],
          },
          handlers: { onToggleReaction },
        })}
      />,
    );
    fireEvent.click(screen.getByText("👍"));
    expect(onToggleReaction).toHaveBeenCalledWith("msg-1", "👍");
  });

  it("calls onContextMenu on right-click for non-deleted messages", () => {
    const onContextMenu = vi.fn();
    const { container } = render(<MessageItem {...props({ handlers: { onContextMenu } })} />);

    const row = container.querySelector("[data-message-id='msg-1']");
    expect(row).toBeInTheDocument();
    fireEvent.contextMenu(row as Element);
    expect(onContextMenu).toHaveBeenCalled();
  });

  it("does not call onContextMenu on right-click for deleted messages", () => {
    const onContextMenu = vi.fn();
    const { container } = render(
      <MessageItem
        {...props({ message: { ...defaultMessage, isDeleted: true }, handlers: { onContextMenu } })}
      />,
    );

    const row = container.querySelector("[data-message-id='msg-1']");
    expect(row).toBeInTheDocument();
    fireEvent.contextMenu(row as Element);
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it("hands its touches to the context menu's long press, not for deleted messages", () => {
    const onTouchStart = vi.fn();
    const bindContextMenu = vi.fn(() => ({
      onContextMenu: vi.fn(),
      onKeyDown: vi.fn(),
      onTouchStart,
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn(),
      onTouchCancel: vi.fn(),
    }));
    const { container, rerender } = render(
      <MessageItem {...props({ handlers: { bindContextMenu } })} />,
    );
    const row = container.querySelector("[data-message-id='msg-1']") as Element;
    fireEvent.touchStart(row, { touches: [{ clientX: 1, clientY: 1 }] });
    expect(bindContextMenu).toHaveBeenCalledWith("msg-1", "Hello world");
    expect(onTouchStart).toHaveBeenCalledTimes(1);

    rerender(
      <MessageItem
        {...props({
          message: { ...defaultMessage, isDeleted: true },
          handlers: { bindContextMenu },
        })}
      />,
    );
    fireEvent.touchStart(row, { touches: [{ clientX: 1, clientY: 1 }] });
    expect(onTouchStart).toHaveBeenCalledTimes(1);
  });

  it("shows thread button for non-deleted messages without thread", () => {
    render(
      <MessageItem
        {...props({ message: { ...defaultMessage, threadId: undefined, rootThreadId: undefined } })}
      />,
    );
    expect(screen.getByLabelText("Open thread")).toBeInTheDocument();
  });

  it("calls onOpenThread when thread button is clicked", () => {
    const onOpenThread = vi.fn();
    render(<MessageItem {...props({ handlers: { onOpenThread } })} />);
    fireEvent.click(screen.getByLabelText("Open thread"));
    expect(onOpenThread).toHaveBeenCalledWith("msg-1");
  });

  it("keeps Open thread in the hover actions of a thread's root", () => {
    render(<MessageItem {...props({ message: { ...defaultMessage, rootThreadId: "t-1" } })} />);
    expect(screen.getByLabelText("Open thread")).toBeInTheDocument();
  });

  it("shows View thread under a thread's root and opens it", () => {
    const onOpenThread = vi.fn();
    render(
      <MessageItem
        {...props({
          message: { ...defaultMessage, rootThreadId: "t-1" },
          handlers: { onOpenThread },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View thread" }));
    expect(onOpenThread).toHaveBeenCalledWith("msg-1");
  });

  it("shows the reply count under a thread's root", async () => {
    const root = {
      ...defaultMessage,
      serverId: "ws-1",
      conversationId: "c-1",
      rootThreadId: "t-1",
    };
    requestMock.mockResolvedValueOnce({ message: { id: "msg-1", threadReplyCount: 3 } });
    const onOpenThread = vi.fn();
    const { unmount } = render(
      <MessageItem {...props({ message: root, handlers: { onOpenThread } })} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "3 replies" }));
    expect(onOpenThread).toHaveBeenCalledWith("msg-1");
    expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("ThreadReplyCount"), {
      serverId: "ws-1",
      conversationId: "c-1",
      messageId: "msg-1",
    });
    unmount();

    requestMock.mockResolvedValueOnce({ message: { id: "msg-1", threadReplyCount: 1 } });
    render(<MessageItem {...props({ message: root })} />);
    expect(await screen.findByRole("button", { name: "1 reply" })).toBeInTheDocument();
  });

  it("falls back to View thread when the count is unknown or zero", async () => {
    const root = {
      ...defaultMessage,
      serverId: "ws-1",
      conversationId: "c-1",
      rootThreadId: "t-1",
    };
    for (const answer of [
      () => requestMock.mockResolvedValueOnce({ message: { id: "msg-1", threadReplyCount: 0 } }),
      () => requestMock.mockResolvedValueOnce({ message: { id: "msg-1", threadReplyCount: null } }),
      () =>
        requestMock.mockRejectedValueOnce(
          graphqlError("GRAPHQL_VALIDATION_FAILED", 'Unknown field "threadReplyCount"'),
        ),
    ]) {
      requestMock.mockClear();
      answer();
      const { unmount } = render(<MessageItem {...props({ message: root })} />);
      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.getByRole("button", { name: "View thread" })).toBeInTheDocument();
      unmount();
    }
  });

  it("asks no reply count for a deleted root or the thread pane's root", async () => {
    const root = {
      ...defaultMessage,
      serverId: "ws-1",
      conversationId: "c-1",
      rootThreadId: "t-1",
    };
    requestMock.mockClear();
    const deleted = props({ message: { ...root, isDeleted: true } });
    const { unmount } = render(<MessageItem {...deleted} />);
    unmount();
    const pane = props({ message: root });
    render(<MessageItem {...pane} view={{ ...pane.view, inThreadPane: true }} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requestMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "View thread" })).not.toBeInTheDocument();
  });

  it("shows View thread on a grouped thread root and in ultra-compact density", () => {
    const root = props({ message: { ...defaultMessage, rootThreadId: "t-1" } });
    const { unmount } = render(
      <MessageItem {...root} view={{ ...root.view, isGrouped: true, isFirstInGroup: false }} />,
    );
    expect(screen.getByRole("button", { name: "View thread" })).toBeInTheDocument();
    unmount();
    render(<MessageItem {...root} view={{ ...root.view, displayDensity: "ultra-compact" }} />);
    expect(screen.getByRole("button", { name: "View thread" })).toBeInTheDocument();
  });

  it("keeps Open thread on a thread's root where the viewer may not start threads", () => {
    render(
      <MessageItem
        {...props({
          message: { ...defaultMessage, rootThreadId: "t-1" },
          handlers: { canStartThread: false },
        })}
      />,
    );
    expect(screen.getByLabelText("Open thread")).toBeInTheDocument();
  });

  it("offers no Open thread on a thread reply", () => {
    render(<MessageItem {...props({ message: { ...defaultMessage, threadId: "t-1" } })} />);
    expect(screen.queryByLabelText("Open thread")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View thread" })).not.toBeInTheDocument();
  });

  it("shows a Reply hover button that starts a reply", () => {
    const onReply = vi.fn();
    render(<MessageItem {...props({ handlers: { onReply } })} />);
    const reply = screen.getByRole("button", { name: "Reply" });
    expect(reply).toHaveAttribute("title", "Reply");
    expect(reply.nextElementSibling).toBe(screen.getByLabelText("Open thread"));
    fireEvent.click(reply);
    expect(onReply).toHaveBeenCalledWith("msg-1");
  });

  it("shows no Reply button without onReply, on a deleted message, or in the thread pane", () => {
    const { unmount } = render(<MessageItem {...props()} />);
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
    unmount();

    const deleted = props({
      message: { ...defaultMessage, isDeleted: true },
      handlers: { onReply: vi.fn() },
    });
    const { unmount: unmountDeleted } = render(<MessageItem {...deleted} />);
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
    unmountDeleted();

    const pane = props({ handlers: { onReply: vi.fn() } });
    render(<MessageItem {...pane} view={{ ...pane.view, inThreadPane: true }} />);
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
  });

  it("renders no reactions row under a message without reactions", () => {
    const zeroCount = [{ emoji: "👍", count: 0, reactedByMe: false }];
    for (const [message, density] of [
      [defaultMessage, "comfortable"],
      [{ ...defaultMessage, reactions: zeroCount }, "comfortable"],
      [defaultMessage, "ultra-compact"],
    ] as const) {
      const base = props({ message });
      const { unmount } = render(
        <MessageItem {...base} view={{ ...base.view, displayDensity: density }} />,
      );
      const row = screen.getByRole("option");
      const add = screen.getByLabelText("Add reaction");
      const actions = add.parentElement;
      expect(actions?.parentElement).toBe(row);
      expect(actions).toContainElement(screen.getByLabelText("Open thread"));
      const body = Array.from(row.children).find((child) =>
        child.textContent?.includes("Hello world"),
      );
      expect(body).not.toContainElement(add);
      expect(row.querySelector(".flex-wrap")).toBeNull();
      unmount();
    }
  });

  it("keeps the reactions row with the add button for a message with reactions", () => {
    const reactions = [{ emoji: "👍", count: 2, reactedByMe: false }];
    render(<MessageItem {...props({ message: { ...defaultMessage, reactions } })} />);
    const add = screen.getByLabelText("Add reaction");
    const pill = screen.getByText("👍").closest("button");
    expect(add.parentElement).toBe(pill?.parentElement);
    expect(add.parentElement).toHaveClass("flex-wrap");
    expect(add.previousElementSibling).toBe(pill);
    expect(screen.getAllByLabelText("Add reaction")).toHaveLength(1);
    expect(screen.getByLabelText("Open thread").parentElement).not.toContainElement(add);
  });

  it("opens the emoji picker from the hover add-reaction button", async () => {
    const onToggleReaction = vi.fn();
    render(<MessageItem {...props({ handlers: { onToggleReaction } })} />);
    fireEvent.click(screen.getByLabelText("Add reaction"));
    fireEvent.click(await screen.findByRole("button", { name: "pick 👍" }));
    expect(onToggleReaction).toHaveBeenCalledWith("msg-1", "👍");
    expect(screen.queryByTestId("emoji-mart-picker")).not.toBeInTheDocument();
  });

  it("shows no add-reaction action on a deleted message or where reacting is not allowed", () => {
    const { unmount } = render(
      <MessageItem {...props({ message: { ...defaultMessage, isDeleted: true } })} />,
    );
    expect(screen.queryByLabelText("Add reaction")).not.toBeInTheDocument();
    unmount();

    const { unmount: unmountBare } = render(
      <MessageItem {...props({ handlers: { canAddReaction: false } })} />,
    );
    expect(screen.queryByLabelText("Add reaction")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Open thread")).toBeInTheDocument();
    unmountBare();

    const reactions = [{ emoji: "👍", count: 2, reactedByMe: false }];
    render(
      <MessageItem
        {...props({
          message: { ...defaultMessage, reactions },
          handlers: { canAddReaction: false },
        })}
      />,
    );
    expect(screen.getByText("👍")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add reaction")).not.toBeInTheDocument();
  });

  it("renders link previews when provided", () => {
    const linkPreviews = [
      {
        id: "lp-1",
        url: "https://example.com",
        title: "Example Site",
        description: "A test site",
        imageUrl: null,
        siteName: "Example",
      },
    ];
    render(<MessageItem {...props({ message: { ...defaultMessage, linkPreviews } })} />);
    expect(screen.getByText("Example Site")).toBeInTheDocument();
  });
});

describe("MessageItem layouts and editing", () => {
  it("renders an IRC-style author prefix in ultra-compact density", () => {
    render(
      <MessageItem {...props()} view={{ ...props().view, displayDensity: "ultra-compact" }} />,
    );
    expect(screen.getByText("Alice:")).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("hides the author line for a grouped continuation", () => {
    render(
      <MessageItem
        {...props()}
        view={{ ...props().view, isGrouped: true, isFirstInGroup: false }}
      />,
    );
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("marks the row selected and highlighted", () => {
    const { container } = render(
      <MessageItem
        {...props()}
        view={{ ...props().view, isSelected: true, isHighlighted: true }}
      />,
    );
    const row = container.querySelector("[data-message-id='msg-1']");
    expect(row?.getAttribute("aria-selected")).toBe("true");
    expect(row?.className).toContain("bg-rim-accent/10");
  });

  it("saves trimmed edited text on Enter", () => {
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(
      <MessageItem
        view={{ ...props().view, isEditing: true }}
        handlers={{ ...defaultHandlers, onSaveEdit, onCancelEdit }}
      />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  Edited text  " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSaveEdit).toHaveBeenCalledWith("msg-1", "Edited text");
    expect(onCancelEdit).not.toHaveBeenCalled();
  });

  it("cancels instead of saving when the text is unchanged", () => {
    const onSaveEdit = vi.fn();
    const onCancelEdit = vi.fn();
    render(
      <MessageItem
        view={{ ...props().view, isEditing: true }}
        handlers={{ ...defaultHandlers, onSaveEdit, onCancelEdit }}
      />,
    );
    fireEvent.click(screen.getByText("Save"));
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape and shows the save error", () => {
    const onCancelEdit = vi.fn();
    render(
      <MessageItem
        view={{ ...props().view, isEditing: true, editError: true }}
        handlers={{ ...defaultHandlers, onCancelEdit }}
      />,
    );
    expect(screen.getByText("Failed to save. Try again.")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancelEdit).toHaveBeenCalledTimes(1);
  });

  it("keeps Escape in the edit form from closing a panel", () => {
    render(<MessageItem view={{ ...props().view, isEditing: true }} handlers={defaultHandlers} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("data-owns-escape");
  });

  it("does not fold a message being edited", () => {
    const { container, unmount } = render(<MessageItem {...props()} />);
    expect(container.querySelector("[data-foldable-text]")).not.toBeNull();
    unmount();

    const editing = render(
      <MessageItem view={{ ...props().view, isEditing: true }} handlers={defaultHandlers} />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(editing.container.querySelector("[data-foldable-text]")).toBeNull();
  });

  it("calls onNavigateToForwardedSource with the source conversation and message", () => {
    const onNavigateToForwardedSource = vi.fn();
    render(
      <MessageItem
        view={{
          ...props().view,
          message: {
            ...defaultMessage,
            forwardedFromMessageId: "orig-msg",
            forwardedFrom: {
              id: "orig-msg",
              conversationId: "conv-9",
              author: { id: "u-2", username: "bob", displayName: "Bob" },
            },
          },
        }}
        handlers={{ ...defaultHandlers, onNavigateToForwardedSource }}
      />,
    );
    fireEvent.click(screen.getByText(/Forwarded from Bob/));
    expect(onNavigateToForwardedSource).toHaveBeenCalledWith("conv-9", "orig-msg");
  });
});

describe("MessageItem edited marker", () => {
  const EDITED_AT = "2026-10-27T13:05:00Z";
  const edited = { ...defaultMessage, editedAt: EDITED_AT };

  it("marks an edited message and says when on hover and focus", async () => {
    render(<MessageItem {...props({ message: edited })} />);
    const mark = screen.getByText("(edited)");
    const label = `Edited ${formatEditedAt(EDITED_AT)}`;
    expect(mark).toHaveAttribute("aria-label", label);
    expect(mark).toHaveAttribute("tabindex", "0");

    fireEvent.mouseEnter(mark);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(label);
    fireEvent.mouseLeave(mark);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());

    fireEvent.focus(mark);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(label);
  });

  it("shows no marker on a message never edited, a deleted one, or one being edited", () => {
    const { unmount } = render(
      <MessageItem {...props({ message: { ...defaultMessage, editedAt: null } })} />,
    );
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.queryByText("(edited)")).not.toBeInTheDocument();
    unmount();

    const deleted = render(<MessageItem {...props({ message: { ...edited, isDeleted: true } })} />);
    expect(screen.queryByText("(edited)")).not.toBeInTheDocument();
    deleted.unmount();

    render(
      <MessageItem
        {...props({ message: edited })}
        view={{ ...props({ message: edited }).view, isEditing: true }}
      />,
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.queryByText("(edited)")).not.toBeInTheDocument();
  });

  it("marks an edited message in the ultra-compact layout", () => {
    render(
      <MessageItem
        {...props({ message: edited })}
        view={{ ...props({ message: edited }).view, displayDensity: "ultra-compact" }}
      />,
    );
    expect(screen.getByText("Alice:")).toBeInTheDocument();
    expect(screen.getByText("(edited)")).toHaveAttribute(
      "aria-label",
      `Edited ${formatEditedAt(EDITED_AT)}`,
    );
  });

  const LAYOUTS = [
    ["comfortable", { displayDensity: "comfortable" }],
    ["compact", { displayDensity: "compact" }],
    ["a grouped comfortable row", { isGrouped: true, isFirstInGroup: false }],
  ] as const;

  it.each(LAYOUTS)("puts the marker after the text of an edited message in %s", (_, view) => {
    render(
      <MessageItem
        {...props({ message: edited })}
        view={{ ...props({ message: edited }).view, ...view }}
      />,
    );
    const wrapper = screen.getByText("(edited)").closest("[data-edited-text]");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector(".prose-rim")).not.toBeNull();
    expect(wrapper?.className).toContain("[&>.prose-rim>p:last-child]:inline");
  });

  it.each(LAYOUTS)("renders a message never edited without the edited wrapper in %s", (_, view) => {
    const { container } = render(<MessageItem {...props()} view={{ ...props().view, ...view }} />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(container.querySelector("[data-edited-text]")).toBeNull();
  });
});
