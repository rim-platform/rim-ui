import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { createTestQueryClient } from "../../../test/utils";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useRelayStore } from "../../relay/state/useRelayStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { useChannels, useJoinedChannels } from "./useChannels";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

function channelLists(spaceId: string) {
  return renderHook(() => ({ browse: useChannels(spaceId), joined: useJoinedChannels(spaceId) }), {
    wrapper,
  });
}

describe("channel lists", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({
      channels: { items: [], pageInfo: { hasNext: false, hasPrev: false } },
    });
    startRelayWithDirectSpace();
  });

  afterEach(() => useRelayStore.getState().reset());

  it("asks for no channels in a direct space, and for both lists in a workspace", async () => {
    channelLists(DIRECT_SPACE_ID);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestMock).not.toHaveBeenCalled();

    channelLists("ws-1");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    for (const [, variables] of requestMock.mock.calls) {
      expect(variables).toMatchObject({ serverId: "ws-1" });
    }
  });
});
