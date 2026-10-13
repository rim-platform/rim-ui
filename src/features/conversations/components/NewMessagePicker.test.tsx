import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { renderWithProviders } from "../../../test/utils";
import { renderWithLimits } from "../../../test/limits";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

const start = vi.hoisted(() => ({ startDirectConversation: vi.fn() }));
const relayApi = vi.hoisted(() => ({ fetchContacts: vi.fn() }));
const identity = vi.hoisted(() => ({ fetchVerifiedIdentity: vi.fn(), resolveIdentity: vi.fn() }));
vi.mock("../../relay/conversations/startDirect", () => start);
vi.mock("../../relay/api/relayApi", () => relayApi);
vi.mock("../../relay/contacts/identity", () => identity);
vi.mock("./MemberPicker", () => ({
  MemberPicker: ({
    onChange,
    onConfirm,
  }: {
    onChange: (ids: string[]) => void;
    onConfirm: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onChange(["u2"])}>
        pick Bob
      </button>
      <button type="button" onClick={onConfirm}>
        confirm
      </button>
    </div>
  ),
}));

import { NewMessagePicker } from "./NewMessagePicker";

function startRelay() {
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "u1", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
}

beforeEach(() => {
  start.startDirectConversation.mockReset();
  relayApi.fetchContacts.mockReset();
  identity.fetchVerifiedIdentity.mockReset();
  startRelay();
  useShellStore.getState().setSelectedConversationId(null);
});

describe("NewMessagePicker", () => {
  it("starts a DM with a contact in the direct space", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    relayApi.fetchContacts.mockResolvedValue([
      { principalId: "rimp1_bob", relayUrls: ["https://relay-b.example"], addedAt: "" },
    ]);
    identity.fetchVerifiedIdentity.mockResolvedValue({
      identity: {},
      card: { displayName: "Bob", relays: [], version: 1 },
    });
    start.startDirectConversation.mockResolvedValue({ spaceId: "direct-1", conversationId: "c9" });
    const onClose = vi.fn();
    renderWithProviders(<NewMessagePicker open onClose={onClose} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole("option", { name: "Bob" }));
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() =>
      expect(start.startDirectConversation).toHaveBeenCalledWith([
        { principalId: "rimp1_bob", relayUrls: ["https://relay-b.example"], name: "Bob" },
      ]),
    );
    expect(useShellStore.getState().selectedConversationId).toBe("c9");
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves the viewer's own principal out of the contacts offered in the direct space", async () => {
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    relayApi.fetchContacts.mockResolvedValue([
      { principalId: "rimp1_me", relayUrls: [], addedAt: "" },
      { principalId: "rimp1_bob", relayUrls: [], addedAt: "" },
    ]);
    identity.fetchVerifiedIdentity.mockImplementation((principalId: string) =>
      Promise.resolve({
        identity: {},
        card: { displayName: principalId === "rimp1_me" ? "Me" : "Bob", relays: [], version: 1 },
      }),
    );
    renderWithProviders(<NewMessagePicker open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByRole("option", { name: "Bob" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(identity.fetchVerifiedIdentity).not.toHaveBeenCalledWith("rimp1_me", []);
  });

  it("starts a DM with workspace members who have principal ids in the direct space", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    queryClient.setQueryData(queryKeys.serverMembers("ws-1"), [
      { userId: "u2", username: "bob", displayName: "Bob", principalId: "rimp1_bob" },
    ]);
    start.startDirectConversation.mockResolvedValue({ spaceId: "direct-1", conversationId: "c7" });
    renderWithProviders(<NewMessagePicker open onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "pick Bob" }));
    await user.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() =>
      expect(start.startDirectConversation).toHaveBeenCalledWith([
        { principalId: "rimp1_bob", relayUrls: [], name: "Bob" },
      ]),
    );
    expect(useWorkspaceStore.getState().workspaceId).toBe("direct-1");
  });

  it("shows why a conversation with someone elsewhere was not started", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    relayApi.fetchContacts.mockResolvedValue([
      { principalId: "rimp1_bob", relayUrls: [], addedAt: "" },
    ]);
    identity.fetchVerifiedIdentity.mockResolvedValue({
      identity: {},
      card: { displayName: "Bob", relays: [], version: 1 },
    });
    start.startDirectConversation.mockRejectedValue(
      new Error("Bob cannot receive encrypted messages yet"),
    );
    renderWithProviders(<NewMessagePicker open onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole("option", { name: "Bob" }));
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText(/cannot receive encrypted messages/)).toBeInTheDocument();
  });

  it("tells a new account on probation in the direct space when it can message strangers", async () => {
    relayApi.fetchContacts.mockResolvedValue([]);
    const endsAt = new Date(Date.now() + 3_600_000).toISOString();
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    const { unmount } = renderWithLimits(
      <NewMessagePicker open onClose={vi.fn()} onCreated={vi.fn()} />,
      {},
      endsAt,
    );
    expect(screen.getByTestId("new-message-probation")).toHaveTextContent(
      /^New account: you can message strangers after .+\. Until then, message your contacts and people in your workspaces\.$/,
    );
    unmount();

    // Members of a workspace are no strangers, so its picker says nothing.
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    renderWithLimits(<NewMessagePicker open onClose={vi.fn()} onCreated={vi.fn()} />, {}, endsAt);
    expect(screen.queryByTestId("new-message-probation")).not.toBeInTheDocument();
  });
});
