import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { createTestQueryClient } from "../../test/utils";
import { expectReachableByKeyboard } from "../../test/keyboard";
import { queryKeys } from "../../core/query/keys";
import { queryClient } from "../../core/query/queryClient";
import {
  ConversationTypeEnum,
  ServerMemberRoleGql,
} from "../../core/graphql/generated/schema-types";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "../state/useShellStore";

const requestMock = vi.fn();

/** The server info read of a server that lists no capabilities. */
const NO_CAPABILITIES = {
  serverInfo: { version: "0.0.0", apiVersion: 1, features: [], capabilities: [] },
};

vi.mock("../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

// Child surfaces with their own data needs — stubbed so only the header is exercised.
vi.mock("../../features/lenses/components/LensPicker", () => ({ LensPicker: () => null }));
vi.mock("../../features/settings/components/InviteDialog", () => ({ InviteDialog: () => null }));
vi.mock("../../features/commands/hooks/useKeybindLabel", () => ({
  useKeybindLabel: () => null,
}));

vi.mock("../../features/commands/runtime/runFromClick", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../features/commands/runtime/runFromClick")>();
  return { ...actual, runCommandFromClick: vi.fn(actual.runCommandFromClick) };
});

import { runCommandFromClick } from "../../features/commands/runtime/runFromClick";
import { useSearchOverlayStore } from "../../features/messages/state/useSearchOverlayStore";
import { lockVault } from "../../core/accountVault/accountVault";
import { unlockTestVault } from "../../test/accountVault";
import { ConversationHeader } from "./ConversationHeader";
import {
  clearServedCommands,
  commandSucceeded,
  sentCommands,
  serveCommands,
} from "../../test/clickCommands";
import { toast } from "../../shared/toast";
import {
  emptyInbox,
  graphqlError,
  makeConversation,
  workspaceMembers,
} from "../../features/conversations/__fixtures__/conversations";
import type { ConversationSummary } from "../../features/conversations/types";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { useTopicEditStore } from "../../features/conversations/state/useTopicEditStore";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useE2eeStore } from "../../features/e2ee/state/useE2eeStore";
import { usePresenceStore } from "../../features/presence/state/usePresenceStore";

function renderHeader() {
  const qc = createTestQueryClient();
  render(
    <QueryClientProvider client={qc}>
      <ConversationHeader />
    </QueryClientProvider>,
  );
  return qc;
}

describe("ConversationHeader — keyboard", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query ServerInfo")) return Promise.resolve(NO_CAPABILITIES);
      if (document.includes("query Server(")) {
        return Promise.resolve({
          server: { id: "srv-1", name: "Acme", viewerRole: ServerMemberRoleGql.OWNER },
        });
      }
      return new Promise(() => {});
    });
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("reaches the conversation actions by keyboard", async () => {
    const user = userEvent.setup();
    renderHeader();
    await screen.findByRole("button", { name: "Invite member" });
    await expectReachableByKeyboard(user, [
      screen.getByRole("button", { name: "Invite member" }),
      screen.getByRole("button", { name: /^Search in/ }),
    ]);
  });
});

function serveConversation(
  conversation: ConversationSummary,
  viewerRole?: ServerMemberRoleGql,
  execute: () => Promise<unknown> = async () => commandSucceeded(),
) {
  requestMock.mockImplementation((document: string) => {
    if (document.includes("query ServerInfo")) return Promise.resolve(NO_CAPABILITIES);
    if (document.includes("mutation ExecuteCommand")) return execute();
    if (document.includes("mutation UpdateConversationTopic")) {
      return Promise.resolve({ updateConversationTopic: { id: conversation.id, topic: "" } });
    }
    if (document.includes("query Conversation(")) {
      return Promise.resolve({ conversation });
    }
    if (viewerRole && document.includes("query Server(")) {
      return Promise.resolve({ server: { id: "srv-1", name: "Acme", viewerRole } });
    }
    if (document.includes("query InboxConversations")) return Promise.resolve(emptyInbox);
    return new Promise(() => {});
  });
}

