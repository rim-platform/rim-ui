import { useEffect, useMemo, lazy, Suspense } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useSessionHydration } from "../../features/auth/api/useSessionHydration";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useWorkspaceEvents } from "../../core/events/useWorkspaceEvents";
import { WorkspaceSelector } from "../../features/workspaces/components/WorkspaceSelector";
import { MessageTimeline } from "../../features/messages/components/MessageTimeline";
import { ThreadPanel } from "../../features/threads/components/ThreadPanel";
import { CommandPalette, KeybindProvider } from "../../features/commands";
import { QuickAccessAssigner } from "../../features/commands/components/QuickAccessAssigner";
import { SearchOverlay } from "../../features/messages/components/SearchOverlay";
import { ToastContainer } from "../../shared/toast";
import { AgentOverlay } from "../../features/agent/components/AgentOverlay";
import { ConfirmCommandModal } from "../../features/agent/components/ConfirmCommandModal";
import { useUnreadCounts } from "../../features/conversations/api/useUnreadCounts";
import { useMutedConversations } from "../../features/conversations/api/useMutedConversations";
import { useWorkspacePresence } from "../../features/presence/api/useWorkspacePresence";
import { useMessageCacheSync } from "../../features/messages/runtime/messageCacheSync";
import { useHeartbeat } from "../../features/presence/runtime/useHeartbeat";
import { usePluginEvents } from "../../features/plugins/runtime/pluginEventBus";
import { usePluginList } from "../../features/plugins/api/usePluginList";
import { useStatusExpiration } from "../../features/settings/hooks/useStatusExpiration";
import { useUnreadEventHandler } from "../../features/conversations/state/useUnreadEventHandler";
import { usePresenceEventHandler } from "../../features/presence/state/usePresenceEventHandler";
import { useTypingEventHandler } from "../../features/messages/state/useTypingEventHandler";
import { useNotificationEventHandler } from "../../features/notifications/runtime/useNotificationEventHandler";
import { PluginSlotContainer } from "../../features/plugins/components/PluginSlotContainer";
import { SurfaceErrorBoundary } from "../../shared/ui/SurfaceErrorBoundary";
import { useRuntime } from "../../core/runtime/RuntimeProvider";
import { useShellStore } from "../state/useShellStore";
import { WorkspaceRail } from "../components/WorkspaceRail";
import { SideRail } from "../components/SideRail";
import { ToolPanel } from "../components/ToolPanel";
import { ConversationHeader } from "../components/ConversationHeader";
import { PinnedMessagesPanel } from "../../features/messages/components/PinnedMessagesPanel";
import { SettingsPage } from "../../features/settings/components/SettingsPage";
import { TitleBar } from "../components/TitleBar";
import { ConnectionBanner } from "../../features/system/components/ConnectionBanner";
import { StartIncidentDialog } from "../../features/incidents/components/StartIncidentDialog";
import { IncidentTimelinePanel } from "../../features/incidents/components/IncidentTimeline";
import { PostmortemPreview } from "../../features/incidents/components/PostmortemPreview";
import { IncidentsHub } from "../../features/incidents/components/IncidentsHub";
import { useIncidentStore } from "../../features/incidents/state/useIncidentStore";
import { OverrideModal } from "../../features/oncall/components/OverrideModal";
import { useOnCallStore } from "../../features/oncall/state/useOnCallStore";
import { useFeatureStatus } from "../../features/workspaces/hooks/useFeatureEnabled";
import { FEATURE_OFF_MESSAGE } from "../../features/workspaces/featureCatalog";
import { WorkspaceFeature } from "../../core/graphql/generated/schema-types";
import { AuditLogPage } from "../../features/audit/components/AuditLogPage";
import { StatusBar } from "../components/StatusBar";
import { FocusPulse } from "../navigation/FocusPulse";
import { useSpatialNavigation } from "../navigation/useSpatialNavigation";
import { cn } from "../../shared/ui/cn";
import { useZenModeTransition } from "../hooks/useZenModeTransition";
import { useAutoFocusComposer } from "../hooks/useAutoFocusComposer";
import { useGlobalKeyHandlers } from "../hooks/useGlobalKeyHandlers";
import { useTerminalStore } from "../../features/terminal/state/useTerminalStore";

