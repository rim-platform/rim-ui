import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { applyWorkspaceEvent } from "../../../core/events/useWorkspaceEvents";
import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "../../../core/types/messages";
import type { SentMessage } from "./timelineMessages";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { useConversationMessages, useSendMessageMutation } from "./useMessages";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const oldestCursor = { sentAt: "2026-10-04T10:00:00Z", id: "m5" };

function page(hasNext: boolean) {
  return {
    messages: {
      items: [],
      next: hasNext ? oldestCursor : null,
      prev: null,
      pageInfo: { hasNext, hasPrev: false },
    },
  };
}

describe("useConversationMessages", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("opens with no cursor and loads older history with AFTER + next", async () => {
    // `messages` is a DESC endpoint: AFTER is "older". BEFORE walks toward newer messages
    // and returns an empty page after the first one, which dead-ends scroll-up.
    requestMock.mockResolvedValueOnce(page(true)).mockResolvedValueOnce(page(false));

    const { result } = renderHook(() => useConversationMessages("ws-1", "conv-1"), {
      wrapper,
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0][1]).toEqual({
      serverId: "ws-1",
      conversationId: "conv-1",
      dir: "AFTER",
      limit: 50,
      includeDeleted: false,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][1]).toMatchObject({
      dir: "AFTER",
      cursor: oldestCursor,
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  });
});

describe("useSendMessageMutation", () => {
  const key = queryKeys.messages("ws-1", "conv-1");
  const sent: SentMessage = {
    id: "m-1",
    serverId: "ws-1",
    conversationId: "conv-1",
    threadId: null,
    rootThreadId: null,
    authorId: "u-me",
    author: { id: "u-me", username: "me", displayName: null, avatarUrl: null },
    text: "hello",
    hasAttachments: false,
    parentMessageId: null,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    sentAt: "2026-10-11T10:00:00Z",
    attachments: [],
    linkPreviews: [],
    encryption: null,
  };

  /** A loaded, empty timeline of conv-1 and the event the server pushes for `message`. */
  function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData<InfiniteData<MessagesPage>>(key, {
      pages: [{ items: [], next: null, prev: null, pageInfo: { hasNext: false, hasPrev: false } }],
      pageParams: [null],
    });
    const newMessage = (message: SentMessage) =>
      applyWorkspaceEvent(
        {
          type: "NewMessage",
          workspace_id: "ws-1",
          conversation_id: message.conversationId,
          message: {
            id: message.id,
            server_id: "ws-1",
            conversation_id: message.conversationId,
            thread_id: message.threadId ?? null,
            root_thread_id: message.rootThreadId ?? null,
            author_id: message.authorId,
            text: message.text,
            has_attachments: false,
            parent_message_id: null,
            forwarded_from_message_id: null,
            is_deleted: false,
            sent_at: message.sentAt,
            reactions: [],
          },
        },
        qc,
        "ws-1",
      );
    const timeline = () => qc.getQueryData<InfiniteData<MessagesPage>>(key);
    const ids = () => timeline()?.pages.flatMap((p) => p.items.map((m) => m.id));
    return { qc, newMessage, timeline, ids };
  }

  beforeEach(() => {
    requestMock.mockReset();
  });

  it("puts the sent message into the timeline once; its NewMessage afterwards changes nothing", async () => {
    const { qc, newMessage, timeline, ids } = setup();
    requestMock.mockResolvedValue({ sendMessage: sent });
    const { result } = renderHook(() => useSendMessageMutation(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    await act(() =>
      result.current.mutateAsync({ workspaceId: "ws-1", conversationId: "conv-1", text: "hello" }),
    );
    expect(ids()).toEqual(["m-1"]);
    expect(timeline()?.pages[0].items[0].author?.username).toBe("me");

    const before = timeline();
    newMessage(sent);
    // The same object: nothing re-renders, the timeline does not jump.
    expect(timeline()).toBe(before);
  });

  it("refetches a thread reply's thread instead of appending it to the timeline", () => {
    const { qc, newMessage, ids } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    newMessage({ ...sent, threadId: "t-1" });

    expect(ids()).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.threadMessages("ws-1", "conv-1", "t-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["threadByRoot", "ws-1", "conv-1"] });
  });
});