describe("ConversationHeader — channel privacy, members and menu", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    useMembersPanelStore.setState({ open: false });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    clearServedCommands();
  });

  it("shows a lock and the member count for a private channel; the count opens the members panel", async () => {
    serveConversation(makeConversation({ title: "secret", isPrivate: true, memberCount: 3 }));
    renderHeader();

    expect(await screen.findByRole("img", { name: "Private channel" })).toBeInTheDocument();
    const count = screen.getByRole("button", { name: "3 members" });
    fireEvent.click(count);
    expect(useMembersPanelStore.getState().open).toBe(true);
    expect(screen.getByRole("button", { name: "Conversation menu" })).toBeInTheDocument();
  });

  it("names the search after a group without a channel #", async () => {
    serveConversation(
      makeConversation({
        title: "Bob and Carol",
        conversationType: ConversationTypeEnum.GROUP,
        isPrivate: true,
      }),
    );
    renderHeader();

    expect(
      await screen.findByRole("button", { name: "Search in Bob and Carol" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Search in #/ })).not.toBeInTheDocument();
  });

  it("names the search after a channel with a #", async () => {
    serveConversation(makeConversation({ title: "general" }));
    renderHeader();

    expect(await screen.findByRole("button", { name: "Search in #general" })).toBeInTheDocument();
  });

  it("says 1 member for a channel of one, in its label too", async () => {
    serveConversation(makeConversation({ title: "solo", memberCount: 1 }));
    renderHeader();

    const count = await screen.findByRole("button", { name: "1 member" });
    expect(count).toHaveTextContent("1 member");
    expect(screen.queryByText(/1 members/)).not.toBeInTheDocument();
  });

  /** Opens the topic edit from the conversation menu and types `topic` into it. */
  async function editTopic(topic: string) {
    renderHeader();
    fireEvent.click(await screen.findByRole("button", { name: "Conversation menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit topic…" }));
    const input = await screen.findByPlaceholderText("Set a topic...");
    expect(input).toHaveValue("Old topic");
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: topic } });
    return input;
  }

  it("edits the topic from the conversation menu and saves it with Enter", async () => {
    serveCommands("srv-1", ["chat.set_topic"]);
    serveConversation(
      makeConversation({ id: "conv-1", serverId: "srv-1", topic: "Old topic" }),
      ServerMemberRoleGql.MODERATOR,
    );
    const input = await editTopic("New topic");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(sentCommands(requestMock)).toEqual([
        {
          commandId: "chat.set_topic",
          args: { server_id: "srv-1", conversation_id: "conv-1", topic: "New topic" },
          commandContext: { workspaceId: "srv-1", conversationId: "conv-1" },
        },
      ]),
    );
    expect(useTopicEditStore.getState().conversationId).toBeNull();
    expect(screen.queryByPlaceholderText("Set a topic...")).not.toBeInTheDocument();
  });

  it("sets the topic with the mutation on a host without the command", async () => {
    serveCommands("srv-1", ["chat.join_channel"]);
    serveConversation(
      makeConversation({ id: "conv-1", serverId: "srv-1", topic: "Old topic" }),
      ServerMemberRoleGql.MODERATOR,
    );
    fireEvent.keyDown(await editTopic("New topic"), { key: "Enter" });
    await waitFor(() =>
      expect(
        requestMock.mock.calls.filter(([doc]) => String(doc).includes("UpdateConversationTopic")),
      ).toHaveLength(1),
    );
    expect(sentCommands(requestMock)).toEqual([]);
  });

  it("tells why the server refused a topic", async () => {
    const error = vi.spyOn(toast, "error");
    serveCommands("srv-1", ["chat.set_topic"]);
    serveConversation(
      makeConversation({ id: "conv-1", serverId: "srv-1", topic: "Old topic" }),
      ServerMemberRoleGql.MODERATOR,
      async () => {
        throw graphqlError("VALIDATION", "the topic is too long");
      },
    );
    fireEvent.keyDown(await editTopic("x".repeat(600)), { key: "Enter" });
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("The topic could not be changed: the topic is too long"),
    );
    error.mockRestore();
  });

  it("marks an archived channel", async () => {
    serveConversation(makeConversation({ isArchived: true }));
    renderHeader();
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Private channel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not encrypted" })).not.toBeInTheDocument();
  });
});

