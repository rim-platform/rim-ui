import { useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { RemovalNotices } from "../../features/workspaces/components/RemovalNotices";
import { JoinDefaultWorkspace } from "../../features/workspaces/components/JoinDefaultWorkspace";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useSessionHydration } from "../../features/auth/api/useSessionHydration";
import { useSessionEndedSignOut } from "../../features/auth/runtime/signOut";
import { RestoringSessionSplash } from "../../features/auth/components/RestoringSession";
import { UnlockScreen } from "../../features/auth/components/UnlockScreen";
import { useUnlockGate } from "../../features/auth/runtime/unlockGate";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { usePendingPublicLinkReturn } from "../../features/auth/hooks/usePendingPublicLinkReturn";
import { useWorkspaceEvents } from "../../core/events/useWorkspaceEvents";
import { WorkspaceSelector } from "../../features/workspaces/components/WorkspaceSelector";
import { MessageTimeline } from "../../features/messages/components/MessageTimeline";
import { InvitationGate } from "../../features/conversations/components/ConversationInvitation";
import { DraftDirectView } from "../../features/conversations/components/DraftDirectView";
import { ThreadPanel } from "../../features/threads/components/ThreadPanel";
import { CommandPalette, KeybindProvider } from "../../features/commands";
import { ShortcutsPanel } from "../../features/commands/components/ShortcutsPanel";
import { QuickAccessAssigner } from "../../features/commands/components/QuickAccessAssigner";
import { SearchOverlay } from "../../features/messages/components/SearchOverlay";
import { ToastContainer } from "../../shared/toast";
import { AgentOverlay } from "../../features/agent/components/AgentOverlay";
import { ConfirmCommandModal } from "../../features/agent/components/ConfirmCommandModal";
import { useUnreadCounts } from "../../features/conversations/api/useUnreadCounts";
import { useAllWorkspaceUnreadCounts } from "../../features/conversations/api/useAllWorkspaceUnreadCounts";
import { useMutedConversations } from "../../features/conversations/api/useMutedConversations";
import { useWorkspacePresence } from "../../features/presence/api/useWorkspacePresence";
import { useMessageCacheSync } from "../../features/messages/runtime/messageCacheSync";
import { useE2eeRuntime } from "../../features/e2ee/runtime/e2eeRuntime";
import { useHeartbeat } from "../../features/presence/runtime/useHeartbeat";
import { usePluginEvents } from "../../features/plugins/runtime/pluginEventBus";
import { usePluginList } from "../../features/plugins/api/usePluginList";
import { usePluginPrincipalSync } from "../../features/plugins/api/usePluginPrincipalSync";
import { usePluginChatRelay } from "../../features/plugins/chat/usePluginChatRelay";
import { useWebPluginRuntime } from "../../features/plugins/web/useWebPluginRuntime";
import { useStatusExpiration } from "../../features/settings/hooks/useStatusExpiration";
import { useUnreadEventHandler } from "../../features/conversations/state/useUnreadEventHandler";
import { usePresenceEventHandler } from "../../features/presence/state/usePresenceEventHandler";
import { useTypingEventHandler } from "../../features/messages/state/useTypingEventHandler";
import { useNotificationEventHandler } from "../../features/notifications/runtime/useNotificationEventHandler";
import { PluginSlotContainer } from "../../features/plugins/components/PluginSlotContainer";
import { PluginCommandConfirmDialog } from "../../features/plugins/components/PluginCommandConfirmDialog";
import { ConversationActionConfirmHost } from "../../features/conversations/components/ConversationActionConfirmHost";
import { PluginSettingsDialogHost } from "../../features/plugins/components/PluginSettingsDialogHost";
import { RegistryHost } from "../../features/plugins/registry/components/RegistryHost";
import { canShowPanels } from "../../features/plugins/pluginPanels";
import { panelSlot } from "../../features/plugins/types";
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
import { OfflineBanner } from "../../features/offline/components/OfflineBanner";
import { useOfflineReconnect } from "../../features/offline/runtime/useOfflineReconnect";
import { useResumeDeviceLinks } from "../../features/key-identity/runtime/useResumeDeviceLinks";
import { KeySetupStep } from "../../features/key-identity/components/KeySetupStep";
import { RecoveryKitBanner } from "../../features/key-identity/components/RecoveryKitBanner";
import { useRelayRuntime } from "../../features/relay/runtime/relayRuntime";
import {
  useDirectSpaceRuntime,
  useLocalDirectSpaceId,
} from "../../features/relay/runtime/useDirectSpaceRuntime";
import { RelayNotices } from "../../features/relay/components/RelayNotices";
import { ProbationBanner } from "../../features/limits/components/ProbationBanner";
import { AccountDeletionBanner } from "../../features/account-deletion/components/AccountDeletionBanner";
import { AuditLogPage } from "../../features/audit/components/AuditLogPage";
import { DmRequestsPage } from "../../features/relay/components/DmRequestsPage";
import { StatusBar } from "../components/StatusBar";
import { FocusPulse } from "../navigation/FocusPulse";
import { cn } from "../../shared/ui/cn";
import { useZenModeTransition } from "../hooks/useZenModeTransition";
import { useAutoFocusComposer } from "../hooks/useAutoFocusComposer";
import { useGlobalKeyHandlers } from "../hooks/useGlobalKeyHandlers";

