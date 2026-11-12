import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { graphqlError } from "../__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import { updateConversationTopic } from "./useUpdateTopic";

const VARS = { serverId: "ws-1", conversationId: "conv-1", topic: "News" };

describe("updateConversationTopic", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("sets the topic and reads the workspace's conversation lists again", async () => {
    requestMock.mockResolvedValue({ updateConversationTopic: { id: "conv-1", topic: "News" } });
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.channels("ws-1"), { items: [] });

    await updateConversationTopic(qc, VARS);

    expect(requestMock.mock.calls[0][1]).toEqual({ input: VARS });
    expect(qc.getQueryState(queryKeys.channels("ws-1"))?.isInvalidated).toBe(true);
  });

  it("passes the server's refusal on for the caller to show", async () => {
    const refusal = graphqlError(
      "FORBIDDEN",
      "only the owner and moderators change a channel's topic",
    );
    requestMock.mockRejectedValue(refusal);

    await expect(updateConversationTopic(new QueryClient(), VARS)).rejects.toBe(refusal);
  });
});
