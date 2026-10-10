import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders as render } from "../../../../test/utils";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { MessageItem } from "../MessageItem";
import { ReplyQuote } from "./ReplyQuote";
import { plainFirstLine, replyQuoteFor } from "./replyQuote";
import type { MessageItemMessage, MessageItemProps, ReplyQuoteView } from "./types";

const parent: MessageItemMessage = {
  id: "parent-1",
  text: "> quoted\n**Deploy** is done, see [the log](https://ci.example/1)\nsecond line",
  authorId: "user-2",
  sentAt: "2026-10-10T10:00:00Z",
};

describe("plainFirstLine", () => {
  it("takes the first line without Markdown syntax", () => {
    expect(plainFirstLine("## Title **bold**\nnext")).toBe("Title bold");
    expect(plainFirstLine("- item with `code`")).toBe("item with code");
    expect(plainFirstLine("\n\n> quoted text")).toBe("quoted text");
    expect(plainFirstLine("see [docs](https://x.example) now")).toBe("see docs now");
  });

  it("skips code fences and resolves mentions", () => {
    expect(plainFirstLine("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
    expect(plainFirstLine("ping <@u-1>", (id) => (id === "u-1" ? "Ada" : undefined))).toBe(
      "ping @Ada",
    );
  });

  it("shortens long lines", () => {
    const line = plainFirstLine("x".repeat(500));
    expect(line.length).toBe(140);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("replyQuoteFor", () => {
  it("quotes a loaded parent by author and first line", () => {
    expect(replyQuoteFor("parent-1", parent, "Bob")).toEqual({
      messageId: "parent-1",
      authorName: "Bob",
      excerpt: "quoted",
    });
  });

  it("names deleted, unverifiable, unreadable and unloaded parents", () => {
    expect(replyQuoteFor("p", { ...parent, isDeleted: true }, "Bob").excerpt).toBe(
      "This message was deleted",
    );
    const e2ee = { incarnation: 1, epoch: 1, senderDeviceId: "d" };
    expect(
      replyQuoteFor("p", { ...parent, e2ee: { ...e2ee, status: "invalid" } }, "Bob").excerpt,
    ).toBe("A message that could not be verified");
    expect(
      replyQuoteFor("p", { ...parent, text: "", e2ee: { ...e2ee, status: "undecryptable" } }, "Bob")
        .excerpt,
    ).toBe("A message this device cannot read");
    expect(replyQuoteFor("p", undefined, null)).toEqual({
      messageId: "p",
      authorName: null,
      excerpt: "Original message not loaded",
    });
  });

  it("quotes a decrypted parent from its decrypted text", () => {
    const decrypted = {
      ...parent,
      text: "secret plan",
      e2ee: { status: "decrypted" as const, incarnation: 1, epoch: 3, senderDeviceId: "d" },
    };
    expect(replyQuoteFor("p", decrypted, "Bob").excerpt).toBe("secret plan");
  });

  it("falls back to the first attachment's name", () => {
    const withFile = {
      ...parent,
      text: "",
      attachments: [
        {
          id: "a",
          filename: "report.pdf",
          contentType: "application/pdf",
          sizeBytes: 1,
          status: "READY" as const,
        },
      ],
    };
    expect(replyQuoteFor("p", withFile, "Bob").excerpt).toBe("report.pdf");
  });
});

const quote: ReplyQuoteView = { messageId: "parent-1", authorName: "Bob", excerpt: "quoted" };

describe("ReplyQuote", () => {
  it("shows the author and excerpt and jumps on click", async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    render(<ReplyQuote quote={quote} onJump={onJump} />);
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("quoted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Reply to Bob: quoted/ }));
    expect(onJump).toHaveBeenCalledWith("parent-1");
  });

  it("jumps with the keyboard", async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    render(<ReplyQuote quote={quote} onJump={onJump} />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onJump).toHaveBeenCalledWith("parent-1");
  });
});

describe("MessageItem reply quote", () => {
  function props(overrides: Partial<MessageItemProps["view"]> = {}): MessageItemProps {
    return {
      view: {
        message: {
          id: "reply-1",
          text: "on it",
          authorId: "user-1",
          sentAt: "2026-10-10T10:01:00Z",
          parentMessageId: "parent-1",
          reactions: [],
        },
        author: { name: "Alice", isCurrentUser: false },
        replyTo: quote,
        ...overrides,
      },
      handlers: { onOpenThread: vi.fn(), onToggleReaction: vi.fn(), onJumpToMessage: vi.fn() },
    };
  }

  it("renders the quote above the reply and jumps to the parent", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<MessageItem {...p} />);
    await user.click(screen.getByRole("button", { name: /Reply to Bob/ }));
    expect(p.handlers.onJumpToMessage).toHaveBeenCalledWith("parent-1");
    expect(screen.getByText("on it")).toBeInTheDocument();
  });

  it("renders the quote in the single-line density", () => {
    render(<MessageItem {...props({ displayDensity: "ultra-compact" })} />);
    expect(screen.getByRole("button", { name: /Reply to Bob/ })).toBeInTheDocument();
  });

  it("hides the quote of a deleted reply", () => {
    const p = props();
    p.view.message = { ...p.view.message, isDeleted: true };
    render(<MessageItem {...p} />);
    expect(screen.queryByRole("button", { name: /Reply to Bob/ })).toBeNull();
  });

  it("renders no quote for a message that is not a reply", () => {
    render(<MessageItem {...props({ replyTo: null })} />);
    expect(screen.queryByRole("button", { name: /Reply to/ })).toBeNull();
  });
});
