import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type { MessageItem } from "../../../../core/types/messages";

const applyLens = vi.hoisted(() =>
  vi.fn(() => ({ data: undefined, isPending: false, isError: false })),
);
const pages = vi.hoisted(() => ({ items: [] as unknown[] }));
const removal = {
  id: "r1",
  userId: "bob",
  removedById: "alice",
  removedAt: "2026-10-01T09:30:00Z",
  user: null,
  removedBy: null,
};
vi.mock("../../../lenses/api/useLenses", () => ({
  useApplyLens: applyLens,
  useLenses: () => ({
    data: [
      {
        id: "lens-1",
        name: "Mentions of sev1",
        filterSpec: {
          logic: "AND",
          conditions: [{ field: "TEXT_CONTAINS", op: "CONTAINS", value: "sev1" }],
        },
      },
    ],
  }),
}));
vi.mock("../../api/useMessages", () => ({
  useConversationMessages: () => ({
    data: { pages: [{ items: pages.items }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  }),
}));

import { useLensStore } from "../../../lenses/state/useLensStore";
import { useTimelineItems } from "./useTimelineItems";

function message(
  id: string,
  text: string,
  encrypted: boolean,
  sentAt = "2026-10-01T09:00:00Z",
): MessageItem {
  return {
    id,
    serverId: "ws",
    conversationId: "c",
    authorId: "u",
    author: null,
    text,
    hasAttachments: false,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    sentAt,
    reactions: [],
    attachments: [],
    linkPreviews: [],
    ...(encrypted
      ? { e2ee: { status: "decrypted" as const, incarnation: 1, epoch: 1, senderDeviceId: "d" } }
      : {}),
  };
}

describe("useTimelineItems with a lens in an encrypted conversation", () => {
  it("applies the lens here, on metadata only for encrypted messages, without asking the server", () => {
    pages.items = [
      message("old", "sev1 before encryption", false),
      message("new", "sev1 now", true),
    ];
    useLensStore.getState().setActiveLens("c", "lens-1");
    const encryption = {
      encryptedAt: "2026-10-01T08:00:00Z",
      resets: [],
      userOfPrincipal: () => undefined,
    };
    const { result } = renderHook(() => useTimelineItems("ws", "c", encryption));
    expect(result.current.items.map((m) => m.id)).toEqual(["old"]);
    expect(applyLens).toHaveBeenLastCalledWith("ws", "c", null);
  });
});

describe("useTimelineItems with a channel's removals", () => {
  const items = () => [
    message("a", "first", false, "2026-10-01T09:00:00Z"),
    message("b", "second", false, "2026-10-01T10:00:00Z"),
  ];

  beforeEach(() => useLensStore.getState().setActiveLens("c", null));

  it("puts the line between the messages when every page is loaded", () => {
    pages.items = items();
    const { result } = renderHook(() => useTimelineItems("ws", "c", undefined, [removal]));
    expect(result.current.items.map((m) => m.id)).toEqual(["a", "removal:r1", "b"]);
  });

  it("shows no line under an active lens", () => {
    pages.items = items();
    useLensStore.getState().setActiveLens("c", "lens-1");
    const encryption = {
      encryptedAt: "2026-10-01T08:00:00Z",
      resets: [],
      userOfPrincipal: () => undefined,
    };
    const { result } = renderHook(() => useTimelineItems("ws", "c", encryption, [removal]));
    expect(result.current.items.some((m) => m.membershipNotice)).toBe(false);
    useLensStore.getState().setActiveLens("c", null);
  });
});
