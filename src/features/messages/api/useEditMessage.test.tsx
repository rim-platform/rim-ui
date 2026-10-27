import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import type { ReactNode } from "react";

const request = vi.hoisted(() => vi.fn());
const editEncrypted = vi.hoisted(() => vi.fn());

/** Every request stays pending unless a test answers it, so only the optimistic patch is cached. */
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request },
}));
vi.mock("../../e2ee/runtime/send", () => ({ editEncrypted }));
vi.mock("../../e2ee/runtime/pins", () => ({
  refusePlaintextIfPinned: () => Promise.resolve(),
}));

import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "../../../core/types/messages";
import { fakeServerInfo } from "../../../test/serverInfo";
import type { ThreadMessagesPage } from "../../threads/api/useThreads";
import { useEditMessageMutation } from "./useEditMessage";

const key = queryKeys.messages("ws-1", "c-1");
const threadKey = queryKeys.threadMessages("ws-1", "c-1", "t-1");

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(() => new Promise(() => {}));
  editEncrypted.mockReset();
});

/** A reply of thread t-1 as its query caches it. */
function threadReply(extra: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    serverId: "ws-1",
    conversationId: "c-1",
    threadId: "t-1",
    authorId: "u-1",
    author: null,
    text: "first",
    isDeleted: false,
    sentAt: "2026-10-27T10:00:00Z",
    editedAt: null,
    reactions: [],
    ...extra,
  };
}

/** A client holding the thread t-1 with one reply. */
function clientWithThread(reply = threadReply()): QueryClient {
  const qc = clientWith(["message_edited_at"]);
  qc.setQueryData(threadKey, {
    items: [reply],
    pageInfo: { hasNext: false, hasPrev: false },
  } as unknown as ThreadMessagesPage);
  return qc;
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** A client holding c-1's timeline with one never-edited message, m-1, and `capabilities`. */
function clientWith(capabilities: string[] | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities }));
  qc.setQueryData<InfiniteData<MessagesPage>>(key, {
    pages: [
      {
        items: [
          {
            id: "m-1",
            serverId: "ws-1",
            conversationId: "c-1",
            authorId: "u-1",
            author: null,
            text: "hi",
            hasAttachments: false,
            isPinned: false,
            mentionedUserIds: [],
            forwardedFromMessageId: null,
            forwardedFrom: null,
            isDeleted: false,
            sentAt: "2026-10-27T10:00:00Z",
            editedAt: null,
            reactions: [],
            attachments: [],
            linkPreviews: [],
          },
        ],
        next: null,
        prev: null,
        pageInfo: { hasNext: false, hasPrev: false },
      },
    ],
    pageParams: [null],
  });
  return qc;
}

/** The cached m-1 once the edit to "hi again" has started. */
async function editedItem(qc: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useEditMessageMutation(), { wrapper });
  await act(async () => {
    result.current.mutate({
      serverId: "ws-1",
      conversationId: "c-1",
      messageId: "m-1",
      text: "hi again",
    });
  });
  return qc.getQueryData<InfiniteData<MessagesPage>>(key)?.pages[0].items[0];
}

describe("useEditMessageMutation", () => {
  it("marks the optimistic edit only when the server reports edit times", async () => {
    const withEditTimes = await editedItem(clientWith(["message_edited_at"]));
    expect(withEditTimes?.text).toBe("hi again");
    expect(withEditTimes?.editedAt).toEqual(expect.any(String));

    const older = await editedItem(clientWith(undefined));
    expect(older?.text).toBe("hi again");
    expect(older?.editedAt).toBeNull();
  });

  it("updates a thread reply in its thread's cache and rolls it back when the edit fails", async () => {
    const qc = clientWithThread();
    const { result } = renderHook(() => useEditMessageMutation(), { wrapper: wrapperFor(qc) });
    let fail: (reason: Error) => void = () => {};
    request.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    await act(async () => {
      result.current.mutate({
        serverId: "ws-1",
        conversationId: "c-1",
        messageId: "r-1",
        text: "second",
        threadId: "t-1",
      });
    });
    const during = qc.getQueryData<ThreadMessagesPage>(threadKey)?.items[0];
    expect(during?.text).toBe("second");
    expect(during?.editedAt).toEqual(expect.any(String));
    await act(async () => {
      fail(new Error("refused"));
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<ThreadMessagesPage>(threadKey)?.items[0].text).toBe("first");
  });

  it("edits an encrypted thread reply through the encrypted path", async () => {
    const qc = clientWithThread(
      threadReply({ e2ee: { status: "decrypted" } }) as ReturnType<typeof threadReply>,
    );
    editEncrypted.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEditMessageMutation(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      result.current.mutate({
        serverId: "ws-1",
        conversationId: "c-1",
        messageId: "r-1",
        text: "second",
        threadId: "t-1",
      });
    });
    await waitFor(() => expect(editEncrypted).toHaveBeenCalledTimes(1));
    expect(request).not.toHaveBeenCalled();
  });

  describe("refetching after an edit", () => {
    const messagesKey = queryKeys.messages("ws-1", "c-1");

    /** Runs an edit of r-1 in thread t-1 and returns the keys invalidated once it settled. */
    async function settle(qc: QueryClient, outcome: "saved" | "failed") {
      const invalidated: unknown[] = [];
      const spy = vi.spyOn(qc, "invalidateQueries").mockImplementation(((filters: {
        queryKey?: unknown;
      }) => {
        invalidated.push(filters?.queryKey);
        return Promise.resolve();
      }) as never);
      request.mockImplementation(() =>
        outcome === "saved"
          ? Promise.resolve({ editMessage: { id: "r-1", text: "second" } })
          : Promise.reject(new Error("refused")),
      );
      const { result } = renderHook(() => useEditMessageMutation(), { wrapper: wrapperFor(qc) });
      await act(async () => {
        result.current.mutate({
          serverId: "ws-1",
          conversationId: "c-1",
          messageId: "r-1",
          text: "second",
          threadId: "t-1",
        });
      });
      await waitFor(() => expect(result.current.isIdle).toBe(false));
      await waitFor(() => expect(result.current.isPending).toBe(false));
      spy.mockRestore();
      return invalidated;
    }

    it("leaves the refetch of a saved plaintext edit to the server's event", async () => {
      expect(await settle(clientWithThread(), "saved")).toEqual([]);
    });

    it("refetches the timeline and the thread after a failed edit", async () => {
      expect(await settle(clientWithThread(), "failed")).toEqual([messagesKey, threadKey]);
    });

    it("refetches after an encrypted edit", async () => {
      editEncrypted.mockResolvedValue(undefined);
      const qc = clientWithThread(
        threadReply({ e2ee: { status: "decrypted" } }) as ReturnType<typeof threadReply>,
      );
      expect(await settle(qc, "saved")).toEqual([messagesKey, threadKey]);
    });
  });
});
