import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/utils";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
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
vi.mock("../../e2ee/runtime/groups", () => ({ processWelcomes: vi.fn() }));

import { makeDmRequest } from "../__fixtures__/dmRequests";
import { DmRequestInbox } from "./DmRequestInbox";

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

describe("DmRequestInbox", () => {
  it("shows the sender's verified name and fingerprint", async () => {
    renderWithProviders(<DmRequestInbox />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(identity.resolveIdentity).toHaveBeenCalledWith(REQUEST.fromPrincipalId, [
      "https://relay-a.example",
    ]);
    expect(crypto.verifyCard).toHaveBeenCalledWith(REQUEST.fromPrincipalId, [], REQUEST.card);
    await waitFor(() =>
      expect(screen.getByLabelText("Fingerprint").textContent).toMatch(/^[A-Z2-7-]{19}$/),
    );
  });

  it("does not show a name the sender's log does not vouch for", async () => {
    crypto.verifyCard.mockRejectedValue(new Error("signature does not verify"));
    renderWithProviders(<DmRequestInbox />);
    expect(await screen.findByText("Unverified sender")).toBeInTheDocument();
    expect(await screen.findByText(/could not be verified/)).toBeInTheDocument();
  });

  it("accepts and ignores", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DmRequestInbox />);
    await user.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(api.acceptDmRequest).toHaveBeenCalledWith("req-1"));
    await user.click(screen.getByRole("button", { name: "Ignore" }));
    await waitFor(() => expect(api.ignoreDmRequest).toHaveBeenCalledWith("req-1"));
  });

  it("asks before blocking, then blocks the sender and leaves a group through its home", async () => {
    const user = userEvent.setup();
    conversations.fetchConversation.mockResolvedValue({
      id: "conv-1",
      conversationType: "GROUP",
    });
    renderWithProviders(<DmRequestInbox />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Block" }));
    const dialog = screen.getByRole("dialog", { name: "Block Alice?" });
    expect(api.blockPrincipal).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(api.blockPrincipal).toHaveBeenCalledWith(REQUEST.fromPrincipalId));
    await waitFor(() =>
      expect(membership.leaveConversation).toHaveBeenCalledWith("home-direct", "conv-1"),
    );
  });

  it("blocks a DM's sender and leaves nothing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DmRequestInbox />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Block" }));
    const dialog = screen.getByRole("dialog", { name: "Block Alice?" });
    await user.click(within(dialog).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(api.blockPrincipal).toHaveBeenCalledWith(REQUEST.fromPrincipalId));
    await waitFor(() => expect(conversations.fetchConversation).toHaveBeenCalled());
    expect(membership.leaveConversation).not.toHaveBeenCalled();
  });

  it("asks before blocking from the context menu", async () => {
    renderWithProviders(<DmRequestInbox />);
    const row = (await screen.findByText("Alice")).closest("li")!;
    fireEvent.contextMenu(row);
    const menu = screen.getByRole("menu", { name: "Message request from Alice" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Block" }));
    expect(screen.getByRole("dialog", { name: "Block Alice?" })).toBeInTheDocument();
    expect(api.blockPrincipal).not.toHaveBeenCalled();
  });

  it("reports a request with a reason", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DmRequestInbox />);
    await user.click(await screen.findByRole("button", { name: "Report" }));
    await user.click(screen.getByRole("button", { name: "Spam" }));
    await waitFor(() => expect(api.reportDmRequest).toHaveBeenCalledWith("req-1", "Spam"));
  });

  it("offers the row's actions in a context menu, with the report reasons in a submenu", async () => {
    renderWithProviders(<DmRequestInbox />);
    const row = (await screen.findByText("Alice")).closest("li")!;
    fireEvent.contextMenu(row);
    const menu = screen.getByRole("menu", { name: "Message request from Alice" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Accept", "Read first", "Ignore", "Report", "Block"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Report" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Report" })).getByRole("menuitem", {
        name: "Harassment",
      }),
    );
    await waitFor(() => expect(api.reportDmRequest).toHaveBeenCalledWith("req-1", "Harassment"));

    fireEvent.keyDown(within(row).getByRole("button", { name: "Accept" }), { key: "ContextMenu" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Accept" }));
    await waitFor(() => expect(api.acceptDmRequest).toHaveBeenCalledWith("req-1"));
  });

  it("opens the conversation to read it before deciding", async () => {
    const user = userEvent.setup();
    useShellStore.getState().setMainSurface({ kind: "dm-requests", workspaceId: null });
    renderWithProviders(<DmRequestInbox />);
    await user.click(await screen.findByRole("button", { name: "Read first" }));
    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("conv-1"));
    expect(useWorkspaceStore.getState().workspaceId).toBe("home-direct");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
    expect(api.acceptDmRequest).not.toHaveBeenCalled();
  });

  it("shows only the requests of the scope it is given", async () => {
    useRelayStore.getState().addSpace({
      account: "a",
      spaceId: "ws-remote",
      hostServerId: "rims1_other",
      kind: "workspace",
    });
    api.fetchDmRequests.mockResolvedValue([
      REQUEST,
      makeDmRequest("r2", "rims1_other", "ws-remote"),
    ]);
    const { unmount } = renderWithProviders(<DmRequestInbox workspaceId="ws-remote" />);
    expect(await screen.findByText("Message requests (1)")).toBeInTheDocument();
    unmount();
    renderWithProviders(<DmRequestInbox workspaceId={null} />);
    expect(await screen.findByText("Message requests (1)")).toBeInTheDocument();
    renderWithProviders(<DmRequestInbox />);
    expect(await screen.findByText("Message requests (2)")).toBeInTheDocument();
  });

  it("shows nothing without pending requests", async () => {
    api.fetchDmRequests.mockResolvedValue([]);
    const { container } = renderWithProviders(<DmRequestInbox />);
    await waitFor(() => expect(api.fetchDmRequests).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
