import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";

import { expectReachableByKeyboard } from "../../test/keyboard";
import { useUnreadStore } from "../../features/conversations/state/useUnreadStore";
import { useQuickAccessStore } from "../../features/commands/state/useQuickAccessStore";
import { ServerMemberRoleGql } from "../../core/graphql/generated/schema-types";
import { queryKeys } from "../../core/query/keys";
import { callsTo, routeRequests } from "../../features/conversations/__fixtures__/conversations";

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

import { WorkspaceRail } from "./WorkspaceRail";

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("WorkspaceRail", () => {
  beforeEach(() => {
    myServers.data = alphaBeta;
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
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

  it("renders add workspace button", () => {
    renderWithQuery(<WorkspaceRail />);
    expect(screen.getByTitle("Add workspace")).toBeInTheDocument();
  });

  it("reaches every workspace and the add button by keyboard, and moves with the arrows", async () => {
    const user = userEvent.setup();
    renderWithQuery(<WorkspaceRail />);
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    const add = screen.getByRole("button", { name: "Add workspace" });
    await expectReachableByKeyboard(user, [alpha, beta, add]);
    expect(alpha).toHaveAttribute("aria-pressed", "true");

    alpha.focus();
    await user.keyboard("{ArrowDown}");
    expect(beta).toHaveFocus();
    await user.keyboard("{End}");
    expect(add).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(beta).toHaveFocus();
  });
});

describe("WorkspaceRail — workspace context menu", () => {
  function serve(role: ServerMemberRoleGql, dndPaused = false) {
    routeRequests(requestMock, {
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
      "mutation SetDoNotDisturb": (vars) => ({
        setDoNotDisturb: {
          serverId: vars.serverId,
          defaultLevel: "ALL",
          keywords: [],
          dnd: null,
          dndPaused: vars.paused,
          dndPausedUntil: vars.until ?? null,
          digest: "OFF",
        },
      }),
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

  it("gives the owner of another workspace its full menu, and acts there without switching", async () => {
    serve(ServerMemberRoleGql.OWNER);
    useUnreadStore.getState().setCounts("ws-2", { c2: 2 });
    await openBetaMenu();
    expect(menuLabels()).toEqual([
      "Mark all as read",
      "Pause notifications",
      "Browse channels…",
      "Workspace settings",
      "Invite people…",
      "Create channel…",
      "Assign keybind…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark all as read" }));
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation MarkAllAsRead")).toEqual([
        { input: { workspaceId: "ws-2" } },
      ]),
    );
    expect(useUnreadStore.getState().counts.c2 ?? 0).toBe(0);
    expect(setWorkspaceId).not.toHaveBeenCalled();
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
    await waitFor(() => expect(callsTo(requestMock, "mutation SetDoNotDisturb")).toHaveLength(1));
    expect(callsTo(requestMock, "mutation SetDoNotDisturb")[0]).toMatchObject({
      serverId: "ws-2",
      paused: true,
    });
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
    await waitFor(() =>
      expect(callsTo(requestMock, "mutation SetDoNotDisturb")).toEqual([
        { serverId: "ws-2", paused: false, until: null },
      ]),
    );
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

  it("hides browsing and creating channels from a guest", async () => {
    serve(ServerMemberRoleGql.GUEST);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    expect(useQuickAccessStore.getState().target).toEqual({
      kind: "workspace",
      workspaceId: "ws-2",
      label: "Beta",
    });
  });
});
