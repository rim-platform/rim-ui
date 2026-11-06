import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";

import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "../state/useShellStore";
import { RuntimeProvider } from "../../core/runtime/RuntimeProvider";
import type { PluginInfo } from "../../features/plugins/types";
import { createTestQueryClient } from "../../test/utils";

// ── Side-effect / data hooks used directly by AppShell / WorkspaceShell ──
// Mocked as no-ops so this test exercises only the render tree and the
// SurfaceErrorBoundary wiring around the three panels under test, not the
// (separately-tested) subscription/query plumbing.
vi.mock("../../features/workspaces/api/useMyServers", () => ({
  useMyServers: () => ({ data: [] }),
}));
vi.mock("../../features/workspaces/components/JoinDefaultWorkspace", () => ({
  JoinDefaultWorkspace: () => null,
}));
const hydration = vi.hoisted(() => ({ isHydrating: false }));
vi.mock("../../features/auth/api/useSessionHydration", () => ({
  useSessionHydration: () => hydration,
}));
const useWorkspaceEventsMock = vi.hoisted(() => vi.fn());
vi.mock("../../core/events/useWorkspaceEvents", () => ({
  useWorkspaceEvents: useWorkspaceEventsMock,
}));
vi.mock("../../features/offline/runtime/useOfflineReconnect", () => ({
  useOfflineReconnect: () => {},
}));
vi.mock("../../features/auth/runtime/signOut", () => ({ useSessionEndedSignOut: () => {} }));
const gate = vi.hoisted(() => ({ state: "unlocked" as "opening" | "unlocked" | "locked" }));
vi.mock("../../features/auth/runtime/unlockGate", () => ({
  useUnlockGate: () => gate.state,
  principalOf: async () => "rimp1_alice",
}));
vi.mock("../../features/conversations/api/useUnreadCounts", () => ({
  useUnreadCounts: () => {},
}));
vi.mock("../../features/conversations/api/useAllWorkspaceUnreadCounts", () => ({
  useAllWorkspaceUnreadCounts: () => {},
}));
vi.mock("../../features/workspaces/hooks/useWorkspaceAccessWatch", () => ({
  useWorkspaceAccessWatch: () => {},
}));
vi.mock("../../features/conversations/api/useMutedConversations", () => ({
  useMutedConversations: () => {},
}));
vi.mock("../../features/presence/api/useWorkspacePresence", () => ({
  useWorkspacePresence: () => {},
}));
vi.mock("../../features/presence/runtime/useHeartbeat", () => ({ useHeartbeat: () => {} }));
vi.mock("../../features/plugins/runtime/pluginEventBus", () => ({ usePluginEvents: () => {} }));
vi.mock("../../features/key-identity/components/KeySetupStep", () => ({
  KeySetupStep: () => <div data-testid="key-setup-step" />,
}));
vi.mock("../../features/key-identity/runtime/useResumeDeviceLinks", () => ({
  useResumeDeviceLinks: () => {},
}));
vi.mock("../../features/relay/runtime/relayRuntime", () => ({ useRelayRuntime: () => {} }));
vi.mock("../../features/relay/runtime/useDirectSpaceRuntime", () => ({
  useDirectSpaceRuntime: () => {},
  useLocalDirectSpaceId: () => "direct-1",
}));
vi.mock("../../features/relay/runtime/useBlockedConversationsRuntime", () => ({
  useBlockedConversationsRuntime: () => {},
}));
vi.mock("../../features/plugins/api/usePluginPrincipalSync", () => ({
  usePluginPrincipalSync: () => {},
}));
vi.mock("../../features/plugins/web/useWebPluginRuntime", () => ({
  useWebPluginRuntime: () => {},
}));
const pluginList = vi.hoisted(() => ({ data: [] as PluginInfo[] }));
vi.mock("../../features/plugins/api/usePluginList", () => ({
  usePluginList: () => pluginList,
}));
vi.mock("../../features/settings/hooks/useStatusExpiration", () => ({
  useStatusExpiration: () => {},
}));
vi.mock("../../features/conversations/state/useUnreadEventHandler", () => ({
  useUnreadEventHandler: () => {},
}));
vi.mock("../../features/conversations/state/useRecentActivitySeed", () => ({
  useRecentActivitySeed: () => {},
}));
vi.mock("../../features/presence/state/usePresenceEventHandler", () => ({
  usePresenceEventHandler: () => {},
}));
vi.mock("../../features/messages/state/useTypingEventHandler", () => ({
  useTypingEventHandler: () => {},
}));
vi.mock("../../features/notifications/runtime/useNotificationEvents", () => ({
  useNotificationEvents: () => {},
}));
vi.mock("../../features/notifications/runtime/useNotificationEventHandler", () => ({
  useNotificationEventHandler: () => {},
}));
vi.mock("../hooks/useZenModeTransition", () => ({
  useZenModeTransition: () => ({ zenContentHidden: false, handleZenTransitionEnd: () => {} }),
}));
vi.mock("../hooks/useAutoFocusComposer", () => ({ useAutoFocusComposer: () => {} }));
vi.mock("../hooks/useGlobalKeyHandlers", () => ({ useGlobalKeyHandlers: () => {} }));

