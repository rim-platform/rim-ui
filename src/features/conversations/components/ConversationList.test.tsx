import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { createTestQueryClient } from "../../../test/utils";
import {
  clearServedCommands,
  commandSucceeded,
  sentCommands,
  serveCommands,
} from "../../../test/clickCommands";
import { queryClient } from "../../../core/query/queryClient";
import { fakeServerInfo } from "../../../test/serverInfo";
import { expectReachableByKeyboard } from "../../../test/keyboard";
import {
  ConversationTypeEnum,
  DmRequestStatus,
  ServerMemberRoleGql,
} from "../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../core/query/keys";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useRelayStore } from "../../relay/state/useRelayStore";
import { makeDmRequest } from "../../relay/__fixtures__/dmRequests";
import {
  baseReadHandlers,
  callsTo,
  makeConversation,
  routeRequests,
} from "../__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../commands/hooks/useKeybindLabel", () => ({ useKeybindLabel: () => null }));
const prefetch = vi.hoisted(() => ({ usePrefetchMessages: vi.fn() }));
vi.mock("../../../core/events/usePrefetchMessages", () => prefetch);

vi.mock("../../commands/runtime/runFromClick", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../commands/runtime/runFromClick")>();
  return { ...actual, runCommandFromClick: vi.fn(actual.runCommandFromClick) };
});

import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { useUnreadStore } from "../state/useUnreadStore";
import { useConversationDialogStore } from "../state/useConversationDialogStore";
import { ConversationCommandHost } from "./ConversationCommandHost";
import { ConversationList } from "./ConversationList";
import { ConversationSelectionRuntime } from "./ConversationSelectionRuntime";

const general = makeConversation({ id: "c-general", title: "general", memberCount: 12 });
const secret = makeConversation({ id: "c-secret", title: "secret", isPrivate: true });
const oldNews = makeConversation({ id: "c-old", title: "old-news", isArchived: true });
const random = makeConversation({
  id: "c-random",
  title: "random",
  isMember: false,
  memberCount: 7,
  topic: "Off-topic chatter",
});
const dm = makeConversation({
  id: "c-dm",
  title: null,
  conversationType: ConversationTypeEnum.DIRECT,
  memberIds: ["me", "u-alice"],
});

function page(items: unknown[]) {
  return { channels: { items, pageInfo: { hasNext: false, hasPrev: false } } };
}

/** The sidebar asks for joined channels; the browse dialog for the default (all visible) list. */
function serve(
  joined = [general, secret, oldNews],
  browse = [general, secret, random],
  inbox: unknown[] = [dm],
) {
  routeRequests(requestMock, {
    ...baseReadHandlers,
    "query Server(": () => ({
      server: { id: "ws-1", name: "Acme", viewerRole: ServerMemberRoleGql.MEMBER },
    }),
    "query Channels": (vars) => {
      const filter = vars.filter as { joinedOnly?: boolean } | undefined;
      return page(filter?.joinedOnly ? joined : browse);
    },
    "query InboxConversations": () => ({
      inboxConversations: { items: inbox, pageInfo: { hasNext: false, hasPrev: false } },
    }),
    "mutation JoinChannel": () => ({ joinChannel: { ...random, isMember: true, memberCount: 8 } }),
  });
}

/** Renders the list; `qc` is the cache it reads, a fresh one unless given. */
function renderList(defaultWorkspace?: string, qc: QueryClient = createTestQueryClient()) {
  if (defaultWorkspace) {
    qc.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { defaultWorkspace }));
  }
  render(
    <QueryClientProvider client={qc}>
      <ConversationSelectionRuntime />
      <ConversationList />
      <ConversationCommandHost />
    </QueryClientProvider>,
  );
  return qc;
}

