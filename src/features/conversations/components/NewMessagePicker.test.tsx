import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { renderWithProviders } from "../../../test/utils";
import { renderWithLimits } from "../../../test/limits";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import {
  callsTo,
  emptyInbox,
  makeConversation,
  routeRequests,
} from "../__fixtures__/conversations";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
const session = vi.hoisted(() => ({ e2eeSession: vi.fn() }));
const groups = vi.hoisted(() => ({ allMembersReady: vi.fn(), createGroup: vi.fn() }));
vi.mock("../../e2ee/runtime/session", () => session);
vi.mock("../../e2ee/runtime/groups", () => groups);
vi.mock("../../e2ee/web/webAccount", () => ({ isWebAccount: () => false }));

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
      <button type="button" onClick={() => onChange(["u2", "u3"])}>
        pick Bob and Carol
      </button>
      <button type="button" onClick={onConfirm}>
        confirm
      </button>
    </div>
  ),
}));

import { NewMessagePicker } from "./NewMessagePicker";

const bob = { principalId: "rimp1_bob", relayUrls: ["https://relay-b.example"], name: "Bob" };

function startRelay() {
  useRelayStore.getState().reset();
  useRelayStore
    .getState()
    .setStarted(
      { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
      { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d1" },
      [],
    );
}

/** The DM between the viewer and Bob in `serverId`. */
function dmWithBob(serverId: string, bobId: string) {
  return makeConversation({
    id: "dm-bob",
    serverId,
    title: null,
    conversationType: ConversationTypeEnum.DIRECT,
    memberIds: ["me", bobId],
    memberCount: 2,
  });
}

/** Answers the inbox and member list reads; `inbox` lists the space's DMs. */
function serveReads(inbox = emptyInbox, extra: Parameters<typeof routeRequests>[1] = {}) {
  routeRequests(requestMock, {
    "query InboxConversations": () => inbox,
    "query ServerMembers": () => ({
      serverMembers: [{ userId: "u-bob", username: "bob", principalId: "rimp1_bob" }],
    }),
    ...extra,
  });
}

/** Bob and any `extra` people as contacts, named by their verified cards. */
function contactBob(extra: (typeof bob)[] = []) {
  relayApi.fetchContacts.mockResolvedValue(
    [bob, ...extra].map((c) => ({
      principalId: c.principalId,
      relayUrls: c.relayUrls,
      addedAt: "",
    })),
  );
  identity.fetchVerifiedIdentity.mockImplementation((principalId: string) =>
    Promise.resolve({
      identity: {},
      card: {
        displayName: [bob, ...extra].find((c) => c.principalId === principalId)?.name ?? "",
        relays: [],
        version: 1,
      },
    }),
  );
}

beforeEach(() => {
  start.startDirectConversation.mockReset();
  relayApi.fetchContacts.mockReset();
  identity.fetchVerifiedIdentity.mockReset();
  requestMock.mockReset();
  queryClient.clear();
  serveReads();
  startRelay();
  useAuthStore.getState().setSession({ userId: "me" });
  useShellStore.getState().setSelectedConversationId(null);
});

describe("NewMessagePicker", () => {
  it("opens a draft DM with a contact in the direct space and creates nothing", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    contactBob();
    const onClose = vi.fn();
    renderWithProviders(<NewMessagePicker open onClose={onClose} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole("option", { name: "Bob" }));
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useShellStore.getState().draftDirect).toEqual({ spaceId: "direct-1", member: bob });
    expect(useShellStore.getState().selectedConversationId).toBeNull();
    expect(start.startDirectConversation).not.toHaveBeenCalled();
  });

  it("opens the DM with a contact that the direct space already holds", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    serveReads({
      inboxConversations: {
        items: [dmWithBob("direct-1", "u-bob")],
        pageInfo: { hasNext: false, hasPrev: false },
      },
    });
    contactBob();
    const onClose = vi.fn();
    renderWithProviders(<NewMessagePicker open onClose={onClose} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole("option", { name: "Bob" }));
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useShellStore.getState().selectedConversationId).toBe("dm-bob");
    expect(useShellStore.getState().draftDirect).toBeNull();
    expect(start.startDirectConversation).not.toHaveBeenCalled();
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

  it("opens a draft in the direct space for a workspace member with a principal id", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    queryClient.setQueryData(queryKeys.serverMembers("ws-1"), [
      { userId: "u2", username: "bob", displayName: "Bob", principalId: "rimp1_bob" },
    ]);
    renderWithProviders(<NewMessagePicker open onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "pick Bob" }));
    await user.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() => expect(useWorkspaceStore.getState().workspaceId).toBe("direct-1"));
    expect(useShellStore.getState().draftDirect).toEqual({
      spaceId: "direct-1",
      member: { principalId: "rimp1_bob", relayUrls: [], name: "Bob" },
    });
    expect(start.startDirectConversation).not.toHaveBeenCalled();
  });

  it("starts a group with contacts and shows why it was not started", async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    contactBob([{ principalId: "rimp1_carol", relayUrls: [], name: "Carol" }]);
    start.startDirectConversation.mockRejectedValue(
      new Error("Bob cannot receive encrypted messages yet"),
    );
    renderWithProviders(<NewMessagePicker open onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole("option", { name: "Bob" }));
    await user.click(await screen.findByRole("option", { name: "Carol" }));
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText(/cannot receive encrypted messages/)).toBeInTheDocument();
    expect(start.startDirectConversation.mock.calls[0][0]).toHaveLength(2);
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

