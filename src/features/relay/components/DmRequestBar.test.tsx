import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";

import { renderWithProviders } from "../../../test/utils";
import { queryKeys } from "../../../core/query/keys";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useToastStore } from "../../../shared/toast";
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
const conversations = vi.hoisted(() => ({ fetchConversation: vi.fn() }));
vi.mock("../../conversations/api/useConversation", () => conversations);
vi.mock("../../e2ee/runtime/session", () => ({ e2eeSession: async () => null }));
const groups = vi.hoisted(() => ({ processWelcomes: vi.fn() }));
vi.mock("../../e2ee/runtime/groups", () => groups);
const cacheSync = vi.hoisted(() => ({ requestCacheSync: vi.fn() }));
vi.mock("../../messages/runtime/messageCacheSync", () => cacheSync);

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
    conversations.fetchConversation,
  ]) {
    fn.mockReset();
  }
  conversations.fetchConversation.mockResolvedValue({ id: "conv-1", conversationType: "DIRECT" });
  useToastStore.setState({ toasts: [] });
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

  it("catches up on what the sender wrote while it waited, once accepted", async () => {
    const user = userEvent.setup();
    cacheSync.requestCacheSync.mockReset();
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    await user.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(cacheSync.requestCacheSync).toHaveBeenCalledWith("home-direct", ["conv-1"]),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.messages("home-direct", "conv-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.cachedTimeline("home-direct", "conv-1"),
    });
    invalidate.mockRestore();
  });

  it("syncs nothing when accepting fails", async () => {
    const user = userEvent.setup();
    cacheSync.requestCacheSync.mockReset();
    api.acceptDmRequest.mockRejectedValue(new Error("offline"));
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    await user.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(api.acceptDmRequest).toHaveBeenCalled());
    expect(cacheSync.requestCacheSync).not.toHaveBeenCalled();
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

  it("asks before blocking, then blocks, leaves a group through the home, closes the view and says so", async () => {
    const user = userEvent.setup();
    conversations.fetchConversation.mockResolvedValue({
      id: "conv-1",
      conversationType: "GROUP",
    });
    membership.leaveConversation.mockResolvedValue(undefined);
    useShellStore.setState({ selectedConversationId: "conv-1" });
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    expect(await screen.findByText("Alice wants to message you.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Block" }));
    const dialog = screen.getByRole("dialog", { name: "Block Alice?" });
    expect(
      within(dialog).getByText(
        "You won't get their requests, and conversations they started stay hidden until you unblock them. They won't be told. You can unblock them in Settings → Direct messages.",
      ),
    ).toBeInTheDocument();
    expect(api.blockPrincipal).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(api.blockPrincipal).toHaveBeenCalledWith(REQUEST.fromPrincipalId));
    expect(conversations.fetchConversation).toHaveBeenCalledWith(
      expect.anything(),
      "home-direct",
      "conv-1",
    );
    expect(membership.leaveConversation).toHaveBeenCalledWith("home-direct", "conv-1");
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
    expect(useToastStore.getState().toasts[0]?.title).toBe("Blocked Alice.");
  });

  it("blocks a DM's sender without leaving the DM", async () => {
    const user = userEvent.setup();
    useShellStore.setState({ selectedConversationId: "conv-1" });
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    expect(await screen.findByText("Alice wants to message you.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Block" }));
    const dialog = screen.getByRole("dialog", { name: "Block Alice?" });
    await user.click(within(dialog).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(api.blockPrincipal).toHaveBeenCalledWith(REQUEST.fromPrincipalId));
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
    expect(membership.leaveConversation).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts[0]?.title).toBe("Blocked Alice.");
  });

  it("blocks and leaves nothing when the conversation cannot be looked up", async () => {
    const user = userEvent.setup();
    conversations.fetchConversation.mockRejectedValue(new Error("unreachable"));
    useShellStore.setState({ selectedConversationId: "conv-1" });
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    expect(await screen.findByText("Alice wants to message you.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Block" }));
    const dialog = screen.getByRole("dialog", { name: "Block Alice?" });
    await user.click(within(dialog).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(api.blockPrincipal).toHaveBeenCalledWith(REQUEST.fromPrincipalId));
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBeNull());
    expect(membership.leaveConversation).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0]?.title).toBe("Blocked Alice.");
    expect(toasts.some((t) => t.variant === "error")).toBe(false);
  });

  it("blocks nothing when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    useShellStore.setState({ selectedConversationId: "conv-1" });
    renderWithProviders(<DmRequestBar request={REQUEST} />);
    expect(await screen.findByText("Alice wants to message you.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Block" }));
    const dialog = screen.getByRole("dialog", { name: "Block Alice?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.blockPrincipal).not.toHaveBeenCalled();
    expect(useShellStore.getState().selectedConversationId).toBe("conv-1");
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
