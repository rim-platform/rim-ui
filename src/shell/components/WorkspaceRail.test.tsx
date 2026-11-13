import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { expectReachableByKeyboard } from "../../test/keyboard";
import { sendPendingMarkAll } from "../../features/conversations/api/useMarkAsRead";
import { useUnreadStore } from "../../features/conversations/state/useUnreadStore";
import { useQuickAccessStore } from "../../features/commands/state/useQuickAccessStore";
import { ServerMemberRoleGql } from "../../core/graphql/generated/schema-types";
import { queryKeys } from "../../core/query/keys";
import { callsTo, routeRequests } from "../../features/conversations/__fixtures__/conversations";
import { fakeServerInfo } from "../../test/serverInfo";
import { useWorkspaceActionStore } from "../../features/workspaces/state/useWorkspaceActionStore";
import { WORKSPACE_LEAVE, WORKSPACE_RENAME } from "../../features/updater/api/serverCapabilities";
import { CommandInitiator } from "../../core/graphql/generated/schema-types";
import { queryClient } from "../../core/query/queryClient";
import { useConversationDialogStore } from "../../features/conversations/state/useConversationDialogStore";
import {
  backendCommand,
  COMMAND_OK,
  paletteInput,
  serveHostCommands,
} from "../../test/clickCommands";

const DND = backendCommand("notifications.dnd", { title: "Do Not Disturb" });

/** The `notifications.dnd` runs sent. */
function dndRuns(): Record<string, unknown>[] {
  return callsTo(requestMock, "mutation ExecuteCommand").map(
    (vars) => vars.input as Record<string, unknown>,
  );
}

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));
vi.mock("../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

// Mock the hooks that WorkspaceRail uses
const setWorkspaceId = vi.hoisted(() => vi.fn());
vi.mock("../../features/workspaces/state/useWorkspaceStore", () => ({
  useWorkspaceStore: Object.assign(
    vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
      sel({ workspaceId: "ws-1", setWorkspaceId }),
    ),
    { getState: () => ({ workspaceId: "ws-1", setWorkspaceId }) },
  ),
}));

const alphaBeta = [
  { id: "ws-1", name: "Alpha", owner: { id: "u-1", username: "alice", displayName: "Alice" } },
  { id: "ws-2", name: "Beta", owner: { id: "u-2", username: "bob", displayName: null } },
];
const myServers = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock("../../features/workspaces/api/useMyServers", () => ({
  useMyServers: () => myServers,
}));

vi.mock("../../features/workspaces/components/AddWorkspaceDialog", () => ({
  AddWorkspaceDialog: () => null,
}));

vi.mock("../../features/commands/runtime/runFromClick", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../features/commands/runtime/runFromClick")>();
  return { ...actual, runCommandFromClick: vi.fn(actual.runCommandFromClick) };
});

import { runCommandFromClick } from "../../features/commands/runtime/runFromClick";
import { useRelayStore } from "../../features/relay/state/useRelayStore";
import { useShellStore } from "../state/useShellStore";
import { AppCommandDialogs } from "../../features/commands/components/AppCommandDialogs";
import { useAppDialogStore } from "../../features/commands/state/useAppDialogStore";
import { WorkspaceRail } from "./WorkspaceRail";

