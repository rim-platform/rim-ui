import { describe, it, expect, vi } from "vitest";

import { AttachmentStatusEnum } from "../../../../core/graphql/generated/schema-types";
import { areMessageItemPropsEqual } from "./areMessageItemPropsEqual";
import type { MessageItemProps } from "./types";

const handlers = { onOpenThread: vi.fn(), onToggleReaction: vi.fn() };
const members = { resolve: () => ({ displayName: "x", isCurrentUser: false }) };

function makeProps(overrides: Partial<MessageItemProps["view"]> = {}): MessageItemProps {
  return {
    view: {
      message: {
        id: "m-1",
        authorId: "u-1",
        sentAt: "2026-01-01T00:00:00Z",
        text: "hi",
        reactions: [{ emoji: "👍", count: 1, reactedByMe: false, userIds: ["u-2"] }],
        attachments: [],
        linkPreviews: [],
      },
      author: { name: "Alice", isCurrentUser: false },
      ...overrides,
    },
    handlers,
    members,
  };
}

describe("areMessageItemPropsEqual", () => {
  it("treats a freshly rebuilt but identical view model as equal", () => {
    expect(areMessageItemPropsEqual(makeProps(), makeProps())).toBe(true);
  });

  it("detects a new handlers object or member directory by reference", () => {
    const prev = makeProps();
    expect(areMessageItemPropsEqual(prev, { ...makeProps(), handlers: { ...handlers } })).toBe(
      false,
    );
    expect(areMessageItemPropsEqual(prev, { ...makeProps(), members: { ...members } })).toBe(false);
  });

  it("detects row state changes", () => {
    expect(areMessageItemPropsEqual(makeProps(), makeProps({ isSelected: true }))).toBe(false);
    expect(areMessageItemPropsEqual(makeProps(), makeProps({ isHighlighted: true }))).toBe(false);
    expect(areMessageItemPropsEqual(makeProps(), makeProps({ displayDensity: "compact" }))).toBe(
      false,
    );
  });

  it("re-renders when editedAt changes", () => {
    const base = makeProps();
    const edited = makeProps({
      message: { ...base.view.message, editedAt: "2026-10-27T12:00:00Z" },
    });
    expect(areMessageItemPropsEqual(base, edited)).toBe(false);
    expect(
      areMessageItemPropsEqual(edited, makeProps({ message: { ...edited.view.message } })),
    ).toBe(true);
  });

  it("re-renders when inThreadPane changes", () => {
    expect(areMessageItemPropsEqual(makeProps(), makeProps({ inThreadPane: true }))).toBe(false);
  });

  it("detects author changes by value", () => {
    const next = makeProps({ author: { name: "Alice", isCurrentUser: false, statusText: "away" } });
    expect(areMessageItemPropsEqual(makeProps(), next)).toBe(false);
  });

  it("compares the reply quote by value", () => {
    const quote = { messageId: "p-1", authorName: "Bob", excerpt: "hi" };
    expect(
      areMessageItemPropsEqual(makeProps({ replyTo: quote }), makeProps({ replyTo: { ...quote } })),
    ).toBe(true);
    expect(
      areMessageItemPropsEqual(
        makeProps({ replyTo: quote }),
        makeProps({ replyTo: { ...quote, excerpt: "edited" } }),
      ),
    ).toBe(false);
    expect(areMessageItemPropsEqual(makeProps({ replyTo: quote }), makeProps())).toBe(false);
    expect(areMessageItemPropsEqual(makeProps({ replyTo: null }), makeProps())).toBe(true);
  });

  it("detects a change of the message's conversation", () => {
    const next = makeProps();
    next.view.message = { ...next.view.message, conversationId: "c-2" };
    expect(areMessageItemPropsEqual(makeProps(), next)).toBe(false);
  });

  it("detects a thread being started on the message", () => {
    const next = makeProps();
    next.view.message = { ...next.view.message, rootThreadId: "t-1" };
    expect(areMessageItemPropsEqual(makeProps(), next)).toBe(false);
  });

  it("detects reaction count and attachment status changes", () => {
    const reacted = makeProps();
    reacted.view.message = {
      ...reacted.view.message,
      reactions: [{ emoji: "👍", count: 2, reactedByMe: true, userIds: ["u-2", "u-1"] }],
    };
    expect(areMessageItemPropsEqual(makeProps(), reacted)).toBe(false);

    const withAttachment = (status: AttachmentStatusEnum): MessageItemProps => {
      const p = makeProps();
      p.view.message = {
        ...p.view.message,
        attachments: [
          { id: "a-1", filename: "f.png", contentType: "image/png", sizeBytes: 1, status },
        ],
      };
      return p;
    };
    expect(
      areMessageItemPropsEqual(
        withAttachment(AttachmentStatusEnum.READY),
        withAttachment(AttachmentStatusEnum.READY),
      ),
    ).toBe(true);
    expect(
      areMessageItemPropsEqual(
        withAttachment(AttachmentStatusEnum.READY),
        withAttachment(AttachmentStatusEnum.FAILED),
      ),
    ).toBe(false);
  });
});
