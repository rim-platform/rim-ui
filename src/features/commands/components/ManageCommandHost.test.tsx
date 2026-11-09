import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deactivate = vi.fn(() => Promise.resolve({}));
const revoke = vi.fn(() => Promise.resolve({}));

vi.mock("../../bots/api/botsApi", () => ({
  useBots: () => ({
    isPending: false,
    error: null,
    data: [{ userId: "bot-1", name: "Deploy bot", runBy: "Ana", deactivatedAt: null }],
  }),
  useDeactivateBot: () => ({ mutateAsync: deactivate, isPending: false }),
  useIncomingWebhooks: () => ({
    isPending: false,
    error: null,
    data: [{ id: "wh-1", conversationId: "c1", botUserId: "bot-1", revokedAt: null }],
  }),
  useRevokeIncomingWebhook: () => ({ mutateAsync: revoke, isPending: false }),
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
    expect(deactivate).toHaveBeenCalledWith("bot-1");
  });

  it("asks before revoking the webhook that was picked", () => {
    renderHost();
    open({ kind: "revoke-webhook" });
    expect(screen.getByText("alerts")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(screen.getByText("Revoke this webhook?")).toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(revoke).toHaveBeenCalledWith("wh-1");
  });

  it("closes a picker without acting when it is cancelled", () => {
    renderHost();
    open({ kind: "bot", action: "deactivate" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useManageCommandStore.getState().request).toBeNull();
    expect(deactivate).not.toHaveBeenCalled();
  });
});
