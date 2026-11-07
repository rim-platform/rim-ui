import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/utils";
import { expectReachableByKeyboard } from "../../test/keyboard";
import { getRuntimeCapabilities, type OsType } from "../../core/runtime/runtime";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useRelayStore } from "../../features/relay/state/useRelayStore";
import { useSearchOverlayStore } from "../../features/messages/state/useSearchOverlayStore";
import { useNotificationsPanelStore } from "../../features/notifications/state/useNotificationsPanelStore";
import type { PluginInfo } from "../../features/plugins/types";
import { useShellStore } from "../state/useShellStore";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => requestMock(...args) },
}));

const runtime = vi.hoisted(() => ({ customTitleBar: false, osType: "linux" as OsType }));
vi.mock("../../core/runtime/RuntimeProvider", () => ({
  RuntimeProvider: ({ children }: { children: React.ReactNode }) => children,
  useRuntime: () => ({
    platform: runtime.customTitleBar ? "desktop" : "web",
    capabilities: {
      ...getRuntimeCapabilities(runtime.customTitleBar ? "desktop" : "web"),
      customTitleBar: runtime.customTitleBar,
    },
    osType: runtime.osType,
    deviceKeyStore: "none",
  }),
}));

const pluginList = vi.hoisted(() => ({ data: [] as PluginInfo[] }));
vi.mock("../../features/plugins/api/usePluginList", () => ({
  usePluginList: () => pluginList,
}));

const keystrokes = vi.hoisted(() => ({ search: "Ctrl+Shift+F" as string | null }));
vi.mock("../../features/commands/hooks/useKeybindLabel", () => ({
  useKeybindLabel: (commandId: string) =>
    commandId === "workspace.open_search" ? keystrokes.search : null,
}));

const myServers = vi.hoisted(() => ({
  data: [{ id: "ws-1", name: "RIM Development", owner: null }] as {
    id: string;
    name: string;
    owner: null;
  }[],
}));
vi.mock("../../features/workspaces/api/useMyServers", () => ({
  useMyServers: () => myServers,
}));

vi.mock("../../features/notifications/components/NotificationsPanel", () => ({
  NotificationsPanel: () => <p>Notification inbox</p>,
}));

import { SEARCH_BOX_NAME, TopBar } from "./TopBar";

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
    approved_capabilities: ["ui.panel"],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    ...overrides,
  };
}

const withPanels = () => [
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
];

const topBar = () => screen.getByRole("banner", { name: "Top bar" });
const searchBox = () => within(topBar()).getByRole("button", { name: /or run a command/ });
const plugins = () => screen.getByRole("button", { name: "Plugins" });
const pluginMenu = () => screen.queryByRole("menu", { name: "Plugin panels" });

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(() => new Promise(() => {}));
  useShellStore.getState().reset();
  useShellStore.setState({ shellWidth: "wide" });
  useWorkspaceStore.setState({ workspaceId: "ws-1" });
  useRelayStore.setState({ info: null, spaces: {} });
  useSearchOverlayStore.getState().close();
  useNotificationsPanelStore.setState({ open: false });
  runtime.customTitleBar = false;
  runtime.osType = "linux";
  pluginList.data = [];
  keystrokes.search = "Ctrl+Shift+F";
  myServers.data = [{ id: "ws-1", name: "RIM Development", owner: null }];
});

afterEach(() => {
  useWorkspaceStore.setState({ workspaceId: null });
  useRelayStore.setState({ info: null, spaces: {} });
  useNotificationsPanelStore.setState({ open: false });
});