// Lazy-load terminal pane — xterm.js is ~300KB, only loaded when first opened
const TerminalPane = lazy(() =>
  import("../../features/terminal/components/TerminalPane").then((m) => ({
    default: m.TerminalPane,
  })),
);

export function AppShell() {
  const session = useAuthStore((s) => s.session);
  const { isHydrating } = useSessionHydration();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { capabilities } = useRuntime();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isHydrating && !session) {
      navigate("/login", {
        replace: true,
        state: { returnTo: location.pathname + location.search },
      });
    }
  }, [isHydrating, session, navigate, location.pathname, location.search]);

  if (isHydrating) {
    return (
      <div className="flex h-screen flex-col bg-rim-void text-rim-text">
        {capabilities.customTitleBar && <TitleBar />}
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-rim-text-muted">
          Restoring session...
        </div>
      </div>
    );
  }

  if (!session) {
    // Redirect is in-flight via useEffect; render nothing to avoid flash.
    return null;
  }

  if (!workspaceId) {
    return (
      <div className="flex h-screen flex-col bg-rim-void text-rim-text">
        {capabilities.customTitleBar && <TitleBar />}
        <div className="min-h-0 flex-1">
          <WorkspaceSelector />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-rim-void text-rim-text">
      {capabilities.customTitleBar && <TitleBar />}
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        <WorkspaceShell />
      </div>
    </div>
  );
}