/**
 * Marks a main surface other than the conversation as the grid's main panel, so pane
 * navigation and the Vim layer can move focus into it.
 */
const MAIN_PANEL_PROPS = {
  "data-panel": "mainSurface",
  tabIndex: -1,
  onFocus: () => useShellStore.getState().setFocusedSurface("mainSurface"),
} as const;

/**
 * The signed-in app: the session is restored first, then the account's data must be unlocked on
 * this device before anything that reads it runs.
 */
export function AppShell() {
  const session = useAuthStore((s) => s.session);
  const { isHydrating } = useSessionHydration();
  useSessionEndedSignOut();
  const gate = useUnlockGate(isHydrating ? null : (session?.userId ?? null));
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

  if (isHydrating || (session && gate === "opening")) {
    return (
      <div className="flex h-screen flex-col bg-rim-void text-rim-text">
        {capabilities.customTitleBar && <TitleBar />}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <RestoringSessionSplash />
        </div>
      </div>
    );
  }

  if (!session) {
    // Redirect is in-flight via useEffect; render nothing to avoid flash.
    return null;
  }

  if (gate === "locked") {
    return (
      <div className="flex h-screen flex-col bg-rim-void text-rim-text">
        {capabilities.customTitleBar && <TitleBar />}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <UnlockScreen />
        </div>
        <ToastContainer />
      </div>
    );
  }

  return <UnlockedShell />;
}

