import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

import { PresenceStatus } from "../../../core/graphql/generated/schema-types";
import { usePresenceStore } from "../state/usePresenceStore";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { useHeartbeat } from "./useHeartbeat";

describe("useHeartbeat", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ heartbeat: true });
    usePresenceStore.setState({ presenceMap: {}, selfId: null });
  });

  it("marks the viewer online in the presence store when it sends a heartbeat", () => {
    renderHook(() => useHeartbeat("ws-1", "u-me"));

    expect(requestMock).toHaveBeenCalledWith(expect.anything(), {
      input: { workspaceId: "ws-1", status: PresenceStatus.ONLINE },
    });
    expect(usePresenceStore.getState().presenceMap["u-me"]).toBe(PresenceStatus.ONLINE);
  });
});
