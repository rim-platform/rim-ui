import { useEffect, useMemo } from "react";
import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useSessionHydration } from "../../features/auth/api/useSessionHydration";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useWorkspaceEvents } from "../../core/events/useWorkspaceEvents";
import { AuthGate } from "../../features/auth/components/AuthGate";
import { WorkspaceSelector } from "../../features/workspaces/components/WorkspaceSelector";
import { MessageTimeline } from "../../features/messages/components/MessageTimeline";
import { ThreadPanel } from "../../features/threads/components/ThreadPanel";
import { CommandPalette, KeybindProvider } from "../../features/commands";
import { QuickAccessAssigner } from "../../features/commands/components/QuickAccessAssigner";
import { SearchOverlay } from "../../features/messages/components/SearchOverlay";
import { ToastContainer } from "../../shared/toast";
import { AgentOverlay } from "../../features/agent/components/AgentOverlay";
import { useUnreadCounts } from "../../features/conversations/api/useUnreadCounts";
import { useMutedConversations } from "../../features/conversations/api/useMutedConversations";
import { useWorkspacePresence } from "../../features/presence/api/useWorkspacePresence";
import { useHeartbeat } from "../../features/presence/runtime/useHeartbeat";
import { usePluginEvents } from "../../features/plugins/runtime/pluginEventBus";
import { usePluginList } from "../../features/plugins/api/usePluginList";
import { useStatusExpiration } from "../../features/settings/hooks/useStatusExpiration";
import { PluginSlotContainer } from "../../features/plugins/components/PluginSlotContainer";
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

export function AppShell() {
  const session = useAuthStore((s) => s.session);
  const { isHydrating } = useSessionHydration();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { capabilities } = useRuntime();

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
    return (
      <div className="flex h-screen flex-col bg-rim-void text-rim-text">
        {capabilities.customTitleBar && <TitleBar />}
        <div className="min-h-0 flex-1">
          <AuthGate />
        </div>
      </div>
    );
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
  useUnreadCounts(workspaceId ?? undefined);
  useMutedConversations(workspaceId ?? undefined);
  useWorkspacePresence(workspaceId);
  useHeartbeat(workspaceId);
  usePluginEvents();
  useStatusExpiration();

  const { capabilities } = useRuntime();
  const mainSurface = useShellStore((s) => s.mainSurface);
  const isThreadOpen = useShellStore((s) => s.isThreadOpen);
  const selectedRootMessageId = useShellStore((s) => s.selectedRootMessageId);
  const activePluginPanel = useShellStore((s) => s.activePluginPanel);
  const closePluginPanel = useShellStore((s) => s.closePluginPanel);
  const pinnedPanelOpen = useShellStore((s) => s.pinnedPanelOpen);
  const setPinnedPanelOpen = useShellStore((s) => s.setPinnedPanelOpen);
  const selectedConversationId = useShellStore((s) => s.selectedConversationId);
  const { data: plugins } = usePluginList();

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // Skip if modifier keys (except Shift) are held
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Skip non-printable keys
      if (e.key.length !== 1) return;
      // Skip if already focused on an input/textarea/contenteditable
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) return;

      const composer = document.querySelector<HTMLTextAreaElement>("[data-composer-input]");
      if (composer) {
        composer.focus();
        // Don't preventDefault — let the character land in the textarea naturally
      }
    }

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const showThread = capabilities.dockedThreadPane && isThreadOpen && selectedRootMessageId;

  // Resolve the active plugin panel to plugin info + panel def
  const resolvedPluginPanel = useMemo(() => {
    if (!activePluginPanel || !plugins) return null;
    const plugin = plugins.find(
      (p) => p.manifest.id === activePluginPanel.pluginId && p.enabled,
    );
    if (!plugin) return null;
    const panel = plugin.manifest.panels?.find(
      (p) => p.id === activePluginPanel.panelId,
    );
    if (!panel) return null;
    return { plugin, panel };
  }, [activePluginPanel, plugins]);

  const toolPanelPlugin = resolvedPluginPanel?.panel.slot === "tool_panel" ? resolvedPluginPanel : null;
  const mainAreaPlugin = resolvedPluginPanel?.panel.slot === "main_area" ? resolvedPluginPanel : null;

  return (
    <KeybindProvider>
      <div className="flex min-h-0 flex-1 bg-rim-void text-rim-text">
        <WorkspaceRail />
        <SideRail />

        {mainSurface.kind === "conversation" && (
          <>
            <ToolPanel />

            {/* Plugin tool_panel slot — renders next to ToolPanel */}
            {toolPanelPlugin && (
              <div className="w-72 shrink-0 border-r border-rim-line bg-rim-panel">
                <PluginSlotContainer
                  plugin={toolPanelPlugin.plugin}
                  panel={toolPanelPlugin.panel}
                  onClose={closePluginPanel}
                />
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
              <main className="flex min-w-0 flex-1 flex-col">
                <ConversationHeader />
                <MessageTimeline />
              </main>
            )}

            {!mainAreaPlugin && showThread && (
              <div className="w-80 shrink-0 border-l border-rim-line">
                <ThreadPanel />
              </div>
            )}

            {!mainAreaPlugin && pinnedPanelOpen && workspaceId && selectedConversationId && (
              <div className="w-80 shrink-0">
                <PinnedMessagesPanel
                  workspaceId={workspaceId}
                  conversationId={selectedConversationId}
                  onClose={() => setPinnedPanelOpen(false)}
                />
              </div>
            )}
          </>
        )}

        {mainSurface.kind === "settings" && (
          <main className="flex min-w-0 flex-1 flex-col">
            <SettingsPage />
          </main>
        )}

        {mainSurface.kind === "plugin" && (
          <main className="flex min-w-0 flex-1 flex-col items-center justify-center">
            <p className="text-sm text-rim-text-muted">
              Plugin view for {mainSurface.pluginId}. Coming soon!
            </p>
          </main>
        )}

        {mainSurface.kind === "marketplace" && (
          <main className="flex min-w-0 flex-1 flex-col items-center justify-center">
            <p className="text-sm text-rim-text-muted">Marketplace coming soon!</p>
          </main>
        )}

        <CommandPalette />
        <SearchOverlay />
        <AgentOverlay />
        <QuickAccessAssigner />
        <ToastContainer />
      </div>
    </KeybindProvider>
  );
}
