import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useRelayStore } from "../state/useRelayStore";

const api = vi.hoisted(() => ({ fetchDmRequests: vi.fn(), acceptDmRequest: vi.fn() }));
const members = vi.hoisted(() => ({ fetchServerMembers: vi.fn() }));
vi.mock("../api/relayApi", () => api);
vi.mock("../../workspaces/api/useServerMembers", () => members);

import { acceptWorkspaceMembers } from "./autoAccept";

function request(id: string, fromPrincipalId: string) {
  return { id, fromPrincipalId, status: "PENDING" };
}

beforeEach(() => {
  queryClient.clear();
  api.fetchDmRequests.mockReset();
  api.acceptDmRequest.mockReset();
  members.fetchServerMembers.mockReset();
  useRelayStore.getState().reset();
  useRelayStore.getState().setStarted(
    { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
    { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
    [],
  );
  queryClient.setQueryData(queryKeys.myServers(), [{ id: "ws-1" }, { id: "direct-1" }]);
});

describe("acceptWorkspaceMembers", () => {
  it("accepts requests from members of a shared workspace and leaves strangers waiting", async () => {
    api.fetchDmRequests.mockResolvedValue([
      request("r1", "rimp1_colleague"),
      request("r2", "rimp1_stranger"),
    ]);
    members.fetchServerMembers.mockResolvedValue([{ principalId: "rimp1_colleague" }]);
    const accepted = await acceptWorkspaceMembers();
    expect(accepted.map((r) => r.id)).toEqual(["r1"]);
    expect(api.acceptDmRequest).toHaveBeenCalledTimes(1);
    expect(api.acceptDmRequest).toHaveBeenCalledWith("r1");
    // The direct space is not a workspace: its members are not checked.
    expect(members.fetchServerMembers).toHaveBeenCalledWith("ws-1");
    expect(members.fetchServerMembers).not.toHaveBeenCalledWith("direct-1");
  });

  it("does nothing without pending requests", async () => {
    api.fetchDmRequests.mockResolvedValue([]);
    expect(await acceptWorkspaceMembers()).toEqual([]);
    expect(members.fetchServerMembers).not.toHaveBeenCalled();
  });
});
