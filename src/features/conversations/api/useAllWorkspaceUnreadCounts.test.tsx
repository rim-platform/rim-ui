import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { TestProviders } from "../../../test/utils";
import { DIRECT_SPACE_ID, startRelayWithDirectSpace } from "../../../test/directSpace";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useUnreadStore } from "../state/useUnreadStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

vi.mock("../../workspaces/api/useMyServers", () => ({
  useMyServers: () => ({
    data: ["ws-1", "ws-2", "ws-3", DIRECT_SPACE_ID].map((id) => ({ id, name: id, owner: null })),
  }),
}));

import { useAllWorkspaceUnreadCounts } from "./useAllWorkspaceUnreadCounts";

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(async (_document: string, variables: { workspaceId: string }) => ({
    unreadCounts: [{ conversationId: `${variables.workspaceId}-conv`, count: 2 }],
  }));
  useUnreadStore.setState({ counts: {}, spaceOf: {} });
  startRelayWithDirectSpace();
});

afterEach(() => {
  useRelayStore.getState().reset();
});

describe("useAllWorkspaceUnreadCounts", () => {
  it("fetches the counts of the other workspaces only, into their spaces", async () => {
    renderHook(() => useAllWorkspaceUnreadCounts("ws-1"), { wrapper: TestProviders });

    await waitFor(() =>
      expect(useUnreadStore.getState().spaceOf).toEqual({
        "ws-2-conv": "ws-2",
        "ws-3-conv": "ws-3",
      }),
    );
    const fetched = requestMock.mock.calls.map(([, variables]) => variables.workspaceId).sort();
    expect(fetched).toEqual(["ws-2", "ws-3"]);
    expect(useUnreadStore.getState().counts).toEqual({ "ws-2-conv": 2, "ws-3-conv": 2 });
  });
});