// ── Heavy/unrelated child components — trivial stubs ──
vi.mock("../../features/workspaces/components/WorkspaceSelector", () => ({
  WorkspaceSelector: () => null,
}));
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../features/messages/components/MessageTimeline", () => ({
  MessageTimeline: () => {
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return null;
  },
}));
const threadFocus = vi.hoisted(() => ({ on: false }));
vi.mock("../../features/threads/components/ThreadPanel", () => ({
  ThreadPanel: () => {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
      if (threadFocus.on) ref.current?.focus();
    }, []);
    return (
      <div data-testid="thread-panel">
        <input ref={ref} data-testid="thread-input" />
      </div>
    );
  },
}));
vi.mock("../../features/conversations/components/ConversationInvitation", () => ({
  InvitationGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../features/commands", () => ({
  CommandPalette: () => null,
  KeybindProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../features/commands/components/QuickAccessAssigner", () => ({
  QuickAccessAssigner: () => null,
}));
vi.mock("../../features/messages/components/SearchOverlay", () => ({ SearchOverlay: () => null }));
vi.mock("../../shared/toast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/toast")>();
  return { ...actual, ToastContainer: () => null };
});
vi.mock("../../features/agent/components/AgentOverlay", () => ({ AgentOverlay: () => null }));
vi.mock("../../features/agent/components/ConfirmCommandModal", () => ({
  ConfirmCommandModal: () => null,
}));
vi.mock("../../features/plugins/registry/components/RegistryHost", () => ({
  RegistryHost: () => null,
}));
vi.mock("../../features/plugins/components/PluginSlotContainer", () => ({
  PluginSlotContainer: ({ panel }: { panel: { id: string } }) => (
    <div data-testid={`plugin-slot-${panel.id}`} />
  ),
}));
vi.mock("../components/WorkspaceRail", () => ({
  WorkspaceRail: () => <div data-testid="workspace-rail" />,
}));
vi.mock("../components/SideRail", () => ({ SideRail: () => <div data-testid="side-rail" /> }));
vi.mock("../components/ToolPanel", () => ({ ToolPanel: () => <div data-testid="tool-panel" /> }));
vi.mock("../components/ConversationHeader", () => ({
  ConversationHeader: () => <div data-testid="conversation-header" />,
}));
vi.mock("../../features/settings/components/SettingsPage", () => ({
  SettingsPage: () => <div data-testid="settings-page" />,
}));
vi.mock("../components/TitleBar", () => ({ TitleBar: () => null }));
vi.mock("../../features/system/components/ConnectionBanner", () => ({
  ConnectionBanner: () => null,
}));
vi.mock("../../features/relay/components/BlockPersonDialog", () => ({
  BlockPersonDialog: () => null,
}));
vi.mock("../../features/limits/components/ProbationBanner", () => ({
  ProbationBanner: () => null,
}));
vi.mock("../../features/key-identity/components/RecoveryKitBanner", () => ({
  RecoveryKitBanner: () => null,
}));
vi.mock("../../features/account-deletion/components/AccountDeletionBanner", () => ({
  AccountDeletionBanner: () => null,
}));
vi.mock("../../features/audit/components/AuditLogPage", () => ({ AuditLogPage: () => null }));
vi.mock("../components/StatusBar", () => ({ StatusBar: () => null }));
vi.mock("../navigation/FocusPulse", () => ({ FocusPulse: () => null }));