describe("TopBar — search box", () => {
  it("names the open workspace and shows the keystroke bound to search", () => {
    renderWithProviders(<TopBar />);
    expect(searchBox()).toHaveTextContent("Search RIM Development, or run a command");
    expect(within(searchBox()).getByText("Ctrl+Shift+F").tagName).toBe("KBD");
    expect(searchBox()).toHaveAttribute("aria-keyshortcuts", "Ctrl+Shift+F");
  });

  it("follows a keystroke the person rebound, and shows none when search has none", () => {
    keystrokes.search = "Ctrl+J";
    const { unmount } = renderWithProviders(<TopBar />);
    expect(searchBox()).toHaveTextContent("Ctrl+J");
    unmount();

    keystrokes.search = null;
    renderWithProviders(<TopBar />);
    expect(searchBox().querySelector("kbd")).toBeNull();
    expect(searchBox()).not.toHaveAttribute("aria-keyshortcuts");
  });

  it("says it searches the direct messages in the direct space", () => {
    useRelayStore.setState({ info: { directSpaceId: "ws-1" } as never });
    renderWithProviders(<TopBar />);
    expect(searchBox()).toHaveTextContent("Search your direct messages, or run a command");
  });

  it("says it searches everything on Home and on Unreads", () => {
    useShellStore.getState().setMainSurface({ kind: "home" });
    renderWithProviders(<TopBar />);
    expect(searchBox()).toHaveTextContent("Search everything, or run a command");
    act(() => useShellStore.getState().setMainSurface({ kind: "unreads" }));
    expect(searchBox()).toHaveTextContent("Search everything, or run a command");
    act(() => useShellStore.getState().setMainSurface({ kind: "settings" }));
    expect(searchBox()).toHaveTextContent("Search RIM Development, or run a command");
  });

  it("names a workspace on another server from its stored space", () => {
    useWorkspaceStore.setState({ workspaceId: "remote-1" });
    useRelayStore.setState({
      spaces: { "remote-1": { spaceId: "remote-1", kind: "workspace", name: "Pixel Guild" } },
    } as never);
    renderWithProviders(<TopBar />);
    expect(searchBox()).toHaveTextContent("Search Pixel Guild, or run a command");
  });

  it("shows hidden characters in a workspace's name and cuts a long one with an ellipsis", () => {
    myServers.data = [{ id: "ws-1", name: "Team‮evil", owner: null }];
    renderWithProviders(<TopBar />);
    expect(searchBox()).toHaveTextContent("Search Team⟦U+202E⟧evil, or run a command");
    expect(within(searchBox()).getByText(/Search Team/).className).toContain("truncate");
  });

  it("keeps the short accessible name for its icon-only form below 400 px", () => {
    renderWithProviders(<TopBar />);
    const short = within(searchBox()).getByText(SEARCH_BOX_NAME);
    expect(short.className).toContain("sr-only");
    expect(short.className).toContain("min-[400px]:hidden");
    expect(within(searchBox()).getByText(/Search RIM/).className).toContain("max-[399px]:hidden");
  });

  it("opens search when clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TopBar />);
    await user.click(searchBox());
    expect(useSearchOverlayStore.getState()).toMatchObject({
      isOpen: true,
      scope: { kind: "all" },
    });
  });
});

describe("TopBar — Plugins", () => {
  beforeEach(() => {
    pluginList.data = withPanels();
  });

  it("is not shown while no running plugin has a panel", () => {
    pluginList.data = [makePlugin({ health: "crashed", panels: [{ id: "pods", title: "Pods" }] })];
    renderWithProviders(<TopBar />);
    expect(screen.queryByRole("button", { name: "Plugins" })).not.toBeInTheDocument();
  });

  it("lists the panels of running plugins under the button, then Manage plugins", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TopBar />);
    expect(plugins()).toHaveAttribute("aria-haspopup", "menu");
    expect(plugins()).toHaveAttribute("aria-expanded", "false");
    await user.click(plugins());
    expect(pluginMenu()).toBeInTheDocument();
    expect(plugins()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Kubernetes PodsPods",
      "Kubernetes PodsNotes",
      "Manage plugins…",
    ]);
  });

  it("opens the chosen panel in its slot, closes the menu and leaves the page alone", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TopBar />);
    await user.click(plugins());
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "conversation" });
    await user.click(screen.getByRole("menuitem", { name: "Kubernetes Pods: Pods" }));
    expect(useShellStore.getState().activePluginPanel).toEqual({
      pluginId: "chat.rim.k8s-pods",
      panelId: "pods",
      slot: "main_area",
    });
    expect(pluginMenu()).not.toBeInTheDocument();
    expect(plugins()).toHaveAttribute("aria-current", "page");
  });

  it("opens with Enter, moves with the arrow keys and chooses with Enter", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TopBar />);
    plugins().focus();
    await user.keyboard("{Enter}");
    expect(pluginMenu()).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(useShellStore.getState().activePluginPanel).toEqual({
      pluginId: "chat.rim.k8s-pods",
      panelId: "notes",
      slot: "tool_panel",
    });
    expect(plugins()).toHaveFocus();
  });

  it("closes on Escape and gives focus back to Plugins", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TopBar />);
    plugins().focus();
    await user.keyboard(" ");
    expect(pluginMenu()).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(pluginMenu()).not.toBeInTheDocument();
    expect(plugins()).toHaveFocus();
  });

  it("closes on a click outside and on a second click on Plugins", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TopBar />);
    await user.click(plugins());
    await user.click(document.body);
    expect(pluginMenu()).not.toBeInTheDocument();
    await user.click(plugins());
    await user.click(plugins());
    expect(pluginMenu()).not.toBeInTheDocument();
  });
});

