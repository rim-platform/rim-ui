import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "../state/useShellStore";
import { RuntimeProvider } from "../../core/runtime/RuntimeProvider";
import type { PluginInfo } from "../../features/plugins/types";

// ── Side-effect / data hooks used directly by AppShell / WorkspaceShell ──
// Mocked as no-ops so this test exercises only the render tree and the
// SurfaceErrorBoundary wiring around the three panels under test, not the
// (separately-tested) subscription/query plumbing.
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
vi.mock("../../features/conversations/api/useUnreadCounts", () => ({
  useUnreadCounts: () => {},
}));
vi.mock("../../features/conversations/api/useAllWorkspaceUnreadCounts", () => ({
  useAllWorkspaceUnreadCounts: () => {},
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
vi.mock("../../features/presence/state/usePresenceEventHandler", () => ({
  usePresenceEventHandler: () => {},
}));
vi.mock("../../features/messages/state/useTypingEventHandler", () => ({
  useTypingEventHandler: () => {},
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
vi.mock("../../features/messages/components/MessageTimeline", () => ({
  MessageTimeline: () => null,
}));
vi.mock("../../features/threads/components/ThreadPanel", () => ({ ThreadPanel: () => null }));
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
vi.mock("../components/SideRail", () => ({ SideRail: () => null }));
vi.mock("../components/ToolPanel", () => ({ ToolPanel: () => null }));
vi.mock("../components/ConversationHeader", () => ({
  ConversationHeader: () => <div data-testid="conversation-header" />,
}));
vi.mock("../../features/settings/components/SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("../components/TitleBar", () => ({ TitleBar: () => null }));
vi.mock("../../features/system/components/ConnectionBanner", () => ({
  ConnectionBanner: () => null,
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
        approved_capabilities: [],
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
});
