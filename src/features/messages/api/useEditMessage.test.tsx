import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import type { ReactNode } from "react";

/** Every request stays pending, so only the optimistic patch is in the cache. */
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: () => new Promise(() => {}) },
}));
vi.mock("../../e2ee/runtime/pins", () => ({
  refusePlaintextIfPinned: () => Promise.resolve(),
}));

import { queryKeys } from "../../../core/query/keys";
import type { MessagesPage } from "../../../core/types/messages";
import { fakeServerInfo } from "../../../test/serverInfo";
import { useEditMessageMutation } from "./useEditMessage";

const key = queryKeys.messages("ws-1", "c-1");

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
});
