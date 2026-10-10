import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import vectors from "../../../../protocol/relay-vectors.json";
import { RevocationFanoutStatus } from "../../../core/graphql/generated/schema-types";
import { useRelayStore } from "../state/useRelayStore";
import { useRevocationStore } from "../remote/useRevocationStore";

const HOST = vectors.host.serverId;
const OTHER = "rims1_T5LLFxkrobgyvlf3WVxuvLlfqYSZAssRFgmvCfI2R-c";
const WORKSPACE = "0199d1a0-0000-7000-8000-000000000002";

const api = vi.hoisted(() => ({
  fetchDeviceRevocationStatus: vi.fn(),
  fetchRemoteSubscriptions: vi.fn(),
}));
vi.mock("../api/relayApi", () => api);
const direct = vi.hoisted(() => ({ applyRevocationDirectly: vi.fn() }));
vi.mock("../direct/directCalls", () => direct);
vi.mock("../state/serverPins", () => ({
  hostKeyAt: async (host: string) =>
    host === HOST ? vectors.host.serverKey : vectors.relay.serverKey,
}));
const db = vi.hoisted(() => ({ stored: [] as unknown[] }));
vi.mock("../state/relayDb", () => ({
  allRecords: async () => db.stored,
  putRecord: async () => undefined,
  deleteRecord: async () => undefined,
}));

import type { FollowedRevocation } from "../remote/useRevocationStore";
import { RevocationFanoutPanel } from "./RevocationFanoutPanel";

function follow(entry: FollowedRevocation) {
  db.stored = [
    {
      account: "https://relay.example/api|rimp1_me",
      name: `revocation:${entry.deviceId}`,
      ...entry,
    },
  ];
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RevocationFanoutPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useRelayStore.getState().reset();
  useRelayStore.getState().setStarted(
    { serverId: "rims1_relay", roles: ["relay"], directSpaceId: "direct-1" },
    {
      endpoint: "https://relay.example/api",
      userId: "u1",
      principalId: "rimp1_me",
      deviceId: "d1",
    },
    [{ account: "a", spaceId: WORKSPACE, hostServerId: OTHER, kind: "workspace", name: "Ops" }],
  );
  useRelayStore.getState().setOrigin(HOST, "https://host.example");
  useRelayStore.getState().setOrigin(OTHER, "https://other.example");
  api.fetchRemoteSubscriptions.mockResolvedValue([
    {
      hostServerId: OTHER,
      workspaceId: WORKSPACE,
      status: "active",
      expiresAt: "2026-10-09T18:00:00Z",
    },
  ]);
  api.fetchDeviceRevocationStatus.mockResolvedValue([
    {
      hostServerId: HOST,
      status: RevocationFanoutStatus.ACKED,
      ack: vectors.revocationAck,
      attempts: 1,
    },
    { hostServerId: OTHER, status: RevocationFanoutStatus.PENDING, ack: null, attempts: 4 },
  ]);
  useRevocationStore.setState({ followed: [] });
  db.stored = [];
});

describe("RevocationFanoutPanel", () => {
  it("shows confirmed and waiting hosts while the relay fans out", async () => {
    follow({
      deviceId: vectors.device.deviceId,
      revocation: vectors.revocation,
      revokedAt: Date.now(),
      direct: null,
    });
    renderPanel();
    expect(await screen.findByText("https://host.example confirmed.")).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/other\.example: waiting/)).toBeInTheDocument();
    expect(direct.applyRevocationDirectly).not.toHaveBeenCalled();
  });

  it("two minutes in, sends it directly and names a host it could not reach", async () => {
    direct.applyRevocationDirectly.mockRejectedValue(new Error("unreachable"));
    follow({
      deviceId: vectors.device.deviceId,
      revocation: vectors.revocation,
      revokedAt: Date.UTC(2026, 9, 9, 12),
      direct: null,
    });
    renderPanel();
    await waitFor(() =>
      expect(direct.applyRevocationDirectly).toHaveBeenCalledWith(OTHER, vectors.revocation),
    );
    expect(direct.applyRevocationDirectly).toHaveBeenCalledTimes(1);
    const until = new Date(Date.UTC(2026, 9, 9, 18)).toLocaleString();
    expect(
      await screen.findByText(
        `https://other.example has not confirmed; the device keeps access to Ops until ${until} (unreachable)`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("https://host.example confirmed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("confirms a host that acknowledges the direct revocation", async () => {
    direct.applyRevocationDirectly.mockResolvedValue(vectors.revocationAck);
    api.fetchDeviceRevocationStatus.mockResolvedValue([
      { hostServerId: HOST, status: RevocationFanoutStatus.PENDING, ack: null, attempts: 4 },
    ]);
    follow({
      deviceId: vectors.device.deviceId,
      revocation: vectors.revocation,
      revokedAt: 0,
      direct: null,
    });
    renderPanel();
    expect(
      await screen.findByText("https://host.example confirmed (sent directly)."),
    ).toBeInTheDocument();
  });
});
