import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deactivate = vi.fn(() => Promise.resolve(true));
const revoke = vi.fn(() => Promise.resolve(true));

vi.mock("../../bots/api/botsApi", () => ({
  useBots: () => ({
    isPending: false,
    error: null,
    data: [{ userId: "bot-1", name: "Deploy bot", runBy: "Ana", deactivatedAt: null }],
  }),
  deactivateBot: (_qc: unknown, serverId: string, botUserId: string) =>
    deactivate(serverId, botUserId),
  useIncomingWebhooks: () => ({
    isPending: false,
    error: null,
    data: [{ id: "wh-1", conversationId: "c1", botUserId: "bot-1", revokedAt: null }],
  }),
  revokeIncomingWebhook: (_qc: unknown, serverId: string, id: string) => revoke(serverId, id),
}));
const decide = vi.fn(() => Promise.resolve(true));
const unblock = vi.fn(() => Promise.resolve(true));
vi.mock("../../workspaces/api/publicJoinLink", () => ({
  useJoinRequests: () => ({
    isPending: false,
    error: null,
    data: { pages: [{ items: [{ id: "jr-1", userId: "u-1", user: null, message: null }] }] },
  }),
  decideJoinRequest: (_qc: unknown, decision: unknown) => decide(decision),
}));
vi.mock("../../relay/api/useBlockedPrincipals", () => ({
  useBlockedPrincipals: () => ({
    isPending: false,
    error: null,
    data: [{ principalId: "rimp1_x", blockedAt: "2026-11-01T00:00:00Z" }],
  }),
  unblockPerson: (_qc: unknown, target: unknown) => unblock(target),
}));
vi.mock("../../bots/api/useAllChannels", () => ({
  useAllChannels: () => ({ data: { items: [{ id: "c1", title: "alerts" }] } }),
}));
vi.mock("../../instance-moderation/api/instanceModeration", () => ({
  useIsInstanceOperator: () => ({ isOperator: false }),
}));

import { useManageCommandStore } from "../state/useManageCommandStore";
import { ManageCommandHost } from "./ManageCommandHost";

function renderHost() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ManageCommandHost />
    </QueryClientProvider>,
  );
}

function open(request: Parameters<ReturnType<typeof useManageCommandStore.getState>["open"]>[0]) {
  act(() => useManageCommandStore.setState({ request, workspaceId: "ws-1" }));
}

beforeEach(() => {
  deactivate.mockClear();
  revoke.mockClear();
  decide.mockClear();
  unblock.mockClear();
  useManageCommandStore.setState({ request: null, workspaceId: null });
});

describe("ManageCommandHost", () => {
  it("asks before deactivating the bot that was picked", () => {
    renderHost();
    open({ kind: "bot", action: "deactivate" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(screen.getByText("Deactivate Deploy bot?")).toBeInTheDocument();
    expect(deactivate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(deactivate).toHaveBeenCalledWith("ws-1", "bot-1");
  });

  it("asks before revoking the webhook that was picked", () => {
    renderHost();
    open({ kind: "revoke-webhook" });
    expect(screen.getByText("alerts")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(screen.getByText("Revoke this webhook?")).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(revoke).toHaveBeenCalledWith("ws-1", "wh-1");
  });

  it("answers the join request picked as Settings does", () => {
    renderHost();
    open({ kind: "join-request", accept: true });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(decide).toHaveBeenCalledWith({
      serverId: "ws-1",
      requestId: "jr-1",
      name: "A deleted account",
      accept: true,
    });
    expect(useManageCommandStore.getState().request).toBeNull();
  });

  it("unblocks the person picked as Settings does", () => {
    renderHost();
    open({ kind: "unblock-person" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(unblock).toHaveBeenCalledWith({ principalId: "rimp1_x", name: expect.any(String) });
  });

  it("closes a picker without acting when it is cancelled", () => {
    renderHost();
    open({ kind: "bot", action: "deactivate" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useManageCommandStore.getState().request).toBeNull();
    expect(deactivate).not.toHaveBeenCalled();
  });
});