/** The app once the account is unlocked: the runtimes that read its data, and the workspace. */
function UnlockedShell() {
  useOfflineReconnect();
  useResumeDeviceLinks();
  useRelayRuntime();
  useDirectSpaceRuntime();
  useUnreadEventHandler();
  usePluginPrincipalSync();
  usePluginChatRelay();
  useWebPluginRuntime();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { capabilities } = useRuntime();
  // Where the app lands after sign-in or signup: back to a public link left for it.
  usePendingPublicLinkReturn(true);

  if (!workspaceId) {
    return (
      <div className="flex h-screen flex-col bg-rim-void text-rim-text">
        {capabilities.customTitleBar && <TitleBar />}
        <AccountDeletionBanner />
        <ProbationBanner />
        <RecoveryKitBanner />
        <RemovalNotices />
        <div className="min-h-0 flex-1">
          <WorkspaceSelector />
        </div>
        <KeySetupStep />
        <ToastContainer />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-rim-void text-rim-text">
      {capabilities.customTitleBar && <TitleBar />}
      <OfflineBanner />
      <ConnectionBanner />
      <RelayNotices />
      <AccountDeletionBanner />
      <ProbationBanner />
      <RecoveryKitBanner />
      <RemovalNotices />
      <JoinDefaultWorkspace />
      <div className="flex min-h-0 flex-1">
        <WorkspaceShell />
      </div>
      <KeySetupStep />
    </div>
  );
}

function WorkspaceShell() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  // This relay's direct space is subscribed from sign-in by `useDirectSpaceRuntime`.
  const directSpaceId = useLocalDirectSpaceId();
  const subscribedHere = workspaceId === directSpaceId ? null : workspaceId;
  useWorkspaceEvents(subscribedHere);
  useMessageCacheSync(workspaceId);
  useE2eeRuntime(workspaceId);
  useUnreadCounts(workspaceId ?? undefined);
  useAllWorkspaceUnreadCounts(workspaceId);
  useMutedConversations(workspaceId ?? undefined);
  useWorkspacePresence(workspaceId);
  const selfId = useAuthStore((s) => s.session?.userId ?? null);
  useHeartbeat(workspaceId, selfId);
  usePluginEvents();
  useStatusExpiration();
  usePresenceEventHandler();
  useTypingEventHandler();
  useNotificationEventHandler(subscribedHere);

  const { capabilities } = useRuntime();
  const mainSurface = useShellStore((s) => s.mainSurface);
  const isThreadOpen = useShellStore((s) => s.isThreadOpen);
  const selectedRootMessageId = useShellStore((s) => s.selectedRootMessageId);
  const activePluginPanel = useShellStore((s) => s.activePluginPanel);
  const closePluginPanel = useShellStore((s) => s.closePluginPanel);
  const pinnedPanelOpen = useShellStore((s) => s.pinnedPanelOpen);
  const setPinnedPanelOpen = useShellStore((s) => s.setPinnedPanelOpen);
  const selectedConversationId = useShellStore((s) => s.selectedConversationId);
  const draftDirect = useShellStore((s) => s.draftDirect);
  const zenMode = useShellStore((s) => s.zenMode);
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);
  const toggleZenMode = useShellStore((s) => s.toggleZenMode);
  const { data: plugins } = usePluginList();

  const { zenContentHidden, handleZenTransitionEnd } = useZenModeTransition(zenMode);
  useAutoFocusComposer(mainSurface.kind);
  useGlobalKeyHandlers();

  const showThread = capabilities.dockedThreadPane && isThreadOpen && selectedRootMessageId;

  // Resolve the active plugin panel to plugin info + panel def
  const resolvedPluginPanel = useMemo(() => {
    if (!activePluginPanel || !plugins) return null;
    const plugin = plugins.find(
      (p) => p.plugin_id === activePluginPanel.pluginId && canShowPanels(p),
    );
    if (!plugin) return null;
    const panel = plugin.panels?.find((p) => p.id === activePluginPanel.panelId);
    if (!panel) return null;
    return { plugin, panel };
  }, [activePluginPanel, plugins]);

  const toolPanelPlugin =
    resolvedPluginPanel && panelSlot(resolvedPluginPanel.panel) === "tool_panel"
      ? resolvedPluginPanel
      : null;
  const mainAreaPlugin =
    resolvedPluginPanel && panelSlot(resolvedPluginPanel.panel) === "main_area"
      ? resolvedPluginPanel
      : null;

  return (
    <KeybindProvider>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-rim-void text-rim-text">
        <div className="flex min-h-0 min-w-0 flex-1">
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
                    // One column that never grows past the slot, whatever the panel's header holds.
                    "grid w-72 shrink-0 grid-cols-1 overflow-hidden border-r border-rim-line bg-rim-panel transition-opacity duration-300",
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
                <main {...MAIN_PANEL_PROPS} className="flex min-w-0 flex-1 flex-col outline-none">
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
                    {draftDirect ? (
                      <DraftDirectView draft={draftDirect} />
                    ) : (
                      <InvitationGate
                        workspaceId={workspaceId}
                        conversationId={selectedConversationId}
                      >
                        <MessageTimeline />
                      </InvitationGate>
                    )}
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
                    "grid w-80 shrink-0 border-l border-rim-line transition-opacity duration-300 *:min-w-0",
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
                    "grid w-80 shrink-0 transition-opacity duration-300 *:min-w-0",
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
            </>
          )}

          {mainSurface.kind === "settings" && (
            <main {...MAIN_PANEL_PROPS} className="flex min-w-0 flex-1 flex-col outline-none">
              <SurfaceErrorBoundary surface="Settings" resetKeys={[]}>
                <SettingsPage />
              </SurfaceErrorBoundary>
            </main>
          )}

          {mainSurface.kind === "audit-log" && (
            <main {...MAIN_PANEL_PROPS} className="flex min-w-0 flex-1 flex-col outline-none">
              <SurfaceErrorBoundary surface="Audit log" resetKeys={[]}>
                <AuditLogPage />
              </SurfaceErrorBoundary>
            </main>
          )}

          {mainSurface.kind === "dm-requests" && (
            <main {...MAIN_PANEL_PROPS} className="flex min-w-0 flex-1 flex-col outline-none">
              <SurfaceErrorBoundary
                surface="Message requests"
                resetKeys={[mainSurface.workspaceId]}
              >
                <DmRequestsPage workspaceId={mainSurface.workspaceId} />
              </SurfaceErrorBoundary>
            </main>
          )}

          {mainSurface.kind === "plugin" &&
            (() => {
              // Resolve the plugin and its first panel for the main-area slot.
              const mainPlugin = plugins?.find(
                (p) => p.plugin_id === mainSurface.pluginId && canShowPanels(p),
              );
              const mainPanel = mainPlugin?.panels?.[0];
              if (mainPlugin && mainPanel) {
                return (
                  <main {...MAIN_PANEL_PROPS} className="flex min-w-0 flex-1 flex-col outline-none">
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
                <main
                  {...MAIN_PANEL_PROPS}
                  className="flex min-w-0 flex-1 flex-col items-center justify-center outline-none"
                >
                  <p className="text-sm text-rim-text-muted">
                    Plugin {mainSurface.pluginId} is not enabled or has no panels.
                  </p>
                </main>
              );
            })()}

          {mainSurface.kind === "marketplace" && (
            <main
              {...MAIN_PANEL_PROPS}
              className="flex min-w-0 flex-1 flex-col items-center justify-center outline-none"
            >
              <p className="text-sm text-rim-text-muted">Marketplace coming soon!</p>
            </main>
          )}

          <CommandPalette />
          <ShortcutsPanel />
          <SearchOverlay />
          <AgentOverlay />
          <ConfirmCommandModal />
          <PluginCommandConfirmDialog />
          <ConversationActionConfirmHost />
          <PluginSettingsDialogHost />
          <RegistryHost />
          <QuickAccessAssigner />
          <ToastContainer />
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