// ── The panel under test — throws on demand via a shared flag,
//    mirroring the Bomb pattern in SurfaceErrorBoundary.test.tsx ──
let pinnedShouldThrow = false;

vi.mock("../../features/messages/components/PinnedMessagesPanel", () => ({
  PinnedMessagesPanel: () => {
    if (pinnedShouldThrow) throw new Error("pinned boom");
    return <div data-testid="pinned-panel">pinned ok</div>;
  },
}));

import { AppShell } from "./AppShell";

beforeEach(() => {
  gate.state = "unlocked";
});

function renderShell() {
  return render(
    <MemoryRouter>
      <RuntimeProvider>
        <AppShell />
      </RuntimeProvider>
    </MemoryRouter>,
  );
}

describe("AppShell — conversation side-panel error boundaries", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the caught error to console.error; expected noise here.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    pinnedShouldThrow = false;

    useAuthStore.setState({ session: { userId: "u1" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({
      mainSurface: { kind: "conversation" },
      selectedConversationId: "conv-1",
      pinnedPanelOpen: true,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("renders the panel normally when nothing throws", () => {
    renderShell();
    expect(screen.getByTestId("pinned-panel")).toBeInTheDocument();
  });

  it("mounts the key setup step over a signed-in workspace and over the workspace picker", () => {
    const { unmount } = renderShell();
    expect(screen.getByTestId("key-setup-step")).toBeInTheDocument();
    unmount();

    useWorkspaceStore.setState({ workspaceId: null });
    renderShell();
    expect(screen.getByTestId("key-setup-step")).toBeInTheDocument();
  });

  it("wraps PinnedMessagesPanel: a crash shows the in-pane fallback and the rest of the shell stays mounted", () => {
    pinnedShouldThrow = true;
    renderShell();

    expect(screen.getByText("Pinned messages failed to load")).toBeInTheDocument();
    // The rest of the shell stays mounted.
    expect(screen.getByTestId("workspace-rail")).toBeInTheDocument();
  });
});

describe("AppShell — workspace event subscriptions", () => {
  beforeEach(() => {
    useWorkspaceEventsMock.mockClear();
    useAuthStore.setState({ session: { userId: "u1" } });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("subscribes the open workspace", () => {
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    renderShell();
    expect(useWorkspaceEventsMock).toHaveBeenLastCalledWith("ws-1");
  });

  it("leaves the open direct space to the subscription made at sign-in", () => {
    useWorkspaceStore.setState({ workspaceId: "direct-1" });
    renderShell();
    expect(useWorkspaceEventsMock).toHaveBeenLastCalledWith(null);
  });
});

describe("AppShell — session restore", () => {
  afterEach(() => {
    hydration.isHydrating = false;
  });

  it("shows the splash with the restoring caption as a status while the session hydrates", () => {
    hydration.isHydrating = true;
    renderShell();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Restoring session...");
    expect(status.querySelectorAll(".rim-splash-ball")).toHaveLength(3);
    expect(screen.queryByTestId("workspace-rail")).not.toBeInTheDocument();
  });
});

describe("AppShell — plugin panels and conversation navigation", () => {
  beforeEach(() => {
    useAuthStore.setState({ session: { userId: "u1" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    pluginList.data = [
      {
        plugin_id: "chat.rim.k8s-pods",
        manifest_id: "chat.rim.k8s-pods",
        display_name: "Kubernetes Pods",
        version: "1.0.0",
        description: "",
        enabled: true,
        capabilities: [],
        approved_capabilities: ["ui.panel"],
        approved_ai_commands: [],
        ai_callable_commands: [],
        ai_consent_required: false,
        fingerprint_changed: false,
        panels: [
          { id: "pods", title: "Pods", slot: "main_area" },
          { id: "notes", title: "Notes" },
        ],
      },
    ];
  });

  afterEach(() => {
    pluginList.data = [];
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
  });

  it("unmounts a main-area panel and shows the conversation the user opens", () => {
    useShellStore.getState().openPluginPanel("chat.rim.k8s-pods", "pods", "main_area");
    renderShell();
    expect(screen.getByTestId("plugin-slot-pods")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-header")).not.toBeInTheDocument();

    act(() => useShellStore.getState().setSelectedConversationId("conv-2"));

    expect(screen.queryByTestId("plugin-slot-pods")).not.toBeInTheDocument();
    expect(screen.getByTestId("conversation-header")).toBeInTheDocument();
  });

  it("keeps a tool-panel panel beside the conversation the user opens", () => {
    useShellStore.getState().openPluginPanel("chat.rim.k8s-pods", "notes", "tool_panel");
    renderShell();
    expect(screen.getByTestId("plugin-slot-notes")).toBeInTheDocument();
    // The slot's one column cannot grow past its width, so a long panel header cannot push
    // the panel over the conversation (jsdom has no layout, so the classes stand in for it).
    const slot = screen.getByTestId("plugin-slot-notes").parentElement as HTMLElement;
    expect(slot.className.split(" ")).toEqual(
      expect.arrayContaining(["w-72", "grid-cols-1", "overflow-hidden"]),
    );

    act(() => useShellStore.getState().setSelectedConversationId("conv-2"));

    expect(screen.getByTestId("plugin-slot-notes")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-header")).toBeInTheDocument();
  });

  it("does not show an open panel of a plugin without the ui.panel grant", () => {
    pluginList.data = pluginList.data.map((plugin) => ({ ...plugin, approved_capabilities: [] }));
    useShellStore.getState().openPluginPanel("chat.rim.k8s-pods", "pods", "main_area");
    renderShell();
    expect(screen.queryByTestId("plugin-slot-pods")).not.toBeInTheDocument();
    expect(screen.getByTestId("conversation-header")).toBeInTheDocument();
  });
});

describe("AppShell — the unlock gate", () => {
  beforeEach(() => {
    useWorkspaceEventsMock.mockClear();
    useAuthStore.setState({ session: { userId: "u1" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it("asks for the password while the account is locked, and runs nothing that reads its data", async () => {
    gate.state = "locked";
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <RuntimeProvider>
            <AppShell />
          </RuntimeProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "This account is locked" })).toBeInTheDocument();
    expect(await screen.findByLabelText(/^password or pin$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-rail")).not.toBeInTheDocument();
    expect(useWorkspaceEventsMock).not.toHaveBeenCalled();
  });

  it("shows the splash while it opens a kept account", () => {
    gate.state = "opening";
    renderShell();
    expect(screen.getByRole("status")).toHaveTextContent("Restoring session...");
    expect(screen.queryByTestId("workspace-rail")).not.toBeInTheDocument();
  });
});

describe("AppShell — narrow and medium windows", () => {
  let observers: ((width: number) => void)[] = [];
  let width = 1400;

  beforeEach(() => {
    observers = [];
    pinnedShouldThrow = false;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe() {
          observers.push((next) =>
            this.callback(
              [{ contentRect: { width: next } } as ResizeObserverEntry],
              this as unknown as ResizeObserver,
            ),
          );
        }
        disconnect() {}
        unobserve() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ width }) as DOMRect,
    );
    useAuthStore.setState({ session: { userId: "u1" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({ selectedConversationId: "conv-1" });
    pluginList.data = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useShellStore.setState({ sidebarCollapsed: false });
  });

  function renderAt(px: number) {
    width = px;
    return renderShell();
  }

  function resizeTo(px: number) {
    act(() => observers.forEach((fire) => fire(px)));
  }

  it("keeps every panel beside the conversation in a wide window", () => {
    useShellStore.setState({ isThreadOpen: true, selectedRootMessageId: "m1" });
    renderAt(1400);
    expect(screen.getByTestId("side-rail")).toBeInTheDocument();
    expect(screen.getByTestId("tool-panel")).toBeInTheDocument();
    expect(screen.getByTestId("thread-panel")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
  });

  it("opens the thread over the conversation in a medium window and keeps the side panel", async () => {
    const user = userEvent.setup();
    renderAt(900);
    expect(screen.getByTestId("side-rail")).toBeInTheDocument();
    expect(screen.getByTestId("tool-panel")).toBeInTheDocument();

    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    act(() => useShellStore.getState().openThreadForMessage("m1"));

    const dialog = screen.getByRole("region", { name: "Thread" });
    expect(within(dialog).getByTestId("thread-panel")).toBeInTheDocument();
    expect(dialog).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(useShellStore.getState().isThreadOpen).toBe(false);
    expect(screen.queryByRole("region", { name: "Thread" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("opens pinned messages and a tool-panel plugin as overlays in a medium window", async () => {
    const user = userEvent.setup();
    pluginList.data = [
      {
        plugin_id: "p",
        manifest_id: "p",
        display_name: "P",
        version: "1.0.0",
        description: "",
        enabled: true,
        capabilities: [],
        approved_capabilities: ["ui.panel"],
        approved_ai_commands: [],
        ai_callable_commands: [],
        ai_consent_required: false,
        fingerprint_changed: false,
        panels: [{ id: "notes", title: "Notes" }],
      },
    ];
    useShellStore.setState({ pinnedPanelOpen: true });
    useShellStore.getState().openPluginPanel("p", "notes", "tool_panel");
    renderAt(900);

    const pins = screen.getByRole("region", { name: "Pinned messages" });
    expect(within(pins).getByTestId("pinned-panel")).toBeInTheDocument();
    const plugin = screen.getByRole("region", { name: "Notes" });
    expect(within(plugin).getByTestId("plugin-slot-notes")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(useShellStore.getState().pinnedPanelOpen).toBe(false);
  });

  it("puts the navigation in a drawer in a narrow window", async () => {
    const user = userEvent.setup();
    useShellStore.setState({ mainSurface: { kind: "marketplace" } });
    renderAt(600);
    expect(screen.queryByTestId("side-rail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tool-panel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getByTestId("workspace-rail")).toBeInTheDocument();
    expect(within(drawer).getByTestId("side-rail")).toBeInTheDocument();
    expect(drawer).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });

  it("shows the conversation list in the drawer and closes it when a conversation is chosen", async () => {
    const user = userEvent.setup();
    renderAt(600);
    act(() => useShellStore.getState().setNavDrawerOpen(true));
    expect(
      within(screen.getByRole("dialog", { name: "Navigation" })).getByTestId("tool-panel"),
    ).toBeInTheDocument();

    act(() => useShellStore.getState().setSelectedConversationId("conv-2"));
    expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument();

    act(() => useShellStore.getState().setNavDrawerOpen(true));
    const backdrop = document.querySelector('[aria-hidden="true"].absolute') as HTMLElement;
    await user.click(backdrop);
    expect(useShellStore.getState().navDrawerOpen).toBe(false);
  });

  it("fills the main area with a thread in a narrow window", () => {
    useShellStore.setState({ isThreadOpen: true, selectedRootMessageId: "m1" });
    renderAt(600);
    expect(screen.getByRole("region", { name: "Thread" }).className).toContain("inset-0");
  });

  it("follows the window as it is resized and never writes the saved sidebar choice", () => {
    useShellStore.setState({ sidebarCollapsed: true });
    renderAt(1400);
    expect(useShellStore.getState().shellWidth).toBe("wide");

    resizeTo(600);
    expect(useShellStore.getState().shellWidth).toBe("narrow");
    act(() => useShellStore.getState().setNavDrawerOpen(true));
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();

    resizeTo(1400);
    expect(useShellStore.getState().navDrawerOpen).toBe(false);
    expect(useShellStore.getState().sidebarCollapsed).toBe(true);
    expect(screen.queryByTestId("side-rail")).not.toBeInTheDocument();
  });

  it("opens the drawer when the tool panel is asked for in a narrow window", () => {
    renderAt(600);
    act(() => useShellStore.getState().setShowNewMessagePicker(true));
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
  });

  it("keeps the conversation mounted across a resize through every width class", () => {
    mounts.count = 0;
    renderAt(1400);
    expect(mounts.count).toBe(1);
    resizeTo(900);
    resizeTo(600);
    resizeTo(1400);
    expect(mounts.count).toBe(1);
  });

  it("keeps a main-area page mounted when the window narrows", () => {
    useShellStore.setState({ mainSurface: { kind: "marketplace" } });
    renderAt(1400);
    const text = screen.getByText("Marketplace coming soon!");
    resizeTo(600);
    expect(screen.getByText("Marketplace coming soon!")).toBe(text);
  });

  it("keeps Tab inside the drawer and closes it on Escape from the page body", async () => {
    const user = userEvent.setup();
    renderAt(600);
    act(() => useShellStore.getState().setNavDrawerOpen(true));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    const first = document.createElement("button");
    first.textContent = "first";
    const last = document.createElement("button");
    last.textContent = "last";
    drawer.prepend(first);
    drawer.append(last);

    last.focus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    (document.activeElement as HTMLElement).blur();
    await user.tab();
    expect(first).toHaveFocus();

    (document.activeElement as HTMLElement).blur();
    await user.keyboard("{Escape}");
    expect(useShellStore.getState().navDrawerOpen).toBe(false);
  });

  it("leaves Escape to an open menu above the drawer", async () => {
    const user = userEvent.setup();
    renderAt(600);
    act(() => useShellStore.getState().setNavDrawerOpen(true));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    await user.keyboard("{Escape}");
    expect(useShellStore.getState().navDrawerOpen).toBe(true);
    menu.remove();
  });

  it("does not close the thread for an Escape from a portal outside it", async () => {
    renderAt(900);
    act(() => useShellStore.getState().openThreadForMessage("m1"));
    const picker = document.createElement("input");
    document.body.append(picker);
    picker.focus();
    const region = screen.getByRole("region", { name: "Thread" });
    // A synthetic event whose React ancestry runs through the overlay, but whose DOM does not.
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    picker.dispatchEvent(event);
    expect(useShellStore.getState().isThreadOpen).toBe(true);
    expect(region).toBeInTheDocument();
    picker.remove();
  });

  it("returns focus past a child that took focus itself when the overlay opened", () => {
    renderAt(900);
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    threadFocus.on = true;
    act(() => useShellStore.getState().openThreadForMessage("m1"));
    expect(screen.getByTestId("thread-input")).toHaveFocus();
    act(() => useShellStore.getState().closeThread());
    threadFocus.on = false;
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("leaves focus alone that the person moved elsewhere", () => {
    renderAt(900);
    const opener = document.createElement("button");
    const elsewhere = document.createElement("textarea");
    document.body.append(opener, elsewhere);
    opener.focus();
    act(() => useShellStore.getState().openThreadForMessage("m1"));
    elsewhere.focus();
    act(() => useShellStore.getState().closeThread());
    expect(elsewhere).toHaveFocus();
    opener.remove();
    elsewhere.remove();
  });
});