/** Renders with the viewer's role in ws-1 already known; an Owner unless `role` says otherwise. */
function renderWithQuery(
  ui: React.ReactElement,
  role: ServerMemberRoleGql | undefined = ServerMemberRoleGql.OWNER,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.server("ws-1"), { id: "ws-1", name: "Alpha", viewerRole: role });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("WorkspaceRail", () => {
  beforeEach(() => {
    myServers.data = alphaBeta;
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
  });

  it("shows one whole letter for a workspace whose name starts with an emoji", () => {
    myServers.data = [
      { id: "ws-1", name: "\u{1F680} Botland", owner: null },
      { id: "ws-2", name: "\u{1F680}", owner: null },
    ];
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByRole("button", { name: "\u{1F680} Botland" })).toHaveTextContent(/^B$/);
    expect(screen.getByRole("button", { name: "\u{1F680}" })).toHaveTextContent(/^\?$/);
  });

  it("badges another workspace with its unread messages and not the open one", () => {
    useUnreadStore.getState().setCounts("ws-1", { c1: 4 });
    useUnreadStore.getState().setCounts("ws-2", { c2: 2, c3: 1 });
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveTextContent(/^A$/);
    expect(screen.getByRole("button", { name: "Beta (3 unread)" })).toHaveTextContent("B3");
  });

  it("adds the owner to a workspace's title only when another one shares its name", () => {
    myServers.data = [...alphaBeta, { ...alphaBeta[1], id: "ws-3", name: "alpha" }];
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByRole("button", { name: "Alpha (Alice)" })).toHaveAttribute(
      "title",
      "Alpha (Alice)",
    );
    expect(screen.getByTitle("alpha (bob)")).toBeInTheDocument();
    expect(screen.getByTitle("Beta")).toBeInTheDocument();
  });

  it("renders workspace buttons for each server", () => {
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByTitle("Alpha")).toBeInTheDocument();
    expect(screen.getByTitle("Beta")).toBeInTheDocument();
  });

  it("renders first letter of workspace name", () => {
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByTitle("Alpha")).toHaveTextContent("A");
    expect(screen.getByTitle("Beta")).toHaveTextContent("B");
  });

  it("opens Home from the first button of the rail, which is current while Home is open", async () => {
    const user = userEvent.setup();
    useShellStore.getState().reset();
    renderWithQuery(<WorkspaceRail />);
    const home = screen.getByRole("button", { name: "Home" });
    expect(screen.getAllByRole("button")[0]).toBe(home);
    expect(home).not.toHaveAttribute("aria-current");
    await user.click(home);
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "home" });
    expect(home).toHaveAttribute("aria-current", "page");
    useShellStore.getState().reset();
  });

  it("leaves Home when a workspace is chosen", async () => {
    const user = userEvent.setup();
    useShellStore.getState().setMainSurface({ kind: "home" });
    renderWithQuery(<WorkspaceRail />);
    await user.click(screen.getByRole("button", { name: "Beta" }));
    expect(setWorkspaceId).toHaveBeenCalledWith("ws-2");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
  });

  it("badges Home with the mentions and replies waiting across the workspaces", async () => {
    useShellStore.getState().reset();
    routeRequests(requestMock, {
      "query MyNotifications": (vars) => ({
        myNotifications: {
          items: [
            {
              id: `n-${vars.serverId}`,
              serverId: vars.serverId,
              conversationId: "c1",
              messageId: "m1",
              reason: "MENTION",
              createdAt: "2026-11-06T10:00:00Z",
              readAt: null,
              conversation: null,
              message: null,
            },
          ],
          next: null,
          pageInfo: { hasNext: false },
        },
      }),
    });
    renderWithQuery(<WorkspaceRail />);
    expect(
      await screen.findByRole("button", { name: "Home (2 mentions and replies)" }),
    ).toHaveTextContent("2");
  });

  describe("current button", () => {
    const dmInfo = { directSpaceId: "ws-1" } as never;
    beforeEach(() => {
      setWorkspaceId.mockClear();
      useShellStore.getState().reset();
      useRelayStore.setState({ info: null });
    });
    afterEach(() => {
      useShellStore.getState().reset();
      useRelayStore.setState({ info: null });
    });

    it("highlights only Home on Home while a workspace is selected", () => {
      useShellStore.getState().setMainSurface({ kind: "home" });
      renderWithQuery(<WorkspaceRail />);
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute("aria-pressed", "false");
    });

    it("highlights only Home on Home while Direct messages is selected", () => {
      useRelayStore.setState({ info: dmInfo });
      useShellStore.getState().setMainSurface({ kind: "home" });
      renderWithQuery(<WorkspaceRail />);
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("button", { name: "Direct messages" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("highlights nothing on Unreads", () => {
      useRelayStore.setState({ info: dmInfo });
      useShellStore.getState().setMainSurface({ kind: "unreads" });
      renderWithQuery(<WorkspaceRail />);
      expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
      for (const name of ["Direct messages", "Alpha", "Beta"]) {
        expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
      }
    });

    it("keeps the open workspace highlighted on Settings", () => {
      useShellStore.getState().setMainSurface({ kind: "settings" });
      renderWithQuery(<WorkspaceRail />);
      expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
    });

    it("leaves Home when the selected workspace is clicked again", async () => {
      const user = userEvent.setup();
      useShellStore.getState().setMainSurface({ kind: "home" });
      renderWithQuery(<WorkspaceRail />);
      await user.click(screen.getByRole("button", { name: "Alpha" }));
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
      expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-pressed", "true");
    });

    it("leaves Home when Direct messages is clicked while selected", async () => {
      const user = userEvent.setup();
      useRelayStore.setState({ info: dmInfo });
      useShellStore.getState().setMainSurface({ kind: "home" });
      renderWithQuery(<WorkspaceRail />);
      await user.click(screen.getByRole("button", { name: "Direct messages" }));
      expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
      expect(screen.getByRole("button", { name: "Direct messages" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  it("renders add workspace button", () => {
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByTitle("Add workspace")).toBeInTheDocument();
  });

  it("reaches every workspace, the add button and the foot by keyboard, and moves with the arrows", async () => {
    const user = userEvent.setup();
    renderWithQuery(<WorkspaceRail />);
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    const add = screen.getByRole("button", { name: "Add workspace" });
    const audit = screen.getByRole("button", { name: "Audit log" });
    const settings = screen.getByRole("button", { name: "Settings" });
    const account = screen.getByRole("button", { name: "User menu" });
    await expectReachableByKeyboard(user, [alpha, beta, add, audit, settings, account]);
    expect(alpha).toHaveAttribute("aria-pressed", "true");

    alpha.focus();
    await user.keyboard("{ArrowDown}");
    expect(beta).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(add).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(audit).toHaveFocus();
    await user.keyboard("{End}");
    expect(account).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(settings).toHaveFocus();
  });
});

describe("WorkspaceRail — audit log, Settings and the account", () => {
  const dmInfo = { directSpaceId: "ws-1" } as never;
  beforeEach(() => {
    myServers.data = alphaBeta;
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    useShellStore.getState().reset();
    useRelayStore.setState({ info: null });
  });
  afterEach(() => {
    useShellStore.getState().reset();
    useRelayStore.setState({ info: null });
  });

  const footer = () =>
    ["Audit log", "Settings", "User menu"].filter((name) => screen.queryByRole("button", { name }));

  it("puts the audit log, Settings and the account last, after Add workspace", () => {
    renderWithQuery(<WorkspaceRail />);
    const names = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(names.slice(-4)).toEqual(["Add workspace", "Audit log", "Settings", "User menu"]);
  });

  it("shows the audit log while a workspace is open, on its pages too", () => {
    renderWithQuery(<WorkspaceRail />);
    expect(footer()).toEqual(["Audit log", "Settings", "User menu"]);
    act(() => useShellStore.getState().setMainSurface({ kind: "settings" }));
    expect(footer()).toEqual(["Audit log", "Settings", "User menu"]);
  });

  it("shows the audit log to an Owner and a Moderator, with its tooltip name", () => {
    for (const role of [ServerMemberRoleGql.OWNER, ServerMemberRoleGql.MODERATOR]) {
      const { unmount } = renderWithQuery(<WorkspaceRail />, role);
      expect(screen.getByRole("button", { name: "Audit log" })).toBeInTheDocument();
      unmount();
    }
  });

  it("leaves the audit log out for a Member and a Guest", () => {
    for (const role of [ServerMemberRoleGql.MEMBER, ServerMemberRoleGql.GUEST]) {
      const { unmount } = renderWithQuery(<WorkspaceRail />, role);
      expect(footer()).toEqual(["Settings", "User menu"]);
      unmount();
    }
  });

  it("leaves the audit log out on Home, on Unreads and in the direct space", () => {
    useShellStore.getState().setMainSurface({ kind: "home" });
    renderWithQuery(<WorkspaceRail />);
    expect(footer()).toEqual(["Settings", "User menu"]);
    act(() => useShellStore.getState().setMainSurface({ kind: "unreads" }));
    expect(footer()).toEqual(["Settings", "User menu"]);
    act(() => {
      useShellStore.getState().setMainSurface({ kind: "conversation" });
      useRelayStore.setState({ info: dmInfo });
    });
    expect(footer()).toEqual(["Settings", "User menu"]);
  });

  it("opens the audit log and Settings, and marks the one that is open", async () => {
    const user = userEvent.setup();
    renderWithQuery(<WorkspaceRail />);
    const audit = screen.getByRole("button", { name: "Audit log" });
    const settings = screen.getByRole("button", { name: "Settings" });
    await user.click(audit);
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "audit-log" });
    expect(audit).toHaveAttribute("aria-current", "page");
    expect(settings).not.toHaveAttribute("aria-current");

    settings.focus();
    await user.keyboard("{Enter}");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(audit).not.toHaveAttribute("aria-current");
  });

  it("opens the account menu, leaves the arrow keys to it and gives focus back when it closes", async () => {
    const user = userEvent.setup();
    renderWithQuery(<WorkspaceRail />);
    const account = screen.getByRole("button", { name: "User menu" });
    account.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu");
    expect(menu).toHaveFocus();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("Set status..."),
      expect.stringContaining("Settings"),
      expect.stringContaining("Sign out..."),
    ]);
    await user.keyboard("{ArrowDown}");
    expect(menu).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(account).toHaveFocus();
  });

  it("asks whether to keep the account before signing out", async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <>
        <WorkspaceRail />
        <AppCommandDialogs />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "User menu" }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(await screen.findByRole("dialog", { name: "Sign out" })).toBeInTheDocument();
    act(() => useAppDialogStore.getState().close());
  });
});

describe("WorkspaceRail — workspace context menu", () => {
  /** Renders with the app's query client, whose cache the menu's commands read. */
  function renderWithQuery(ui: React.ReactElement) {
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  }

  function serve(
    role: ServerMemberRoleGql,
    dndPaused = false,
    joinRequests = 0,
    defaultWorkspace?: string,
    capabilities: string[] = [],
  ) {
    serveHostCommands("ws-2", [DND]);
    routeRequests(requestMock, {
      "query ServerInfo": () => ({
        serverInfo: fakeServerInfo({}, { defaultWorkspace, capabilities }),
      }),
      "query JoinRequestCount": () => ({
        joinRequests: {
          items: Array.from({ length: joinRequests }, (_, i) => ({ id: `jr-${i}` })),
          pageInfo: { hasNext: false, hasPrev: false },
        },
      }),
      "query Server(": (vars) => ({
        server: { id: vars.serverId, name: "Beta", viewerRole: role },
      }),
      "query MyNotificationSettings": (vars) => ({
        myNotificationSettings: {
          serverId: vars.serverId,
          defaultLevel: "ALL",
          keywords: [],
          dnd: null,
          dndPaused,
          dndPausedUntil: null,
          digest: "OFF",
        },
      }),
      "mutation MarkAllAsRead": () => ({ markAllAsRead: true }),
      "mutation ExecuteCommand": () => ({ executeCommand: COMMAND_OK }),
    });
  }

  /** Points at Beta, which loads its role, and opens its menu once the role shows in it. */
  async function openBetaMenu() {
    renderWithQuery(<WorkspaceRail />);
    const beta = screen.getByRole("button", { name: /^Beta/ });
    fireEvent.mouseEnter(beta);
    await waitFor(() => {
      fireEvent.contextMenu(beta);
      expect(menuLabels()).toContain("Create channel…");
    });
    return beta;
  }

  function menuLabels(): string[] {
    return within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((el) => el.getAttribute("aria-label") ?? el.firstElementChild?.textContent ?? "");
  }

  beforeEach(() => {
    myServers.data = alphaBeta;
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
    requestMock.mockReset();
    setWorkspaceId.mockReset();
    useQuickAccessStore.getState().close();
  });

  afterEach(() => {
    queryClient.clear();
    useConversationDialogStore.setState({
      browseChannelsIn: null,
      inviteTo: null,
      createChannelIn: null,
    });
  });

  it("gives the owner of another workspace its full menu, and acts there without switching", async () => {
    serve(ServerMemberRoleGql.OWNER);
    useUnreadStore.getState().setCounts("ws-2", { c2: 2 });
    await openBetaMenu();
    expect(menuLabels()).toEqual([
      "Mark all as read",
      "Pause notifications",
      "Browse channels…",
      "Workspace settings",
      "Reports…",
      "Invite people…",
      "Create channel…",
      "Assign keybind…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark all as read" }));
    expect(useUnreadStore.getState().counts.c2 ?? 0).toBe(0);
    expect(callsTo(requestMock, "mutation MarkAllAsRead")).toEqual([]);
    sendPendingMarkAll();
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation MarkAllAsRead")).toEqual([
        { input: { workspaceId: "ws-2" } },
      ]),
    );
    expect(setWorkspaceId).not.toHaveBeenCalled();
  });

  it("opens the selected workspace's reports from its menu", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openBetaMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Reports…" }));
    await waitFor(() => expect(setWorkspaceId).toHaveBeenCalledWith("ws-2"));
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "settings",
      tab: "workspace-moderation",
    });
  });

  it("offers a moderator the open join requests with their number", async () => {
    serve(ServerMemberRoleGql.MODERATOR, false, 2);
    const beta = await openBetaMenu();
    await waitFor(() => {
      fireEvent.contextMenu(beta);
      expect(menuLabels()).toContain("Join requests…: 2 waiting");
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Join requests…: 2 waiting" }));
    await waitFor(() => expect(setWorkspaceId).toHaveBeenCalledWith("ws-2"));
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "settings",
      tab: "workspace-moderation",
    });
  });

  it("lists the open workspace's join requests on the first right-click", async () => {
    serve(ServerMemberRoleGql.MODERATOR, false, 2);
    renderWithQuery(<WorkspaceRail />);
    // Alpha is the open workspace; it is never pointed at before its menu opens.
    const alpha = screen.getByRole("button", { name: /^Alpha/ });
    await waitFor(() => expect(callsTo(requestMock, "query JoinRequestCount")).toHaveLength(1));
    await act(async () => {});

    fireEvent.contextMenu(alpha);
    expect(menuLabels()).toContain("Join requests…: 2 waiting");
  });

  it("leaves join requests out of the menu while none are open", async () => {
    serve(ServerMemberRoleGql.MODERATOR);
    await openBetaMenu();
    await waitFor(() =>
      expect(callsTo(requestMock, "query JoinRequestCount")).toContainEqual(
        expect.objectContaining({ serverId: "ws-2" }),
      ),
    );
    expect(menuLabels().some((label) => label.startsWith("Join requests"))).toBe(false);
  });

  it("pauses that workspace's notifications for an hour", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openBetaMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Pause notifications" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Pause notifications" })).getByRole("menuitem", {
        name: "For 1 hour",
      }),
    );
    await waitFor(() => expect(dndRuns()).toHaveLength(1));
    const sent = dndRuns()[0];
    expect(sent).toMatchObject({
      commandId: "notifications.dnd",
      args: { mode: "until" },
      commandContext: { workspaceId: "ws-2" },
      initiator: CommandInitiator.CONTEXT_MENU,
    });
    const { initiator: _initiator, ...input } = sent;
    expect(input).toEqual(
      await paletteInput(
        DND,
        sent.commandContext as Record<string, unknown>,
        sent.args as Record<string, unknown>,
      ),
    );
    expect(setWorkspaceId).not.toHaveBeenCalled();
  });

  it("offers Resume notifications while paused", async () => {
    serve(ServerMemberRoleGql.MEMBER, true);
    await openBetaMenu();
    await waitFor(() => {
      fireEvent.contextMenu(screen.getByRole("button", { name: /^Beta/ }));
      expect(menuLabels()).toContain("Resume notifications");
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume notifications" }));
    await waitFor(() => expect(dndRuns()).toHaveLength(1));
    expect(dndRuns()[0]).toMatchObject({
      args: { mode: "off" },
      commandContext: { workspaceId: "ws-2" },
    });
  });

  it("opens that workspace's channel, invite and new-channel dialogs without switching", async () => {
    serve(ServerMemberRoleGql.OWNER);
    const beta = await openBetaMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse channels…" }));
    await waitFor(() =>
      expect(useConversationDialogStore.getState().browseChannelsIn).toBe("ws-2"),
    );
    useConversationDialogStore.getState().closeBrowseChannels();

    fireEvent.contextMenu(beta);
    fireEvent.click(screen.getByRole("menuitem", { name: "Invite people…" }));
    await waitFor(() => expect(useConversationDialogStore.getState().inviteTo).toBe("ws-2"));
    useConversationDialogStore.getState().closeInvite();

    fireEvent.contextMenu(beta);
    fireEvent.click(screen.getByRole("menuitem", { name: "Create channel…" }));
    await waitFor(() => expect(useConversationDialogStore.getState().createChannelIn).toBe("ws-2"));
    expect(setWorkspaceId).not.toHaveBeenCalled();
  });

  it("gives a member no invite or settings, and a guest no channels either", async () => {
    serve(ServerMemberRoleGql.MEMBER);
    await openBetaMenu();
    expect(menuLabels()).toEqual([
      "Pause notifications",
      "Browse channels…",
      "Create channel…",
      "Assign keybind…",
    ]);
  });

  it("gives a member of the default workspace no Create channel", async () => {
    serve(ServerMemberRoleGql.MEMBER, false, 0, "ws-2");
    const qc = queryClient;
    render(
      <QueryClientProvider client={qc}>
        <WorkspaceRail />
      </QueryClientProvider>,
    );
    const beta = screen.getByRole("button", { name: /^Beta/ });
    fireEvent.mouseEnter(beta);
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-2"))).toBeDefined());
    await waitFor(() => expect(qc.getQueryData(queryKeys.serverInfo)).toBeDefined());
    await act(async () => {});
    fireEvent.keyDown(beta, { key: "ContextMenu" });
    expect(menuLabels()).toEqual(["Pause notifications", "Browse channels…", "Assign keybind…"]);
  });

  /** Opens Beta's menu once its role and the server's capabilities are cached. */
  async function openBetaMenuWithCapabilities() {
    const qc = queryClient;
    render(
      <QueryClientProvider client={qc}>
        <WorkspaceRail />
      </QueryClientProvider>,
    );
    const beta = screen.getByRole("button", { name: /^Beta/ });
    fireEvent.mouseEnter(beta);
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-2"))).toBeDefined());
    await waitFor(() => expect(qc.getQueryData(queryKeys.serverInfo)).toBeDefined());
    await act(async () => {});
    fireEvent.keyDown(beta, { key: "ContextMenu" });
  }

  it("offers a member Leave workspace last on a server that supports it", async () => {
    serve(ServerMemberRoleGql.MEMBER, false, 0, undefined, [WORKSPACE_LEAVE, WORKSPACE_RENAME]);
    useWorkspaceActionStore.setState({ action: null });
    await openBetaMenuWithCapabilities();
    expect(menuLabels()).toEqual([
      "Pause notifications",
      "Browse channels…",
      "Create channel…",
      "Assign keybind…",
      "Leave workspace…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Leave workspace…" }));
    await waitFor(() => expect(useWorkspaceActionStore.getState().action).not.toBeNull());
    expect(useWorkspaceActionStore.getState().action).toEqual({
      kind: "leave",
      workspaceId: "ws-2",
    });
  });

  it("fills in an open menu when the workspace's role arrives", async () => {
    serve(ServerMemberRoleGql.MEMBER, false, 0, undefined, [WORKSPACE_LEAVE]);
    const routed = requestMock.getMockImplementation()!;
    let answerRole!: () => void;
    requestMock.mockImplementation((document: unknown, ...rest: unknown[]) => {
      if (String(document).includes("query Server(")) {
        return new Promise((resolve) => {
          answerRole = () =>
            resolve({ server: { id: "ws-2", name: "Beta", viewerRole: "MEMBER" } });
        });
      }
      return routed(document, ...rest);
    });
    renderWithQuery(<WorkspaceRail />);
    const beta = screen.getByRole("button", { name: /^Beta/ });
    fireEvent.mouseEnter(beta);
    fireEvent.contextMenu(beta);
    expect(menuLabels()).toEqual(["Pause notifications", "Assign keybind…"]);
    await act(async () => answerRole());
    await waitFor(() =>
      expect(menuLabels()).toEqual([
        "Pause notifications",
        "Browse channels…",
        "Create channel…",
        "Assign keybind…",
        "Leave workspace…",
      ]),
    );
  });

  it("offers the owner Rename workspace and no Leave", async () => {
    serve(ServerMemberRoleGql.OWNER, false, 0, undefined, [WORKSPACE_LEAVE, WORKSPACE_RENAME]);
    await openBetaMenuWithCapabilities();
    const labels = menuLabels();
    expect(labels[labels.indexOf("Create channel…") + 1]).toBe("Rename workspace…");
    expect(labels).not.toContain("Leave workspace…");
  });

  it("offers no Leave in the default workspace", async () => {
    serve(ServerMemberRoleGql.MEMBER, false, 0, "ws-2", [WORKSPACE_LEAVE, WORKSPACE_RENAME]);
    await openBetaMenuWithCapabilities();
    expect(menuLabels()).not.toContain("Leave workspace…");
  });

  it("offers neither on a server without the capabilities", async () => {
    for (const role of [ServerMemberRoleGql.OWNER, ServerMemberRoleGql.MEMBER]) {
      serve(role);
      await openBetaMenuWithCapabilities();
      const labels = menuLabels();
      expect(labels).not.toContain("Leave workspace…");
      expect(labels).not.toContain("Rename workspace…");
      cleanup();
    }
  });

  it("hides browsing and creating channels from a guest", async () => {
    serve(ServerMemberRoleGql.GUEST);
    const qc = queryClient;
    render(
      <QueryClientProvider client={qc}>
        <WorkspaceRail />
      </QueryClientProvider>,
    );
    const beta = screen.getByRole("button", { name: /^Beta/ });
    fireEvent.mouseEnter(beta);
    await waitFor(() => expect(qc.getQueryData(queryKeys.server("ws-2"))).toBeDefined());
    await act(async () => {});
    fireEvent.keyDown(beta, { key: "ContextMenu" });
    expect(menuLabels()).toEqual(["Pause notifications", "Assign keybind…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Assign keybind…" }));
    await waitFor(() => expect(useQuickAccessStore.getState().target).not.toBeNull());
    expect(useQuickAccessStore.getState().target).toEqual({
      kind: "workspace",
      workspaceId: "ws-2",
      label: "Beta",
    });
  });
});