describe("NewMessagePicker in a workspace", () => {
  const device = { account: {}, userId: "me", principalId: "rimp1_me", deviceId: "d1" };

  /** Pick with the `pick` button, confirm, and wait for the picker to close. */
  async function pickAndConfirm(pick: string) {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    renderWithProviders(<NewMessagePicker open onClose={onClose} onCreated={onCreated} />);
    await user.click(screen.getByRole("button", { name: pick }));
    await user.click(screen.getByRole("button", { name: "confirm" }));
    return { onClose, onCreated };
  }

  beforeEach(() => {
    Object.values({ ...session, ...groups }).forEach((fn) => fn.mockReset());
    groups.createGroup.mockResolvedValue(true);
    groups.allMembersReady.mockResolvedValue(false);
    useRelayStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  it("opens a draft DM with one member and creates nothing", async () => {
    const { onClose, onCreated } = await pickAndConfirm("pick Bob");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useShellStore.getState().draftDirect).toEqual({
      workspaceId: "ws-1",
      otherUserId: "u2",
    });
    expect(callsTo(requestMock, "mutation CreateConversation")).toHaveLength(0);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("opens the DM the workspace already holds with that member", async () => {
    serveReads({
      inboxConversations: {
        items: [dmWithBob("ws-1", "u2")],
        pageInfo: { hasNext: false, hasPrev: false },
      },
    });
    const { onClose } = await pickAndConfirm("pick Bob");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useShellStore.getState().selectedConversationId).toBe("dm-bob");
    expect(useShellStore.getState().draftDirect).toBeNull();
    expect(callsTo(requestMock, "mutation CreateConversation")).toHaveLength(0);
  });

  it("creates an encrypted group at once when this device is ready", async () => {
    session.e2eeSession.mockResolvedValue(device);
    const created = makeConversation({
      id: "g1",
      conversationType: ConversationTypeEnum.GROUP,
      encryptedAt: "2026-10-15T00:00:00Z",
    });
    serveReads(emptyInbox, {
      "mutation CreateConversation": () => ({ createConversation: created }),
    });
    const { onCreated } = await pickAndConfirm("pick Bob and Carol");
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("g1"));
    expect(callsTo(requestMock, "mutation CreateConversation").map((v) => v.input)).toEqual([
      { serverId: "ws-1", memberIds: ["u2", "u3"], encrypted: true },
    ]);
    await waitFor(() => expect(groups.createGroup).toHaveBeenCalledWith(device, "ws-1", "g1"));
    expect(useShellStore.getState().draftDirect).toBeNull();
  });
});
