import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { ConversationTypeEnum, PostingPolicy } from "../../../core/graphql/generated/schema-types";
import { graphqlError, makeConversation } from "../__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { useChannelPosting } from "./useChannelPosting";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe("useChannelPosting", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("reads a channel's posting policy", async () => {
    requestMock.mockResolvedValue({
      conversation: {
        id: "conv-1",
        postingPolicy: PostingPolicy.MODERATORS,
        postingAllowsThreads: false,
      },
    });
    const { result } = renderHook(() => useChannelPosting("ws-1", makeConversation()), {
      wrapper,
    });
    await waitFor(() => expect(result.current.supported).toBe(true));
    expect(result.current).toMatchObject({
      policy: PostingPolicy.MODERATORS,
      allowsThreads: false,
    });
    expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("query ChannelPosting("), {
      serverId: "ws-1",
      conversationId: "conv-1",
    });
  });

  it("falls back to everyone posting, once, when the server refuses the query", async () => {
    requestMock.mockRejectedValue(
      graphqlError("GRAPHQL_VALIDATION_FAILED", 'Unknown field "postingPolicy"'),
    );
    const { result } = renderHook(() => useChannelPosting("ws-1", makeConversation()), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toEqual({
      policy: PostingPolicy.EVERYONE,
      allowsThreads: true,
      supported: false,
      isLoading: false,
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("asks nothing for a group", async () => {
    const group = makeConversation({ conversationType: ConversationTypeEnum.GROUP });
    const { result } = renderHook(() => useChannelPosting("ws-1", group), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestMock).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ policy: PostingPolicy.EVERYONE, supported: false });
  });
});
