import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/utils";
import { expectReachableByKeyboard } from "../../test/keyboard";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useUnreadStore } from "../../features/conversations/state/useUnreadStore";
import { useShellStore } from "../state/useShellStore";
import type { PluginInfo } from "../../features/plugins/types";

const requestMock = vi.fn();

vi.mock("../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

// Unrelated SideRail dependencies — stubbed so only the rail itself is exercised.
vi.mock("../../features/workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: undefined }),
}));
const pluginList = vi.hoisted(() => ({ data: [] as PluginInfo[] }));
vi.mock("../../features/plugins/api/usePluginList", () => ({
  usePluginList: () => pluginList,
}));
vi.mock("../../features/auth/api/logout", () => ({
  logout: vi.fn(),
}));
vi.mock("../../features/commands/hooks/useKeybindLabel", () => ({
  useKeybindLabel: () => null,
}));
vi.mock("../../features/settings/components/StatusDropdown", () => ({
  StatusDropdown: () => null,
}));

import { SideRail } from "./SideRail";

describe("SideRail — keyboard", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("reaches every destination with Tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    await expectReachableByKeyboard(
      user,
      ["Inbox", "Plugins", "Search workspace", "Audit log", "Settings"].map((name) =>
        screen.getByRole("button", { name }),
      ),
    );
  });

  it("moves along the rail with the arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    const inbox = screen.getByRole("button", { name: "Inbox" });
    inbox.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Plugins" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(inbox).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: "User menu" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(inbox).toHaveFocus();
  });

  it("opens settings with Enter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    screen.getByRole("button", { name: "Settings" }).focus();
    await user.keyboard("{Enter}");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });
  });

  it("leaves the arrow keys to the user menu and gives focus back when it closes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    const avatar = screen.getByRole("button", { name: "User menu" });
    avatar.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu");
    expect(menu).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(menu).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(avatar).toHaveFocus();
  });

  it("asks whether to keep the account before signing out", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    await user.click(screen.getByRole("button", { name: "User menu" }));
    await user.click(screen.getByRole("menuitem", { name: /sign out/i }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Sign out" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out and remove from this device" }),
    ).toBeInTheDocument();
  });
});

describe("SideRail — unread", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    useUnreadStore.setState({ counts: {}, spaceOf: {} });
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("badges Inbox with the open workspace's unread and drops the badge once all are read", () => {
    useUnreadStore.getState().setCounts("srv-1", { c1: 2, c2: 1 });
    useUnreadStore.getState().setCounts("srv-2", { c3: 5 });
    renderWithProviders(<SideRail />);
    expect(screen.getByRole("button", { name: "Inbox (3 unread)" })).toHaveTextContent("3");

    act(() => {
      useUnreadStore.getState().markRead("c1");
      useUnreadStore.getState().markRead("c2");
    });
    expect(screen.getByRole("button", { name: "Inbox" })).toHaveTextContent("");
  });
});

function makePlugin(overrides: Partial<PluginInfo>): PluginInfo {
  return {
    plugin_id: "chat.rim.k8s-pods",
    manifest_id: "chat.rim.k8s-pods",
    display_name: "Kubernetes Pods",
    version: "1.0.0",
    description: "",
    enabled: true,
    health: "running",
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    ...overrides,
  };
}