describe("WorkspaceRail — the commands its buttons run", () => {
  const dmInfo = { directSpaceId: "ws-dm" } as never;
  beforeEach(() => {
    myServers.data = alphaBeta;
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    setWorkspaceId.mockClear();
    vi.mocked(runCommandFromClick).mockClear();
    useShellStore.getState().reset();
    useRelayStore.setState({ info: dmInfo });
  });
  afterEach(() => {
    act(() => useAppDialogStore.getState().close());
    useShellStore.getState().reset();
    useRelayStore.setState({ info: null });
  });

  it("opens Home, the direct messages, Add a workspace, the audit log and Settings through their commands", async () => {
    const user = userEvent.setup();
    renderWithQuery(<WorkspaceRail />);

    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "home" });
    await user.click(screen.getByRole("button", { name: "Direct messages" }));
    expect(setWorkspaceId).toHaveBeenCalledWith("ws-dm");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
    await user.click(screen.getByRole("button", { name: "Add workspace" }));
    expect(useAppDialogStore.getState().dialog).toBe("addWorkspace");
    await user.click(screen.getByRole("button", { name: "Audit log" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "audit-log" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });

    expect(vi.mocked(runCommandFromClick).mock.calls).toEqual([
      ["workspace.open_home"],
      ["workspace.open_direct_messages"],
      ["workspace.add"],
      ["workspace.open_audit_log"],
      ["workspace.open_settings"],
    ]);
    expect(callsTo(requestMock, "mutation ExecuteCommand")).toEqual([]);
  });

  it("runs the account menu's items as menu commands, opening the status menu by the avatar", async () => {
    const user = userEvent.setup();
    renderWithQuery(<WorkspaceRail />);
    const account = screen.getByRole("button", { name: "User menu" });

    await user.click(account);
    await user.click(screen.getByRole("menuitem", { name: /set status/i }));
    expect(useAppDialogStore.getState()).toMatchObject({
      dialog: "status",
      statusAt: { x: expect.any(Number), y: expect.any(Number) },
    });
    act(() => useAppDialogStore.getState().close());

    await user.click(account);
    await user.click(screen.getByRole("menuitem", { name: /settings/i }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });

    await user.click(account);
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));
    expect(useAppDialogStore.getState().dialog).toBe("signOut");

    expect(vi.mocked(runCommandFromClick).mock.calls).toEqual([
      ["people.set_status", undefined, { source: "menu" }],
      ["workspace.open_settings", undefined, { source: "menu" }],
      ["app.sign_out", undefined, { source: "menu" }],
    ]);
  });
});