describe("ConversationHeader — who may change the topic", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useTopicEditStore.getState().stop();
    useAuthStore.setState({ session: null });
  });

  it("shows a member the topic as text, with no way to edit it", async () => {
    serveConversation(
      makeConversation({ serverId: "srv-1", topic: "Release day", createdBy: "ana" }),
      ServerMemberRoleGql.MEMBER,
    );
    renderHeader();

    const text = await screen.findByText("Release day");
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([doc]) => String(doc).includes("query Server("))).toBe(
        true,
      ),
    );
    expect(screen.queryByRole("button", { name: "Release day" })).not.toBeInTheDocument();
    fireEvent.click(text);
    expect(screen.queryByPlaceholderText("Set a topic...")).not.toBeInTheDocument();
  });

  it('shows a member no "Set a topic..." for a channel without one', async () => {
    serveConversation(makeConversation({ serverId: "srv-1" }), ServerMemberRoleGql.MEMBER);
    renderHeader();

    await screen.findByRole("button", { name: "1 member" });
    expect(screen.queryByText("Set a topic...")).not.toBeInTheDocument();
  });

  it("lets the creator of a private channel edit its topic", async () => {
    serveConversation(
      makeConversation({ serverId: "srv-1", isPrivate: true, createdBy: "me" }),
      ServerMemberRoleGql.MEMBER,
    );
    renderHeader();

    fireEvent.click(await screen.findByRole("button", { name: "Set a topic..." }));
    expect(await screen.findByPlaceholderText("Set a topic...")).toBeInTheDocument();
  });

  it("shows an archived channel's topic as text, even to a moderator", async () => {
    serveConversation(
      makeConversation({ serverId: "srv-1", topic: "Old plans", isArchived: true }),
      ServerMemberRoleGql.MODERATOR,
    );
    renderHeader();

    const text = await screen.findByText("Old plans");
    expect(screen.queryByRole("button", { name: "Old plans" })).not.toBeInTheDocument();
    fireEvent.click(text);
    expect(screen.queryByPlaceholderText("Set a topic...")).not.toBeInTheDocument();
  });
});

describe("ConversationHeader — unencrypted conversation", () => {
  beforeEach(async () => {
    // The dialog opens by itself only while its dismissal can be kept.
    await unlockTestVault();
    requestMock.mockReset();
    localStorage.clear();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useE2eeStore.setState({ webEncryption: "ready", notReady: { "conv-1": ["Bob"] } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useAuthStore.setState({ session: null });
    useE2eeStore.setState({ webEncryption: "checking", notReady: {} });
    lockVault();
  });

  it("marks a DM that is not encrypted and reopens its dialog from the mark", async () => {
    serveConversation(
      makeConversation({
        title: null,
        conversationType: ConversationTypeEnum.DIRECT,
        memberIds: ["me", "u-bob"],
        memberCount: 2,
      }),
    );
    renderHeader();

    fireEvent.click(await screen.findByRole("button", { name: "OK" }));
    fireEvent.click(screen.getByRole("button", { name: "Not encrypted" }));
    expect(
      screen.getByRole("dialog", { name: "This conversation is not encrypted" }),
    ).toHaveTextContent("Bob has not set up encryption on a desktop device yet.");
  });
});

describe("ConversationHeader — group without a title", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useAuthStore.setState({ session: null });
  });

  it("is named after its other members instead of Untitled", async () => {
    const group = makeConversation({
      title: null,
      conversationType: ConversationTypeEnum.GROUP,
      memberIds: ["me", "u-bob", "u-alice"],
      memberCount: 3,
    });
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query ServerInfo")) return Promise.resolve(NO_CAPABILITIES);
      if (document.includes("query Conversation(")) return Promise.resolve({ conversation: group });
      if (document.includes("query ServerMembers"))
        return Promise.resolve({ serverMembers: workspaceMembers });
      if (document.includes("query InboxConversations")) return Promise.resolve(emptyInbox);
      return new Promise(() => {});
    });
    renderHeader();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Alice and Bob" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Untitled")).not.toBeInTheDocument();
  });

  it("counts a group's members in the singular", async () => {
    const group = makeConversation({
      title: "Planning",
      conversationType: ConversationTypeEnum.GROUP,
      memberIds: ["me"],
      memberCount: 1,
    });
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query ServerInfo")) return Promise.resolve(NO_CAPABILITIES);
      if (document.includes("query Conversation(")) return Promise.resolve({ conversation: group });
      if (document.includes("query ServerMembers"))
        return Promise.resolve({ serverMembers: workspaceMembers });
      if (document.includes("query InboxConversations")) return Promise.resolve(emptyInbox);
      return new Promise(() => {});
    });
    renderHeader();

    expect(await screen.findByText(/· 1 member$/)).toBeInTheDocument();
    expect(screen.queryByText(/1 members/)).not.toBeInTheDocument();
  });
});

