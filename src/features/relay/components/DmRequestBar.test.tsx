import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useRelayStore } from "../state/useRelayStore";

const api = vi.hoisted(() => ({
  fetchDmRequests: vi.fn(),
  acceptDmRequest: vi.fn(),
  ignoreDmRequest: vi.fn(),
  blockPrincipal: vi.fn(),
  reportDmRequest: vi.fn(),
}));
const identity = vi.hoisted(() => ({ resolveIdentity: vi.fn() }));
const crypto = vi.hoisted(() => ({ verifyCard: vi.fn() }));
const processor = vi.hoisted(() => ({ verifyHeld: vi.fn() }));
const membership = vi.hoisted(() => ({ leaveConversation: vi.fn() }));
vi.mock("../api/relayApi", () => api);
vi.mock("../contacts/identity", () => identity);
vi.mock("../crypto/relayCrypto", () => ({ relayCrypto: () => crypto }));
vi.mock("../runtime/relayRuntime", () => ({ relayProcessor: () => processor }));
vi.mock("../../conversations/api/useChannelMembership", () => membership);
vi.mock("../../e2ee/runtime/session", () => ({ e2eeSession: async () => null }));
vi.mock("../../e2ee/runtime/groups", () => ({ processWelcomes: vi.fn() }));

import { DmRequestBar } from "./DmRequestBar";

const REQUEST = {
  id: "req-1",
  fromPrincipalId: "rimp1_txDLbnipi5i3kCJtJwBOUixzv_MY8OnU0mcy--Tyje0",
  card: { payload: JSON.stringify({ relays: ["https://relay-a.example"] }), signature: "s" },
  hostServerId: "rims1_home",
  conversationId: "conv-1",
  heldItems: [{ id: "9", hostServerId: "rims1_home", workspaceId: "home-direct", envelope: {} }],
  status: "PENDING",
  createdAt: "",
  expiresAt: "",
};

beforeEach(() => {
  for (const fn of [
    ...Object.values(api),
    identity.resolveIdentity,
    crypto.verifyCard,
    processor.verifyHeld,
    membership.leaveConversation,
  ]) {
    fn.mockReset();
  }
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
  api.fetchDmRequests.mockResolvedValue([REQUEST]);
  identity.resolveIdentity.mockResolvedValue({ identity: { keyLog: [] }, card: null });
  crypto.verifyCard.mockResolvedValue({ displayName: "Alice", relays: [], version: 1 });
  processor.verifyHeld.mockResolvedValue({
    event: { type: "DmInvite", conversation_id: "conv-1" },
  });
});

describe("DmRequestBar", () => {
  it("says who wants to message and that nothing reaches them before accepting", async () => {
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    expect(await screen.findByText("Alice wants to message you.")).toBeInTheDocument();
    expect(screen.getByText(/they see nothing from you/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read first" })).not.toBeInTheDocument();
  });

  it("accepts and keeps the conversation open", async () => {
    const user = userEvent.setup();
    useShellStore.setState({ selectedConversationId: "conv-1" });
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    await user.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(api.acceptDmRequest).toHaveBeenCalledWith("req-1"));
    expect(useShellStore.getState().selectedConversationId).toBe("conv-1");
  });

  it("ignores and leaves the conversation's view", async () => {
    const user = userEvent.setup();
    useShellStore.setState({ selectedConversationId: "conv-1" });
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    await user.click(await screen.findByRole("button", { name: "Ignore" }));
    await waitFor(() => expect(api.ignoreDmRequest).toHaveBeenCalledWith("req-1"));
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
  });

  it("blocks the sender, leaves through the home and closes the view", async () => {
    const user = userEvent.setup();
    membership.leaveConversation.mockResolvedValue(undefined);
    useShellStore.setState({ selectedConversationId: "conv-1" });
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    await user.click(await screen.findByRole("button", { name: "Block" }));
    await waitFor(() => expect(api.blockPrincipal).toHaveBeenCalledWith(REQUEST.fromPrincipalId));
    expect(membership.leaveConversation).toHaveBeenCalledWith("home-direct", "conv-1");
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
  });

  it("keeps the view when a decision fails", async () => {
    const user = userEvent.setup();
    api.ignoreDmRequest.mockRejectedValue(new Error("offline"));
    useShellStore.setState({ selectedConversationId: "conv-1" });
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    await user.click(await screen.findByRole("button", { name: "Ignore" }));
    await waitFor(() => expect(api.ignoreDmRequest).toHaveBeenCalled());
    expect(useShellStore.getState().selectedConversationId).toBe("conv-1");
  });

  it("reports with a reason", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    await user.click(await screen.findByRole("button", { name: "Report" }));
    await user.click(screen.getByRole("button", { name: "Spam" }));
    await waitFor(() => expect(api.reportDmRequest).toHaveBeenCalledWith("req-1", "Spam"));
  });
});
