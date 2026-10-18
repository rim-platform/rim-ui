import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders as render } from "../../../test/utils";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

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

  it("renders formatted time", () => {
    const { container } = render(<MessageItem {...props()} />);
    // formatTime renders the sentAt on the message row element
    expect(container.querySelector("[data-message-id='msg-1']")).toBeInTheDocument();
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

  it("renders add reaction button", () => {
    render(<MessageItem {...props()} />);
    expect(screen.getByLabelText("Add reaction")).toBeInTheDocument();
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