describe("ConversationHeader — DM sent as a request", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    usePresenceStore.getState().setPresence("u-bob", "ONLINE");
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useAuthStore.setState({ session: null });
    usePresenceStore.setState({ presenceMap: {} });
  });

  it.each([
    [false, "shows"],
    [true, "hides"],
  ])("with the request pending %s, %s the other member's presence", async (pending) => {
    const dm = makeConversation({
      title: "Bob",
      conversationType: ConversationTypeEnum.DIRECT,
      memberIds: ["me", "u-bob"],
      memberCount: 2,
    });
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query ServerInfo")) return Promise.resolve(NO_CAPABILITIES);
      if (document.includes("query ConversationDmRequestPending")) {
        return Promise.resolve({ conversation: { id: dm.id, dmRequestPending: pending } });
      }
      if (document.includes("query Conversation(")) return Promise.resolve({ conversation: dm });
      if (document.includes("query InboxConversations")) return Promise.resolve(emptyInbox);
      return new Promise(() => {});
    });
    renderHeader();
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(([doc]) =>
          String(doc).includes("query ConversationDmRequestPending"),
        ),
      ).toBe(true),
    );
    const dot = () => document.querySelector(".bg-rim-success");
    if (pending) await waitFor(() => expect(dot()).toBeNull());
    else await waitFor(() => expect(dot()).not.toBeNull());
  });
});

describe("ConversationHeader — invite gate", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it.each([
    [ServerMemberRoleGql.OWNER, true],
    [ServerMemberRoleGql.MODERATOR, false],
    [ServerMemberRoleGql.MEMBER, false],
    [ServerMemberRoleGql.GUEST, false],
  ])("viewer %s: Invite member shown = %s", async (role, shown) => {
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query ServerInfo")) return Promise.resolve(NO_CAPABILITIES);
      if (document.includes("query Server(")) {
        return Promise.resolve({ server: { id: "srv-1", name: "Acme", viewerRole: role } });
      }
      return new Promise(() => {});
    });
    const qc = renderHeader();
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("srv-1"))).toBeDefined());
    if (shown) {
      expect(screen.getByRole("button", { name: "Invite member" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument();
    }
  });
});

describe("ConversationHeader — draft DM", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query ServerInfo")) return Promise.resolve(NO_CAPABILITIES);
      if (document.includes("query Server(")) {
        return Promise.resolve({
          server: { id: "srv-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
        });
      }
      if (document.includes("query ServerMembers")) {
        return Promise.resolve({
          serverMembers: [{ userId: "u-bob", username: "bob", displayName: "Bob" }],
        });
      }
      return new Promise(() => {});
    });
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.getState().openDraftDirect({ workspaceId: "srv-1", otherUserId: "u-bob" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("names the person and the workspace, with no conversation actions", async () => {
    renderHeader();
    expect(await screen.findByRole("heading", { name: "Bob" })).toBeInTheDocument();
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Search in/ })).not.toBeInTheDocument();
  });
});