describe("ConversationList — channels sidebar", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-general" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useConversationDialogStore.getState().closeBrowseChannels();
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
    useRelayStore.getState().reset();
  });

  it("reaches every conversation and the channel actions with Tab", async () => {
    serve();
    const user = userEvent.setup();
    renderList();
    await screen.findByText("general");
    await expectReachableByKeyboard(user, [
      screen.getByRole("listbox"),
      screen.getByRole("button", { name: "Browse channels" }),
      await screen.findByRole("button", { name: "New channel" }),
      screen.getByText("general").closest("button")!,
      screen.getByText("secret").closest("button")!,
      screen.getByRole("button", { name: /archived \(1\)/i }),
    ]);
  });

  it("presses the focused button on Enter instead of opening the highlighted row", async () => {
    serve();
    const user = userEvent.setup();
    renderList();
    await screen.findByText("general");
    screen.getByRole("button", { name: "Browse channels" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Browse channels" })).toBeInTheDocument();
    expect(useShellStore.getState().selectedConversationId).toBe("c-general");
  });

  it("opens the conversation a Tab landed on with Enter", async () => {
    serve();
    const user = userEvent.setup();
    renderList();
    (await screen.findByText("secret")).closest("button")!.focus();
    await user.keyboard("{Enter}");
    expect(useShellStore.getState().selectedConversationId).toBe("c-secret");
  });

  it("jumps to the last and first conversation with End and Home", async () => {
    serve();
    const user = userEvent.setup();
    renderList();
    // Channels and the inbox load separately; wait for both before jumping to the end.
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    // An earlier test's conversation switch blurs focus on a later frame; let it pass.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    screen.getByRole("listbox").focus();
    await user.keyboard("{End}{Enter}");
    expect(useShellStore.getState().selectedConversationId).toBe("c-dm");
    // Opening a conversation moves focus on the next frame; let it happen first.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    screen.getByRole("listbox").focus();
    await user.keyboard("{Home}{Enter}");
    expect(useShellStore.getState().selectedConversationId).toBe("c-general");
  });

  it("marks an invitation, names a waiting DM after its invitee, and prefetches only readable ones", async () => {
    const invitation = makeConversation({
      id: "c-invite",
      title: "plans",
      conversationType: ConversationTypeEnum.GROUP,
      memberIds: ["u-alice"],
      pendingMemberIds: ["me"],
      isMember: false,
      encryptedAt: "2026-10-15T00:00:00Z",
    });
    const waitingDm = makeConversation({
      id: "c-waiting",
      title: null,
      conversationType: ConversationTypeEnum.DIRECT,
      memberIds: ["me"],
      pendingMemberIds: ["u-alice"],
      encryptedAt: "2026-10-15T00:00:00Z",
    });
    serve([general], [general], [invitation, waitingDm]);
    renderList();

    const invitedRow = (await screen.findByText("plans")).closest("li")!;
    expect(within(invitedRow).getByText("Invited")).toBeInTheDocument();
    const dmRow = (await screen.findByText("Alice")).closest("li")!;
    expect(within(dmRow).queryByText("Invited")).not.toBeInTheDocument();
    // The server refuses an invited viewer the messages; the inviter's DM is readable.
    expect(prefetch.usePrefetchMessages).toHaveBeenLastCalledWith("ws-1", [
      "c-general",
      "c-waiting",
    ]);
  });

  it("shows an open draft DM first among conversations, selected, until a conversation is opened", async () => {
    useShellStore.getState().openDraftDirect({ workspaceId: "ws-1", otherUserId: "u-bob" });
    serve();
    const user = userEvent.setup();
    renderList();

    const draftRow = (await screen.findByText("New message to Bob")).closest("li")!;
    expect(draftRow).toHaveAttribute("aria-selected", "true");
    const messages = within(screen.getByText("Conversations").parentElement!).getAllByRole(
      "option",
    );
    expect(messages[0]).toBe(draftRow);
    // The list loaded with nothing selected, and the draft kept it from opening the first one.
    await screen.findByText("Alice");
    expect(useShellStore.getState().selectedConversationId).toBeNull();

    await user.click(screen.getByText("Alice"));
    expect(useShellStore.getState().selectedConversationId).toBe("c-dm");
    expect(screen.queryByText("New message to Bob")).not.toBeInTheDocument();
  });

  it("opens its first conversation under a main-area plugin panel, and closes the panel when one is clicked", async () => {
    useShellStore.setState({ selectedConversationId: null });
    useShellStore.getState().openPluginPanel("chat.rim.k8s-pods", "pods", "main_area");
    serve();
    const user = userEvent.setup();
    renderList();

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-general"));
    expect(useShellStore.getState().activePluginPanel).not.toBeNull();

    await user.click(await screen.findByText("secret"));
    expect(useShellStore.getState().selectedConversationId).toBe("c-secret");
    expect(useShellStore.getState().activePluginPanel).toBeNull();
  });

  it("asks for joined channels including archived ones", async () => {
    serve();
    renderList();
    await screen.findByText("general");
    const joinedCalls = callsTo(requestMock, "query Channels");
    expect(joinedCalls[0]).toMatchObject({
      serverId: "ws-1",
      filter: { joinedOnly: true, includeArchived: true },
    });
  });

  it("lists joined channels with a lock for private ones and hides archived ones in a collapsed group", async () => {
    serve();
    renderList();

    const generalRow = (await screen.findByText("general")).closest("li")!;
    const secretRow = screen.getByText("secret").closest("li")!;
    expect(within(secretRow).getByRole("img", { name: "Private channel" })).toBeInTheDocument();
    expect(within(generalRow).queryByRole("img", { name: "Private channel" })).toBeNull();

    // Archived group is collapsed by default
    const toggle = screen.getByRole("button", { name: /archived \(1\)/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("old-news")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(screen.getByRole("list", { name: "Archived channels" })).getByText("old-news"),
    ).toBeInTheDocument();
  });

  it("shows no member count on channel rows", async () => {
    serve();
    renderList();

    const generalRow = (await screen.findByText("general")).closest("li")!;
    expect(within(generalRow).queryByText("12")).not.toBeInTheDocument();
  });

  it("omits the archived group when nothing is archived", async () => {
    serve([general]);
    renderList();
    await screen.findByText("general");
    expect(screen.queryByRole("button", { name: /archived/i })).not.toBeInTheDocument();
  });

  it("keeps the browse entry reachable when no channel is joined", async () => {
    serve([]);
    renderList();
    fireEvent.click(await screen.findByText(/no channels joined yet/i));
    expect(await screen.findByRole("dialog", { name: "Browse channels" })).toBeInTheDocument();
  });

  it("browse lists channels with member counts, joins one and navigates to it", async () => {
    serve();
    const route = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((document: unknown, variables?: Record<string, unknown>) =>
      String(document).includes("mutation ExecuteCommand")
        ? Promise.resolve(commandSucceeded())
        : route(document, variables),
    );
    serveCommands("ws-1", ["chat.join_channel"]);
    // The app's own cache, which the join's effect refreshes.
    renderList(undefined, queryClient);
    fireEvent.click(await screen.findByRole("button", { name: "Browse channels" }));

    const dialog = await screen.findByRole("dialog", { name: "Browse channels" });
    const randomRow = await within(dialog).findByTestId("browse-channel-c-random");
    expect(within(randomRow).getByText(/7 members/)).toBeInTheDocument();
    expect(within(randomRow).getByText(/Off-topic chatter/)).toBeInTheDocument();
    // Joined channels offer Open instead of Join
    const generalRow = within(dialog).getByTestId("browse-channel-c-general");
    expect(within(generalRow).getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(within(generalRow).queryByRole("button", { name: /join/i })).toBeNull();

    fireEvent.click(within(randomRow).getByRole("button", { name: "Join random" }));

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-random"));
    expect(sentCommands(requestMock)).toEqual([
      {
        commandId: "chat.join_channel",
        args: { server_id: "ws-1", conversation_id: "c-random" },
        commandContext: { workspaceId: "ws-1", conversationId: "c-random" },
      },
    ]);
    expect(screen.queryByRole("dialog", { name: "Browse channels" })).not.toBeInTheDocument();
    // The joined list is refetched so the channel lands in the sidebar.
    await waitFor(() =>
      expect(
        callsTo(requestMock, "query Channels").filter(
          (v) => (v.filter as { joinedOnly?: boolean }).joinedOnly,
        ).length,
      ).toBeGreaterThan(1),
    );
    clearServedCommands();
    queryClient.clear();
  });

  it("Open on a joined channel navigates without joining", async () => {
    serve();
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Browse channels" }));
    const dialog = await screen.findByRole("dialog", { name: "Browse channels" });
    const secretRow = await within(dialog).findByTestId("browse-channel-c-secret");
    fireEvent.click(within(secretRow).getByRole("button", { name: "Open" }));

    expect(useShellStore.getState().selectedConversationId).toBe("c-secret");
    expect(callsTo(requestMock, "mutation JoinChannel")).toHaveLength(0);
  });

  /** The relay on, answering `requests` as the pending ones, with `ws-1` a workspace here. */
  function serveRequests(requests: unknown[]) {
    useRelayStore
      .getState()
      .setStarted(
        { serverId: "rims1_relay", roles: ["host", "relay"], directSpaceId: "direct-1" },
        { endpoint: "e", userId: "me", principalId: "rimp1_me", deviceId: "d1" },
        [],
      );
    routeRequests(requestMock, {
      ...baseReadHandlers,
      "query Channels": () => page([general]),
      "query DmRequests": () => ({ dmRequests: requests }),
    });
    const qc = renderList();
    qc.setQueryData(queryKeys.myServers(), [{ id: "ws-1" }, { id: "direct-1" }]);
    return qc;
  }

  it("heads its conversations with this workspace's requests, which open in the main area", async () => {
    serveRequests([
      makeDmRequest("r1", "rims1_relay", "ws-1"),
      makeDmRequest("r2", "rims1_relay", "direct-1"),
    ]);
    const row = await screen.findByRole("button", { name: "Requests (1)" });
    expect(within(screen.getByText("Conversations").parentElement!).getByRole("button")).toBe(row);
    await userEvent.setup().click(row);
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "dm-requests",
      workspaceId: "ws-1",
    });
  });

  it("shows no requests row while only requests from outside the workspace wait", async () => {
    const qc = serveRequests([makeDmRequest("r2", "rims1_relay", "direct-1")]);
    await screen.findByText("general");
    await waitFor(() =>
      expect(qc.getQueryData(queryKeys.dmRequests(DmRequestStatus.PENDING))).toHaveLength(1),
    );
    expect(screen.queryByRole("button", { name: /^Requests/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Conversations")).not.toBeInTheDocument();
  });
});

describe("ConversationList — guest gate", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-general" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
  });

  function serveAs(role: ServerMemberRoleGql, joined = [general]) {
    routeRequests(requestMock, {
      ...baseReadHandlers,
      "query Server(": () => ({ server: { id: "ws-1", name: "Acme", viewerRole: role } }),
      "query Channels": () => page(joined),
      "query InboxConversations": () => ({
        inboxConversations: { items: [], pageInfo: { hasNext: false, hasPrev: false } },
      }),
    });
  }

  it("hides Browse channels and New channel from a guest", async () => {
    serveAs(ServerMemberRoleGql.GUEST);
    const qc = renderList();
    await screen.findByText("general");
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
    expect(screen.queryByRole("button", { name: "Browse channels" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New channel" })).not.toBeInTheDocument();
  });

  it("tells a guest with no channels that a member can add them, without a browse link", async () => {
    serveAs(ServerMemberRoleGql.GUEST, []);
    const qc = renderList();
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
    expect(
      await screen.findByText("No channels yet. A member can add you to one."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Browse channels/)).not.toBeInTheDocument();
  });

  it("keeps Browse channels and New channel for a member", async () => {
    serveAs(ServerMemberRoleGql.MEMBER);
    const qc = renderList();
    await screen.findByText("general");
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
    expect(screen.getByRole("button", { name: "Browse channels" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New channel" })).toBeInTheDocument();
  });

  it("shows no New channel button to a member of the default workspace, and one to its owner", async () => {
    serveAs(ServerMemberRoleGql.MEMBER);
    const memberQc = renderList("ws-1");
    await screen.findByText("general");
    await waitFor(() => expect(memberQc.getQueryData(queryKeys.server("ws-1"))).toBeDefined());
    expect(screen.getByRole("button", { name: "Browse channels" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New channel" })).not.toBeInTheDocument();
    cleanup();

    serveAs(ServerMemberRoleGql.OWNER);
    renderList("ws-1");
    expect(await screen.findByRole("button", { name: "New channel" })).toBeInTheDocument();
  });
});

describe("ConversationList — navigation drawer", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
    useShellStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
    useShellStore.getState().reset();
  });

  it("closes the drawer when the conversation already open is chosen again", async () => {
    serve();
    useShellStore.setState({ selectedConversationId: "c-general", navDrawerOpen: true });
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByText("general"));
    expect(useShellStore.getState().navDrawerOpen).toBe(false);
  });

  it("does not close the drawer when the first conversation opens by itself", async () => {
    serve();
    useShellStore.setState({ selectedConversationId: null, navDrawerOpen: true });
    renderList();

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-general"));
    expect(useShellStore.getState().navDrawerOpen).toBe(true);
  });

  it("opens the first conversation with no list mounted", async () => {
    serve();
    useShellStore.setState({ selectedConversationId: null });
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <ConversationSelectionRuntime />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(useShellStore.getState().selectedConversationId).toBe("c-general"));
  });
});

describe("ConversationList — the commands its controls run", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(runCommandFromClick).mockClear();
    useShellStore.getState().reset();
    useShellStore.setState({ selectedConversationId: "c-general" });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useAuthStore.setState({ session: { userId: "me" } });
  });

  afterEach(() => {
    useConversationDialogStore.getState().closeBrowseChannels();
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
    useWorkspaceStore.setState({ workspaceId: null });
    useAuthStore.setState({ session: null });
  });

  it("opens Unreads, Browse channels and New channel through their commands, on this device", async () => {
    const user = userEvent.setup();
    serve();
    useUnreadStore.getState().setCounts("ws-1", { "c-secret": 2 });
    renderList();

    await user.click(await screen.findByRole("button", { name: /^Unreads/ }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "unreads" });
    await user.click(screen.getByRole("button", { name: "Browse channels" }));
    expect(await screen.findByRole("dialog", { name: "Browse channels" })).toBeInTheDocument();
    act(() => useConversationDialogStore.getState().closeBrowseChannels());
    await user.click(await screen.findByRole("button", { name: "New channel" }));
    expect(useShellStore.getState()).toMatchObject({
      showNewChannelDialog: true,
      mainSurface: { kind: "conversation" },
    });

    expect(vi.mocked(runCommandFromClick).mock.calls).toEqual([
      ["workspace.open_unreads", undefined, { source: "button" }],
      ["chat.browse_channels", undefined, { source: "button" }],
      ["chat.create_channel", undefined, { source: "button" }],
    ]);
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toEqual([]);
  });

  it("runs the Channels header menu's items as menu commands", async () => {
    serve();
    renderList();
    await screen.findByText("general");
    await waitFor(() => {
      fireEvent.contextMenu(screen.getByText("Channels"));
      expect(screen.getByRole("menuitem", { name: "Create channel…" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse channels…" }));
    fireEvent.contextMenu(screen.getByText("Channels"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create channel…" }));

    expect(vi.mocked(runCommandFromClick).mock.calls).toEqual([
      ["chat.browse_channels", undefined, { source: "menu" }],
      ["chat.create_channel", undefined, { source: "menu" }],
    ]);
    expect(await screen.findByRole("dialog", { name: "Browse channels" })).toBeInTheDocument();
  });
});
