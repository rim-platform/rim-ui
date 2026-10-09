import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore } from "../state/useShellStore";
import { useIncidentStore } from "../../features/incidents/state/useIncidentStore";
import { RuntimeProvider } from "../../core/runtime/RuntimeProvider";

// ── Side-effect / data hooks used directly by AppShell / WorkspaceShell ──
// Mocked as no-ops so this test exercises only the render tree and the
// SurfaceErrorBoundary wiring around the three panels under test, not the
// (separately-tested) subscription/query plumbing.
vi.mock("../../features/auth/api/useSessionHydration", () => ({
  useSessionHydration: () => ({ isHydrating: false }),
}));
vi.mock("../../core/events/useWorkspaceEvents", () => ({ useWorkspaceEvents: () => {} }));
vi.mock("../../features/offline/runtime/useOfflineReconnect", () => ({
  useOfflineReconnect: () => {},
}));
vi.mock("../../features/conversations/api/useUnreadCounts", () => ({
  useUnreadCounts: () => {},
}));
vi.mock("../../features/conversations/api/useMutedConversations", () => ({
  useMutedConversations: () => {},
}));
vi.mock("../../features/presence/api/useWorkspacePresence", () => ({
  useWorkspacePresence: () => {},
}));
vi.mock("../../features/presence/runtime/useHeartbeat", () => ({ useHeartbeat: () => {} }));
vi.mock("../../features/plugins/runtime/pluginEventBus", () => ({ usePluginEvents: () => {} }));
vi.mock("../../features/key-identity/runtime/useResumeDeviceLinks", () => ({
  useResumeDeviceLinks: () => {},
}));
vi.mock("../../features/plugins/api/usePluginPrincipalSync", () => ({
  usePluginPrincipalSync: () => {},
}));
vi.mock("../../features/plugins/web/useWebPluginRuntime", () => ({
  useWebPluginRuntime: () => {},
}));
vi.mock("../../features/plugins/api/usePluginList", () => ({
  usePluginList: () => ({ data: [] }),
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
vi.mock("../navigation/useSpatialNavigation", () => ({ useSpatialNavigation: () => {} }));
vi.mock("../hooks/useZenModeTransition", () => ({
  useZenModeTransition: () => ({ zenContentHidden: false, handleZenTransitionEnd: () => {} }),
}));
vi.mock("../hooks/useAutoFocusComposer", () => ({ useAutoFocusComposer: () => {} }));
vi.mock("../hooks/useGlobalKeyHandlers", () => ({ useGlobalKeyHandlers: () => {} }));
// Workspace feature flags (Track 0.4) — mutable so tests can turn the incidents module off.
let incidentsStatus: "loading" | "enabled" | "disabled" = "enabled";
vi.mock("../../features/workspaces/hooks/useFeatureEnabled", () => ({
  useFeatureStatus: () => incidentsStatus,
}));
vi.mock("../../features/incidents/components/IncidentsHub", () => ({
  IncidentsHub: () => <div data-testid="incidents-hub" />,
}));

// ── Heavy/unrelated child components — trivial stubs ──
vi.mock("../../features/workspaces/components/WorkspaceSelector", () => ({
  WorkspaceSelector: () => null,
}));
vi.mock("../../features/messages/components/MessageTimeline", () => ({
  MessageTimeline: () => null,
}));
vi.mock("../../features/threads/components/ThreadPanel", () => ({ ThreadPanel: () => null }));
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
  PluginSlotContainer: () => null,
}));
vi.mock("../components/WorkspaceRail", () => ({
  WorkspaceRail: () => <div data-testid="workspace-rail" />,
}));
vi.mock("../components/SideRail", () => ({ SideRail: () => null }));
vi.mock("../components/ToolPanel", () => ({ ToolPanel: () => null }));
vi.mock("../components/ConversationHeader", () => ({ ConversationHeader: () => null }));
vi.mock("../../features/settings/components/SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("../components/TitleBar", () => ({ TitleBar: () => null }));
vi.mock("../../features/system/components/ConnectionBanner", () => ({
  ConnectionBanner: () => null,
}));
vi.mock("../../features/oncall/components/OverrideModal", () => ({
  OverrideModal: () => null,
}));
vi.mock("../../features/incidents/components/StartIncidentDialog", () => ({
  StartIncidentDialog: () => null,
}));
vi.mock("../../features/incidents/components/IncidentHistoryPage", () => ({
  IncidentHistoryPage: () => null,
}));
vi.mock("../../features/audit/components/AuditLogPage", () => ({ AuditLogPage: () => null }));
vi.mock("../components/StatusBar", () => ({ StatusBar: () => null }));
vi.mock("../navigation/FocusPulse", () => ({ FocusPulse: () => null }));

// ── The three panels under test — throw on demand via a shared flag,
//    mirroring the Bomb pattern in SurfaceErrorBoundary.test.tsx ──
let pinnedShouldThrow = false;
let timelineShouldThrow = false;
let postmortemShouldThrow = false;

vi.mock("../../features/messages/components/PinnedMessagesPanel", () => ({
  PinnedMessagesPanel: () => {
    if (pinnedShouldThrow) throw new Error("pinned boom");
    return <div data-testid="pinned-panel">pinned ok</div>;
  },
}));
vi.mock("../../features/incidents/components/IncidentTimeline", () => ({
  IncidentTimelinePanel: () => {
    if (timelineShouldThrow) throw new Error("timeline boom");
    return <div data-testid="timeline-panel">timeline ok</div>;
  },
}));
vi.mock("../../features/incidents/components/PostmortemPreview", () => ({
  PostmortemPreview: () => {
    if (postmortemShouldThrow) throw new Error("postmortem boom");
    return <div data-testid="postmortem-panel">postmortem ok</div>;
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
    timelineShouldThrow = false;
    postmortemShouldThrow = false;
    incidentsStatus = "enabled";

    useAuthStore.setState({ session: { userId: "u1" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({
      mainSurface: { kind: "conversation" },
      selectedConversationId: "conv-1",
      pinnedPanelOpen: true,
    });
    useIncidentStore.setState({ showTimeline: true, showPostmortem: true });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useIncidentStore.setState({
      activeIncident: null,
      showStartDialog: false,
      showTimeline: false,
      showPostmortem: false,
    });
  });

  it("renders all three panels normally when nothing throws", () => {
    renderShell();
    expect(screen.getByTestId("pinned-panel")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-panel")).toBeInTheDocument();
    expect(screen.getByTestId("postmortem-panel")).toBeInTheDocument();
  });

  it("wraps PinnedMessagesPanel: a crash shows the in-pane fallback and the rest of the shell stays mounted", () => {
    pinnedShouldThrow = true;
    renderShell();

    expect(screen.getByText("Pinned messages failed to load")).toBeInTheDocument();
    // The rest of the shell — including sibling panels — stays mounted.
    expect(screen.getByTestId("workspace-rail")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-panel")).toBeInTheDocument();
    expect(screen.getByTestId("postmortem-panel")).toBeInTheDocument();
  });

  it("wraps IncidentTimelinePanel: a crash shows the in-pane fallback and the rest of the shell stays mounted", () => {
    timelineShouldThrow = true;
    renderShell();

    expect(screen.getByText("Incident timeline failed to load")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail")).toBeInTheDocument();
    expect(screen.getByTestId("pinned-panel")).toBeInTheDocument();
    expect(screen.getByTestId("postmortem-panel")).toBeInTheDocument();
  });

  it("wraps PostmortemPreview: a crash shows the in-pane fallback and the rest of the shell stays mounted", () => {
    postmortemShouldThrow = true;
    renderShell();

    expect(screen.getByText("Postmortem failed to load")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-rail")).toBeInTheDocument();
    expect(screen.getByTestId("pinned-panel")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-panel")).toBeInTheDocument();
  });
});

describe("AppShell — incidents module gate (Track 0.4)", () => {
  beforeEach(() => {
    incidentsStatus = "enabled";
    useAuthStore.setState({ session: { userId: "u1" } });
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    useShellStore.setState({
      mainSurface: { kind: "conversation" },
      selectedConversationId: "conv-1",
      pinnedPanelOpen: false,
    });
    useIncidentStore.setState({ showTimeline: true, showPostmortem: true });
  });

  afterEach(() => {
    useAuthStore.setState({ session: null });
    useWorkspaceStore.setState({ workspaceId: null });
    useShellStore.getState().reset();
    useIncidentStore.setState({
      activeIncident: null,
      showStartDialog: false,
      showTimeline: false,
      showPostmortem: false,
    });
  });

  it("mounts no incident panels and clears incident state when the feature is off", () => {
    incidentsStatus = "disabled";
    renderShell();
    expect(screen.queryByTestId("timeline-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("postmortem-panel")).not.toBeInTheDocument();
    expect(useIncidentStore.getState().showTimeline).toBe(false);
    expect(useIncidentStore.getState().showPostmortem).toBe(false);
  });

  it("mounts no incident panels while the flag is still loading", () => {
    incidentsStatus = "loading";
    renderShell();
    expect(screen.queryByTestId("timeline-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("postmortem-panel")).not.toBeInTheDocument();
  });

  it("shows a notice instead of the Incidents hub when the feature is off", () => {
    incidentsStatus = "disabled";
    useShellStore.setState({ mainSurface: { kind: "incidents" } });
    renderShell();
    expect(screen.queryByTestId("incidents-hub")).not.toBeInTheDocument();
    expect(
      screen.getByText("Incidents and on-call are turned off for this workspace."),
    ).toBeInTheDocument();
  });

  it("renders the Incidents hub when the feature is on", () => {
    useShellStore.setState({ mainSurface: { kind: "incidents" } });
    renderShell();
    expect(screen.getByTestId("incidents-hub")).toBeInTheDocument();
  });
});
