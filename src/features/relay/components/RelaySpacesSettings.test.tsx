import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import type { SpaceRecord } from "../state/relayDb";
import { useRelayStore } from "../state/useRelayStore";

const api = vi.hoisted(() => ({ fetchRemoteSubscriptions: vi.fn() }));
const remote = vi.hoisted(() => ({
  delegationRecords: vi.fn(),
  renewWorkspaceDelegations: vi.fn(),
}));
vi.mock("../api/relayApi", () => api);
vi.mock("../remote/remoteWorkspaces", () => remote);

import { RelaySpacesSettings } from "./RelaySpacesSettings";

const HOST = "rims1_host";

function startRelay(spaces: SpaceRecord[] = []) {
  useRelayStore.getState().setStarted(
    { serverId: "rims1_relay", roles: ["relay"], directSpaceId: "direct-1" },
    {
      endpoint: "http://localhost:8080/api",
      userId: "u1",
      principalId: "rimp1_me",
      deviceId: "d1",
    },
    spaces,
  );
}

beforeEach(() => {
  useRelayStore.getState().reset();
  api.fetchRemoteSubscriptions.mockReset();
  remote.delegationRecords.mockReset().mockResolvedValue([]);
  remote.renewWorkspaceDelegations.mockReset();
});

describe("RelaySpacesSettings", () => {
  it("shows why the host refused a space's last renewal", async () => {
    const user = userEvent.setup();
    startRelay([
      { account: "a", spaceId: "ws-ops", hostServerId: HOST, kind: "workspace" },
      { account: "a", spaceId: "ws-dev", hostServerId: HOST, kind: "workspace" },
    ]);
    api.fetchRemoteSubscriptions.mockResolvedValue([
      { hostServerId: HOST, workspaceId: "ws-ops", status: "ended", expiresAt: null, reason: null },
      {
        hostServerId: HOST,
        workspaceId: "ws-dev",
        status: "active",
        expiresAt: "2026-10-11T12:00:00Z",
        reason: null,
      },
    ]);
    remote.renewWorkspaceDelegations.mockImplementation(async () => {
      const renewed = [
        {
          hostServerId: HOST,
          workspaceId: "ws-ops",
          status: "refused",
          expiresAt: null,
          reason: "not_member",
        },
        { hostServerId: HOST, workspaceId: "ws-dev", status: "active", expiresAt: null },
      ];
      useRelayStore.getState().noteRenewals(renewed);
      return { renewed, lapsed: [] };
    });
    renderWithProviders(<RelaySpacesSettings />);
    expect(await screen.findByText(/Not active: ended/)).toBeInTheDocument();
    expect(screen.queryByText(/last renewal was refused/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Renew now" }));
    expect(
      await screen.findByText(
        "The last renewal was refused: this account is no longer a member there.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/last renewal was refused/)).toHaveLength(1);
  });

  it("leaves out an ended subscription of a workspace the app no longer has", async () => {
    startRelay([{ account: "a", spaceId: "ws-dev", hostServerId: HOST, kind: "workspace" }]);
    api.fetchRemoteSubscriptions.mockResolvedValue([
      {
        hostServerId: HOST,
        workspaceId: "ws-left",
        status: "ended",
        expiresAt: null,
        reason: null,
      },
      {
        hostServerId: HOST,
        workspaceId: "ws-dev",
        status: "active",
        expiresAt: "2026-10-11T12:00:00Z",
        reason: null,
      },
    ]);
    renderWithProviders(<RelaySpacesSettings />);
    expect(await screen.findByText(/^Active/)).toBeInTheDocument();
    expect(screen.queryByText(/ws-left/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("forgets a refusal once a renewal succeeds", () => {
    const { noteRenewals } = useRelayStore.getState();
    noteRenewals([{ workspaceId: "w", status: "refused", reason: "banned" }]);
    expect(useRelayStore.getState().refusals).toEqual({ w: "banned" });
    noteRenewals([{ workspaceId: "w", status: "active", reason: null }]);
    expect(useRelayStore.getState().refusals).toEqual({});
  });
});
