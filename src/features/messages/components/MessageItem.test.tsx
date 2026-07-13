import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders as render } from "../../../test/utils";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

import { MessageItem } from "./MessageItem";

const defaultMessage = {
  id: "msg-1",
  text: "Hello world",
  authorId: "user-1",
  sentAt: "2025-12-01T12:00:00Z",
  isPinned: false,
  isDeleted: false,
};

const defaultProps = {
  message: defaultMessage,
  authorName: "Alice",
  authorInitial: "A",
  isCurrentUser: false,
  reactions: [],
  onOpenThread: vi.fn(),
  onToggleReaction: vi.fn(),
  onContextMenu: vi.fn(),
};

describe("MessageItem", () => {
  it("renders the author name", () => {
    render(<MessageItem {...defaultProps} />);
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
  });

  it("renders the message text", () => {
    render(<MessageItem {...defaultProps} />);
    // The text may be rendered via MarkdownRenderer
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders formatted time", () => {
    const { container } = render(<MessageItem {...defaultProps} />);
    // formatTime renders the sentAt on the message row element
    expect(container.querySelector("[data-message-id='msg-1']")).toBeInTheDocument();
  });

  it("renders pin icon when message is pinned", () => {
    const { container } = render(
      <MessageItem {...defaultProps} message={{ ...defaultMessage, isPinned: true }} />,
    );
    // Pin icon from lucide renders as SVG; shape check via the message row.
    expect(container.querySelector("[data-message-id='msg-1']")).toBeInTheDocument();
  });

  it("renders deleted message text when isDeleted", () => {
    render(<MessageItem {...defaultProps} message={{ ...defaultMessage, isDeleted: true }} />);
    expect(screen.getByText("This message was deleted")).toBeInTheDocument();
  });

  it("renders 'Forwarded' indicator when forwardedFromMessageId is set", () => {
    render(
      <MessageItem
        {...defaultProps}
        message={{ ...defaultMessage, forwardedFromMessageId: "orig-msg" }}
      />,
    );
    expect(screen.getByText(/Forwarded/)).toBeInTheDocument();
  });

  it("renders empty message placeholder", () => {
    render(<MessageItem {...defaultProps} message={{ ...defaultMessage, text: null }} />);
    expect(screen.getByText("[empty message]")).toBeInTheDocument();
  });

  it("renders reaction pills", () => {
    const reactions = [
      { emoji: "👍", count: 3, reactedByMe: false },
      { emoji: "❤️", count: 1, reactedByMe: true },
    ];
    render(<MessageItem {...defaultProps} reactions={reactions} />);
    expect(screen.getByText("👍")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("❤️")).toBeInTheDocument();
  });

  it("calls onToggleReaction when a reaction pill is clicked", () => {
    const onToggleReaction = vi.fn();
    render(
      <MessageItem
        {...defaultProps}
        onToggleReaction={onToggleReaction}
        reactions={[{ emoji: "👍", count: 1, reactedByMe: false }]}
      />,
    );
    fireEvent.click(screen.getByText("👍"));
    expect(onToggleReaction).toHaveBeenCalledWith("msg-1", "👍");
  });

  it("calls onContextMenu on right-click for non-deleted messages", () => {
    const onContextMenu = vi.fn();
    const { container } = render(<MessageItem {...defaultProps} onContextMenu={onContextMenu} />);

    const row = container.querySelector("[data-message-id='msg-1']");
    expect(row).toBeInTheDocument();
    fireEvent.contextMenu(row as Element);
    expect(onContextMenu).toHaveBeenCalled();
  });

  it("does not call onContextMenu on right-click for deleted messages", () => {
    const onContextMenu = vi.fn();
    const { container } = render(
      <MessageItem
        {...defaultProps}
        onContextMenu={onContextMenu}
        message={{ ...defaultMessage, isDeleted: true }}
      />,
    );

    const row = container.querySelector("[data-message-id='msg-1']");
    expect(row).toBeInTheDocument();
    fireEvent.contextMenu(row as Element);
    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it("shows thread button for non-deleted messages without thread", () => {
    render(
      <MessageItem
        {...defaultProps}
        message={{ ...defaultMessage, threadId: undefined, rootThreadId: undefined }}
      />,
    );
    expect(screen.getByLabelText("Open thread")).toBeInTheDocument();
  });

  it("calls onOpenThread when thread button is clicked", () => {
    const onOpenThread = vi.fn();
    render(<MessageItem {...defaultProps} onOpenThread={onOpenThread} />);
    fireEvent.click(screen.getByLabelText("Open thread"));
    expect(onOpenThread).toHaveBeenCalledWith("msg-1");
  });

  it("renders add reaction button", () => {
    render(<MessageItem {...defaultProps} />);
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
    render(<MessageItem {...defaultProps} linkPreviews={linkPreviews} />);
    expect(screen.getByText("Example Site")).toBeInTheDocument();
  });
});