describe("TopBar — notifications", () => {
  it("toggles the inbox under the bell, which Escape closes back to the bell", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TopBar />);
    const bell = within(topBar()).getByRole("button", { name: "Notifications" });
    await user.click(bell);
    expect(within(topBar()).getByRole("region", { name: "Notifications" })).toHaveTextContent(
      "Notification inbox",
    );
    await user.keyboard("{Escape}");
    expect(useNotificationsPanelStore.getState().open).toBe(false);
    expect(bell).toHaveFocus();
  });
});

describe("TopBar — keyboard", () => {
  it("is a landmark the pane movement can reach, and Tab reaches each control", async () => {
    const user = userEvent.setup();
    pluginList.data = withPanels();
    renderWithProviders(<TopBar />);
    expect(topBar()).toHaveAttribute("data-panel", "topBar");
    act(() => topBar().focus());
    expect(useShellStore.getState().focusedSurface).toBe("topBar");
    await expectReachableByKeyboard(user, [
      searchBox(),
      plugins(),
      screen.getByRole("button", { name: "Notifications" }),
    ]);
  });
});

describe("TopBar — window frame", () => {
  const dragAreas = () => Array.from(document.querySelectorAll("[data-tauri-drag-region]"));

  it("drags nothing and draws no window controls in a browser", () => {
    renderWithProviders(<TopBar />);
    expect(dragAreas()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("drags the window by its empty areas only, with the controls at its far right", () => {
    runtime.customTitleBar = true;
    pluginList.data = withPanels();
    renderWithProviders(<TopBar />);
    expect(dragAreas()).toContain(topBar());
    expect(dragAreas().length).toBeGreaterThanOrEqual(3);
    for (const button of within(topBar()).getAllByRole("button")) {
      expect(button.closest("[data-tauri-drag-region]") === button).toBe(false);
      expect(button).not.toHaveAttribute("data-tauri-drag-region");
    }
    const controls = ["Minimize", "Maximize", "Close"].map((name) =>
      within(topBar()).getByRole("button", { name }),
    );
    const buttons = within(topBar()).getAllByRole("button");
    expect(buttons.slice(-3)).toEqual(controls);
  });

  it("leaves the window controls to macOS", () => {
    runtime.customTitleBar = true;
    runtime.osType = "macos";
    renderWithProviders(<TopBar />);
    expect(dragAreas()).toContain(topBar());
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});

describe("TopBar — narrow window", () => {
  it("puts the navigation button first and keeps search, Plugins and Notifications", async () => {
    const user = userEvent.setup();
    pluginList.data = withPanels();
    useShellStore.setState({ shellWidth: "narrow" });
    renderWithProviders(<TopBar />);
    const buttons = within(topBar()).getAllByRole("button");
    expect(buttons[0]).toHaveAccessibleName("Open navigation");
    expect(buttons.slice(1).map((button) => button.getAttribute("aria-label"))).toEqual([
      null,
      "Plugins",
      "Notifications",
    ]);
    expect(searchBox().querySelector("kbd")).toBeNull();
    expect(plugins()).not.toHaveTextContent("Plugins");
    expect(topBar().className).toContain("h-12");

    await user.click(buttons[0]);
    expect(useShellStore.getState().navDrawerOpen).toBe(true);
  });

  it("has no navigation button in a wide window", () => {
    renderWithProviders(<TopBar />);
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
  });
});