describe("SideRail — plugin panels", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation(() => new Promise(() => {}));
    useShellStore.getState().reset();
    useWorkspaceStore.setState({ workspaceId: "srv-1" });
    pluginList.data = [
      makePlugin({
        panels: [
          { id: "pods", title: "Pods", slot: "main_area" },
          { id: "notes", title: "Notes" },
        ],
      }),
      makePlugin({
        plugin_id: "chat.rim.poll",
        manifest_id: "chat.rim.poll",
        display_name: "Poll",
        health: "stopped",
        panels: [{ id: "polls", title: "Polls" }],
      }),
      makePlugin({
        plugin_id: "chat.rim.releases",
        manifest_id: "chat.rim.releases",
        display_name: "Releases",
        enabled: false,
        panels: [{ id: "releases", title: "Releases" }],
      }),
    ];
  });

  afterEach(() => {
    pluginList.data = [];
    useWorkspaceStore.setState({ workspaceId: null });
  });

  const inbox = () => screen.getByRole("button", { name: "Inbox" });
  const plugins = () => screen.getByRole("button", { name: "Plugins" });
  const menu = () => screen.queryByRole("menu", { name: "Plugin panels" });
  const pods = () => screen.getByRole("menuitem", { name: "Kubernetes Pods: Pods" });
  const notes = () => screen.getByRole("menuitem", { name: "Kubernetes Pods: Notes" });

  it("draws no button per plugin panel in the rail", () => {
    renderWithProviders(<SideRail />);
    expect(screen.queryByRole("button", { name: /Kubernetes Pods/ })).not.toBeInTheDocument();
  });

  it("leaves the tool panel and the main surface alone when Plugins is clicked", async () => {
    const user = userEvent.setup();
    act(() => useShellStore.getState().setMainSurface({ kind: "settings" }));
    renderWithProviders(<SideRail />);
    await user.click(plugins());
    expect(useShellStore.getState().activePanel).toBe("inbox");
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings" });
  });

  it("lists the panels of running plugins when Plugins is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    expect(plugins()).toHaveAttribute("aria-haspopup", "menu");
    expect(plugins()).toHaveAttribute("aria-expanded", "false");

    await user.click(plugins());
    expect(menu()).toBeInTheDocument();
    expect(plugins()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Kubernetes PodsPods",
      "Kubernetes PodsNotes",
      "Manage plugins…",
    ]);
    expect(pods()).toBeInTheDocument();
    expect(notes()).toBeInTheDocument();
  });

  it("opens the chosen panel in its slot and closes the menu", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    await user.click(plugins());
    await user.click(pods());
    expect(useShellStore.getState().activePluginPanel).toEqual({
      pluginId: "chat.rim.k8s-pods",
      panelId: "pods",
      slot: "main_area",
    });
    expect(menu()).not.toBeInTheDocument();
  });

  it("marks the open panel in the menu", async () => {
    const user = userEvent.setup();
    act(() => useShellStore.getState().openPluginPanel("chat.rim.k8s-pods", "notes", "tool_panel"));
    renderWithProviders(<SideRail />);
    await user.click(plugins());
    expect(notes()).toHaveAttribute("aria-current", "true");
    expect(pods()).not.toHaveAttribute("aria-current");
  });

  it("opens with Enter, moves with the arrow keys and chooses with Enter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    plugins().focus();
    await user.keyboard("{Enter}");
    expect(menu()).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(useShellStore.getState().activePluginPanel).toEqual({
      pluginId: "chat.rim.k8s-pods",
      panelId: "notes",
      slot: "tool_panel",
    });
    expect(menu()).not.toBeInTheDocument();
    expect(plugins()).toHaveFocus();
  });

  it("opens with Space and closes on Escape, giving focus back to Plugins", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    plugins().focus();
    await user.keyboard(" ");
    expect(menu()).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(menu()).not.toBeInTheDocument();
    expect(plugins()).toHaveFocus();
    expect(useShellStore.getState().activePluginPanel).toBeNull();
  });

  it("closes on a click outside and on a second click on Plugins", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    await user.click(plugins());
    await user.click(document.body);
    expect(menu()).not.toBeInTheDocument();

    await user.click(plugins());
    expect(menu()).toBeInTheDocument();
    await user.click(plugins());
    expect(menu()).not.toBeInTheDocument();
  });

  it("points to the plugin settings when no running plugin has a panel", async () => {
    const user = userEvent.setup();
    pluginList.data = [makePlugin({ health: "crashed", panels: [{ id: "pods", title: "Pods" }] })];
    renderWithProviders(<SideRail />);
    await user.click(plugins());
    expect(screen.getByText("No running plugin has a panel.")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Manage plugins…" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "plugins" });
    expect(menu()).not.toBeInTheDocument();
  });

  it("lists only panels, then Manage plugins set apart, never a plugin's settings", async () => {
    const user = userEvent.setup();
    const setting = {
      key: "context",
      title: "Context",
      description: "",
      value_type: "string",
      is_secret: false,
    };
    pluginList.data = [
      makePlugin({ panels: [{ id: "pods", title: "Pods" }], settings_schema: [setting] }),
    ];
    renderWithProviders(<SideRail />);
    await user.click(plugins());
    expect(screen.getByText("Plugin panels")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Kubernetes PodsPods",
      "Manage plugins…",
    ]);
    expect(screen.getByRole("separator").nextElementSibling).toHaveTextContent("Manage plugins…");
  });

  it("marks Plugins instead of Inbox while a main-area panel covers the conversation", () => {
    renderWithProviders(<SideRail />);
    expect(inbox()).toHaveAttribute("aria-current", "page");
    expect(plugins()).not.toHaveAttribute("aria-current");

    act(() => useShellStore.getState().openPluginPanel("chat.rim.k8s-pods", "pods", "main_area"));
    expect(plugins()).toHaveAttribute("aria-current", "page");
    expect(inbox()).not.toHaveAttribute("aria-current");

    act(() => useShellStore.getState().setSelectedConversationId("c1"));
    expect(inbox()).toHaveAttribute("aria-current", "page");
    expect(plugins()).not.toHaveAttribute("aria-current");
  });

  it("closes a main-area panel when Inbox is chosen", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    await user.click(plugins());
    await user.click(pods());
    await user.click(inbox());
    expect(useShellStore.getState().activePluginPanel).toBeNull();
    expect(inbox()).toHaveAttribute("aria-current", "page");
    expect(plugins()).not.toHaveAttribute("aria-current");
  });

  it("marks Plugins beside Inbox for a tool-panel panel, and neither while settings cover them", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SideRail />);
    act(() => useShellStore.getState().openPluginPanel("chat.rim.k8s-pods", "notes", "tool_panel"));
    expect(plugins()).toHaveAttribute("aria-current", "page");
    expect(inbox()).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(plugins()).not.toHaveAttribute("aria-current");
    expect(inbox()).not.toHaveAttribute("aria-current");
  });
});
