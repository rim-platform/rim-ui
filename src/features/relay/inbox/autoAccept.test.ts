import { beforeEach, describe, expect, it, vi } from "vitest";

import { DmMembers, ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { useRelayStore } from "../state/useRelayStore";

const api = vi.hoisted(() => ({ fetchDmRequests: vi.fn(), acceptDmRequest: vi.fn() }));
const members = vi.hoisted(() => ({ fetchServerMembers: vi.fn() }));
const dmPolicy = vi.hoisted(() => ({ fetchMyDmSettings: vi.fn() }));
vi.mock("../api/relayApi", () => api);
vi.mock("../../workspaces/api/useServerMembers", () => members);
vi.mock("../../dm-policy/api/dmPolicy", () => dmPolicy);

import { acceptWorkspaceMembers } from "./autoAccept";

function request(id: string, fromPrincipalId: string) {
  return { id, fromPrincipalId, status: "PENDING" };
}

/** The person's choice for each workspace, as `myDmSettings` answers it. */
function choose(choices: Record<string, DmMembers>) {
  dmPolicy.fetchMyDmSettings.mockResolvedValue({
    workspaces: Object.entries(choices).map(([workspaceId, choice]) => ({
      workspaceId,
      members: choice,
      memberDefault: DmMembers.DIRECT,
    })),
  });
}

beforeEach(() => {
  queryClient.clear();
  api.fetchDmRequests.mockReset();
  api.acceptDmRequest.mockReset();
  members.fetchServerMembers.mockReset();
  dmPolicy.fetchMyDmSettings.mockReset();
  choose({});
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
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

  it("leaves a member's request waiting where the person chose requests, unless they moderate it", async () => {
    choose({ "ws-1": DmMembers.REQUESTS });
    api.fetchDmRequests.mockResolvedValue([
      request("r1", "rimp1_colleague"),
      request("r2", "rimp1_moderator"),
      request("r3", "rimp1_owner"),
    ]);
    members.fetchServerMembers.mockResolvedValue([
      { principalId: "rimp1_colleague", memberRole: ServerMemberRoleGql.MEMBER },
      { principalId: "rimp1_moderator", memberRole: ServerMemberRoleGql.MODERATOR },
      { principalId: "rimp1_owner", memberRole: ServerMemberRoleGql.OWNER },
    ]);
    const accepted = await acceptWorkspaceMembers();
    expect(accepted.map((r) => r.id)).toEqual(["r2", "r3"]);
  });

  it("accepts a member through any shared workspace set to direct", async () => {
    queryClient.setQueryData(queryKeys.myServers(), [{ id: "ws-1" }, { id: "ws-2" }]);
    choose({ "ws-1": DmMembers.REQUESTS, "ws-2": DmMembers.DIRECT });
    api.fetchDmRequests.mockResolvedValue([request("r1", "rimp1_colleague")]);
    members.fetchServerMembers.mockResolvedValue([
      { principalId: "rimp1_colleague", memberRole: ServerMemberRoleGql.MEMBER },
    ]);
    expect((await acceptWorkspaceMembers()).map((r) => r.id)).toEqual(["r1"]);
  });

  it("does nothing without pending requests", async () => {
    api.fetchDmRequests.mockResolvedValue([]);
    expect(await acceptWorkspaceMembers()).toEqual([]);
    expect(members.fetchServerMembers).not.toHaveBeenCalled();
  });
});