function WorkspaceShell() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  useWorkspaceEvents(workspaceId);
  useMessageCacheSync(workspaceId);
  useUnreadCounts(workspaceId ?? undefined);
  useMutedConversations(workspaceId ?? undefined);
  useWorkspacePresence(workspaceId);
  useHeartbeat(workspaceId);
  usePluginEvents();
  useStatusExpiration();
  useUnreadEventHandler();
  usePresenceEventHandler();
  useTypingEventHandler();
  useNotificationEventHandler(workspaceId);
  useSpatialNavigation();

  const { capabilities } = useRuntime();
  const mainSurface = useShellStore((s) => s.mainSurface);
  const isThreadOpen = useShellStore((s) => s.isThreadOpen);
  const selectedRootMessageId = useShellStore((s) => s.selectedRootMessageId);
  const activePluginPanel = useShellStore((s) => s.activePluginPanel);
  const closePluginPanel = useShellStore((s) => s.closePluginPanel);
  const pinnedPanelOpen = useShellStore((s) => s.pinnedPanelOpen);
  const setPinnedPanelOpen = useShellStore((s) => s.setPinnedPanelOpen);
  const selectedConversationId = useShellStore((s) => s.selectedConversationId);
  const zenMode = useShellStore((s) => s.zenMode);
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);
  const toggleZenMode = useShellStore((s) => s.toggleZenMode);
  const { data: plugins } = usePluginList();

  const { zenContentHidden, handleZenTransitionEnd } = useZenModeTransition(zenMode);
  useAutoFocusComposer(mainSurface.kind);
  useGlobalKeyHandlers();

  // Incidents and on-call are an optional workspace module (Track 0.4): every surface below
  // mounts only when the feature is on. "loading" counts as off so nothing flashes in.
  const incidentsStatus = useFeatureStatus(WorkspaceFeature.INCIDENTS);
  const incidentsEnabled = incidentsStatus === "enabled";

  // Turning the module off mid-session drops any open incident state, so nothing (the
  // "Tag for incident" context-menu item, a queued dialog) resurfaces from stale store values.
  useEffect(() => {
    if (incidentsStatus !== "disabled") return;
    const incidents = useIncidentStore.getState();
    incidents.setActiveIncident(null);
    incidents.setShowStartDialog(false);
    incidents.setShowTimeline(false);
    incidents.setShowPostmortem(false);
    useOnCallStore.getState().closeOverrideModal();
  }, [incidentsStatus]);

  // Incident mode
  const showIncidentTimeline = useIncidentStore((s) => s.showTimeline);
  const setShowIncidentTimeline = useIncidentStore((s) => s.setShowTimeline);
  const showIncidentPostmortem = useIncidentStore((s) => s.showPostmortem);
  const setShowIncidentPostmortem = useIncidentStore((s) => s.setShowPostmortem);

  // On-call: "take shift" override modal, opened via the `oncall.take_shift` command
  const showOverrideModal = useOnCallStore((s) => s.showOverrideModal);
  const overrideScheduleId = useOnCallStore((s) => s.overrideScheduleId);
  const closeOverrideModal = useOnCallStore((s) => s.closeOverrideModal);

  const showThread = capabilities.dockedThreadPane && isThreadOpen && selectedRootMessageId;

  // Resolve the active plugin panel to plugin info + panel def
  const resolvedPluginPanel = useMemo(() => {
    if (!activePluginPanel || !plugins) return null;
    const plugin = plugins.find((p) => p.plugin_id === activePluginPanel.pluginId && p.enabled);
    if (!plugin) return null;
    const panel = plugin.panels?.find((p) => p.id === activePluginPanel.panelId);
    if (!panel) return null;
    return { plugin, panel };
  }, [activePluginPanel, plugins]);

  const toolPanelPlugin =
    resolvedPluginPanel?.panel.slot === "tool_panel" ? resolvedPluginPanel : null;
  const mainAreaPlugin =
    resolvedPluginPanel?.panel.slot === "main_area" ? resolvedPluginPanel : null;

  return (
    <KeybindProvider>
      <div className="flex min-h-0 flex-1 flex-col bg-rim-void text-rim-text">
        <div className="flex min-h-0 flex-1">
          <div
            onTransitionEnd={handleZenTransitionEnd}
            className={cn(
              "grid transition-opacity duration-300",
              zenMode ? "pointer-events-none w-0 overflow-hidden opacity-0" : "opacity-100",
            )}
          >
            {!zenContentHidden && <WorkspaceRail />}
          </div>
          <div
            onTransitionEnd={handleZenTransitionEnd}
            className={cn(
              "grid transition-opacity duration-300",
              zenMode || sidebarCollapsed
                ? "pointer-events-none w-0 overflow-hidden opacity-0"
                : "opacity-100",
            )}
          >
            {!(zenContentHidden || sidebarCollapsed) && <SideRail />}
          </div>

          {mainSurface.kind === "conversation" && (
            <>
              <div
                onTransitionEnd={handleZenTransitionEnd}
                className={cn(
                  "grid transition-opacity duration-300",
                  zenMode ? "pointer-events-none w-0 overflow-hidden opacity-0" : "opacity-100",
                )}
              >
                {!zenContentHidden && (
                  <SurfaceErrorBoundary surface="Tool panel" resetKeys={[selectedConversationId]}>
                    <ToolPanel />
                  </SurfaceErrorBoundary>
                )}
              </div>

              {/* Plugin tool_panel slot — renders next to ToolPanel */}
              {toolPanelPlugin && (
                <div
                  onTransitionEnd={handleZenTransitionEnd}
                  className={cn(
                    "grid w-72 shrink-0 border-r border-rim-line bg-rim-panel transition-opacity duration-300",
                    zenMode ? "pointer-events-none w-0 overflow-hidden opacity-0" : "opacity-100",
                  )}
                >
                  {!zenContentHidden && (
                    <PluginSlotContainer
                      plugin={toolPanelPlugin.plugin}
                      panel={toolPanelPlugin.panel}
                      onClose={closePluginPanel}
                    />
                  )}
                </div>
              )}

              {/* Plugin main_area slot — replaces main content */}
              {mainAreaPlugin ? (
                <main className="flex min-w-0 flex-1 flex-col">
                  <PluginSlotContainer
                    plugin={mainAreaPlugin.plugin}
                    panel={mainAreaPlugin.panel}
                    onClose={closePluginPanel}
                  />
                </main>
              ) : (
                <main className="relative flex min-w-0 flex-1 flex-col">
                  <SurfaceErrorBoundary surface="Conversation" resetKeys={[selectedConversationId]}>
                    <div
                      onTransitionEnd={handleZenTransitionEnd}
                      className={cn(
                        "transition-opacity duration-300",
                        zenMode
                          ? "pointer-events-none h-0 overflow-hidden opacity-0"
                          : "opacity-100",
                      )}
                    >
                      {!zenContentHidden && <ConversationHeader />}
                    </div>
                    <MessageTimeline />
                  </SurfaceErrorBoundary>
                  {zenMode && (
                    <button
                      type="button"
                      onClick={toggleZenMode}
                      className="absolute right-3 top-3 z-50 rounded px-2 py-1 text-xs bg-rim-panel text-rim-text-muted hover:text-rim-text border border-rim-line shadow-sm opacity-0 hover:opacity-100 transition-opacity duration-300"
                    >
                      Exit Zen
                    </button>
                  )}
                </main>
              )}

              {!mainAreaPlugin && showThread && (
                <div
                  onTransitionEnd={handleZenTransitionEnd}
                  className={cn(
                    "grid w-80 shrink-0 border-l border-rim-line transition-opacity duration-300",
                    zenMode ? "pointer-events-none w-0 overflow-hidden opacity-0" : "opacity-100",
                  )}
                >
                  {!zenContentHidden && (
                    <SurfaceErrorBoundary surface="Thread" resetKeys={[selectedRootMessageId]}>
                      <ThreadPanel />
                    </SurfaceErrorBoundary>
                  )}
                </div>
              )}

              {!mainAreaPlugin && pinnedPanelOpen && workspaceId && selectedConversationId && (
                <div
                  onTransitionEnd={handleZenTransitionEnd}
                  className={cn(
                    "grid w-80 shrink-0 transition-opacity duration-300",
                    zenMode ? "pointer-events-none w-0 overflow-hidden opacity-0" : "opacity-100",
                  )}
                >
                  {!zenContentHidden && (
                    <SurfaceErrorBoundary
                      surface="Pinned messages"
                      resetKeys={[selectedConversationId]}
                    >
                      <PinnedMessagesPanel
                        workspaceId={workspaceId}
                        conversationId={selectedConversationId}
                        onClose={() => setPinnedPanelOpen(false)}
                      />
                    </SurfaceErrorBoundary>
                  )}
                </div>
              )}

              {!mainAreaPlugin && incidentsEnabled && showIncidentTimeline && (
                <div className="w-80 shrink-0">
                  <SurfaceErrorBoundary
                    surface="Incident timeline"
                    resetKeys={[selectedConversationId]}
                  >
                    <IncidentTimelinePanel onClose={() => setShowIncidentTimeline(false)} />
                  </SurfaceErrorBoundary>
                </div>
              )}

              {!mainAreaPlugin &&
                incidentsEnabled &&
                showIncidentPostmortem &&
                workspaceId &&
                selectedConversationId && (
                  <div className="w-80 shrink-0">
                    <SurfaceErrorBoundary surface="Postmortem" resetKeys={[selectedConversationId]}>
                      <PostmortemPreview
                        serverId={workspaceId}
                        conversationId={selectedConversationId}
                        onClose={() => setShowIncidentPostmortem(false)}
                      />
                    </SurfaceErrorBoundary>
                  </div>
                )}
            </>
          )}

          {mainSurface.kind === "settings" && (
            <main className="flex min-w-0 flex-1 flex-col">
              <SurfaceErrorBoundary surface="Settings" resetKeys={[]}>
                <SettingsPage />
              </SurfaceErrorBoundary>
            </main>
          )}

          {mainSurface.kind === "incidents" && (
            <main className="flex min-w-0 flex-1 flex-col">
              {incidentsEnabled && (
                <SurfaceErrorBoundary surface="Incidents" resetKeys={[]}>
                  <IncidentsHub />
                </SurfaceErrorBoundary>
              )}
              {incidentsStatus === "disabled" && (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm text-rim-text-muted">
                    {FEATURE_OFF_MESSAGE[WorkspaceFeature.INCIDENTS]}
                  </p>
                </div>
              )}
            </main>
          )}

          {mainSurface.kind === "audit-log" && (
            <main className="flex min-w-0 flex-1 flex-col">
              <SurfaceErrorBoundary surface="Audit log" resetKeys={[]}>
                <AuditLogPage />
              </SurfaceErrorBoundary>
            </main>
          )}

          {mainSurface.kind === "plugin" &&
            (() => {
              // Resolve the plugin and its first panel for the main-area slot.
              const mainPlugin = plugins?.find(
                (p) => p.plugin_id === mainSurface.pluginId && p.enabled,
              );
              const mainPanel = mainPlugin?.panels?.[0];
              if (mainPlugin && mainPanel) {
                return (
                  <main className="flex min-w-0 flex-1 flex-col">
                    <PluginSlotContainer
                      plugin={mainPlugin}
                      panel={mainPanel}
                      onClose={() =>
                        useShellStore.getState().setMainSurface({ kind: "conversation" })
                      }
                    />
                  </main>
                );
              }
              return (
                <main className="flex min-w-0 flex-1 flex-col items-center justify-center">
                  <p className="text-sm text-rim-text-muted">
                    Plugin {mainSurface.pluginId} is not enabled or has no panels.
                  </p>
                </main>
              );
            })()}

          {mainSurface.kind === "marketplace" && (
            <main className="flex min-w-0 flex-1 flex-col items-center justify-center">
              <p className="text-sm text-rim-text-muted">Marketplace coming soon!</p>
            </main>
          )}

          <CommandPalette />
          <SearchOverlay />
          <AgentOverlay />
          <ConfirmCommandModal />
          <QuickAccessAssigner />
          {incidentsEnabled && workspaceId && selectedConversationId && (
            <StartIncidentDialog serverId={workspaceId} conversationId={selectedConversationId} />
          )}
          {incidentsEnabled && workspaceId && (
            <OverrideModal
              open={showOverrideModal}
              onClose={closeOverrideModal}
              serverId={workspaceId}
              initialScheduleId={overrideScheduleId ?? undefined}
            />
          )}
          <ToastContainer />
        </div>

        {/* Terminal pane — below main content, above status bar, hidden in zen mode */}
        <div
          onTransitionEnd={handleZenTransitionEnd}
          className={cn(
            "transition-opacity duration-300",
            zenMode ? "pointer-events-none h-0 overflow-hidden opacity-0" : "opacity-100",
          )}
        >
          {!zenContentHidden && <TerminalPaneSlot />}
        </div>

        <div
          onTransitionEnd={handleZenTransitionEnd}
          className={cn(
            "transition-opacity duration-300",
            zenMode ? "pointer-events-none h-0 overflow-hidden opacity-0" : "opacity-100",
          )}
        >
          {!zenContentHidden && <StatusBar />}
        </div>
        <FocusPulse />
      </div>
    </KeybindProvider>
  );
}

/** Renders the terminal pane only when the feature is enabled and open. */
function TerminalPaneSlot() {
  const enabled = useTerminalStore((s) => s.enabled);
  const isOpen = useTerminalStore((s) => s.isOpen);

  if (!enabled || !isOpen) return null;

  return (
    <Suspense fallback={null}>
      <TerminalPane />
    </Suspense>
  );
}
