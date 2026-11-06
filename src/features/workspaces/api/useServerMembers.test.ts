import { afterEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { queryKeys } from "../../../core/query/keys";
import { queryClient } from "../../../core/query/queryClient";
import { fakeServerInfo } from "../../../test/serverInfo";
import { BOT_DISCLOSURE } from "../../updater/api/serverCapabilities";
import { fetchServerMembers } from "./useServerMembers";

describe("fetchServerMembers", () => {
  afterEach(() => {
    queryClient.clear();
    requestMock.mockReset();
  });

  it("asks for isBot and bot only of a server that lists bot_disclosure", async () => {
    requestMock.mockResolvedValue({ serverMembers: [] });

    queryClient.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities: [] }));
    await fetchServerMembers("ws-1");
    expect(String(requestMock.mock.calls[0][0])).not.toContain("isBot");

    queryClient.setQueryData(
      queryKeys.serverInfo,
      fakeServerInfo({}, { capabilities: [BOT_DISCLOSURE] }),
    );
    await fetchServerMembers("ws-1");
    const document = String(requestMock.mock.calls[1][0]);
    expect(document).toContain("isBot");
    expect(document).toContain("readsGoTo");
  });
});