describe("ConversationHeader — way back from a DM", () => {
  const servers = [
    { id: "direct-1", name: "Direct", owner: null },
    { id: "ws-1", name: "Acme Team", owner: null },
  ];
  const origin = {
    workspaceId: "ws-1",
    conversationId: "c-design",
    spaceId: "direct-1",
    openedId: "dm-carol",
  };

  function renderWithServers() {
    const qc = createTestQueryClient();
    qc.setQueryData(queryKeys.myServers(), servers);
    render(
      <QueryClientProvider client={qc}>
        <ConversationHeader />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((document: string) => {
      if (document.includes("query ServerInfo")) return Promise.resolve(NO_CAPABILITIES);
      if (document.includes("query Conversation(")) {
        return Promise.resolve({
          conversation: makeConversation({
            id: "dm-carol",
            serverId: "direct-1",
            title: "Carol",
            conversationType: ConversationTypeEnum.DIRECT,
            memberIds: ["me", "u-carol"],
          }),
        });
      }
      return new Promise(() => {});
    });
    queryClient.setQueryData(queryKeys.myServers(), servers);
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    useShellStore.getState().setSelectedConversationId("dm-carol");
  });

  afterEach(() => {
    queryClient.clear();
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("shows Back to the workspace on the DM opened from it, and returns there", async () => {
    useShellStore.getState().setDirectOrigin(origin);
    renderWithServers();
    const back = await screen.findByRole("button", { name: "Back to Acme Team" });
    expect(back).toHaveTextContent("Back to Acme Team");
    fireEvent.click(back);
    expect(useWorkspaceStore.getState().workspaceId).toBe("ws-1");
    expect(useShellStore.getState().selectedConversationId).toBe("c-design");
    expect(useShellStore.getState().directOrigin).toBeNull();
  });

  it("shows Back on the draft the origin opened", async () => {
    useShellStore.getState().openDraftDirect({
      spaceId: "direct-1",
      member: { principalId: "rimp1_carol", relayUrls: [], name: "Carol" },
    });
    useShellStore.getState().setDirectOrigin({ ...origin, openedId: null });
    renderWithServers();
    expect(await screen.findByRole("button", { name: "Back to Acme Team" })).toBeInTheDocument();
  });

  it("shows no Back on another DM, and none without an origin", async () => {
    useShellStore.getState().setDirectOrigin({ ...origin, openedId: "dm-dave" });
    renderWithServers();
    expect(screen.queryByRole("button", { name: /^Back to/ })).not.toBeInTheDocument();

    act(() => useShellStore.getState().setDirectOrigin(origin));
    expect(screen.getByRole("button", { name: "Back to Acme Team" })).toBeInTheDocument();
    act(() => useShellStore.getState().setDirectOrigin(null));
    expect(screen.queryByRole("button", { name: /^Back to/ })).not.toBeInTheDocument();
  });
});

describe("ConversationHeader — no conversation open", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: null });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("shows No conversation without a channel icon", () => {
    renderHeader();
    expect(screen.getByRole("heading", { name: "No conversation" })).toBeInTheDocument();
    expect(document.body.querySelector("svg.lucide-hash")).toBeNull();
  });

  it("wraps in a narrow window: the controls drop to a second line, and the count stays whole", async () => {
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ shellWidth: "narrow", selectedConversationId: "conv-1" });
    serveConversation(makeConversation({ title: "design", memberCount: 1 }));
    renderHeader();

    const count = await screen.findByRole("button", { name: "1 member" });
    expect(count.className).toContain("whitespace-nowrap");
    // The top bar holds the navigation button.
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
    const bar = count.closest("div.border-b") as HTMLElement;
    expect(bar.className).toContain("flex-wrap");
    expect(bar.className).toContain("min-h-10");
    useShellStore.setState({ shellWidth: "wide" });
  });
});

describe("ConversationHeader — the commands its controls run", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(runCommandFromClick).mockClear();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    useMembersPanelStore.setState({ open: false });
  });

  afterEach(() => {
    useSearchOverlayStore.getState().close();
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("runs the member count, Invite member, Pinned messages and Search in the open conversation", async () => {
    const user = userEvent.setup();
    serveConversation(
      makeConversation({ id: "conv-1", title: "general", memberCount: 3 }),
      ServerMemberRoleGql.OWNER,
    );
    renderHeader();

    await user.click(await screen.findByRole("button", { name: "3 members" }));
    expect(useMembersPanelStore.getState().open).toBe(true);
    await user.click(await screen.findByRole("button", { name: "Invite member" }));
    expect(useShellStore.getState().showInviteDialog).toBe(true);
    await user.click(screen.getByRole("button", { name: "Pinned messages" }));
    expect(useShellStore.getState().pinnedPanelOpen).toBe(true);
    await user.click(screen.getByRole("button", { name: "Search in #general" }));
    expect(useSearchOverlayStore.getState()).toMatchObject({
      isOpen: true,
      scope: { kind: "conversation", conversationId: "conv-1" },
    });

    expect(vi.mocked(runCommandFromClick).mock.calls).toEqual([
      ["workspace.toggle_conversation_members"],
      ["admin.invite_member"],
      ["workspace.toggle_pinned_messages"],
      ["workspace.search_in_channel"],
    ]);
    expect(
      requestMock.mock.calls.filter(([doc]) => String(doc).includes("ExecuteCommand")),
    ).toEqual([]);
  });
});
