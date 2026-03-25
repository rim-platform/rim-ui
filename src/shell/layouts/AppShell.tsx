import { useAuthStore } from "../../features/auth/state/useAuthStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useWorkspaceEvents } from "../../core/events/useWorkspaceEvents";
import { AuthGate } from "../../features/auth/components/AuthGate";
import { WorkspaceSelector } from "../../features/workspaces/components/WorkspaceSelector";
import { MessageTimeline } from "../../features/messages/components/MessageTimeline";
import { ThreadPanel } from "../../features/threads/components/ThreadPanel";
import { CommandPalette, KeybindProvider } from "../../features/commands";
import { useRuntime } from "../../core/runtime/RuntimeProvider";
import { useShellStore } from "../state/useShellStore";
import { WorkspaceRail } from "../components/WorkspaceRail";
import { SideRail } from "../components/SideRail";
import { ToolPanel } from "../components/ToolPanel";
import { ConversationHeader } from "../components/ConversationHeader";
import { SettingsPage } from "../../features/settings/components/SettingsPage";

export function AppShell() {
  const session = useAuthStore((s) => s.session);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  if (!session) {
    return <AuthGate />;
  }

  if (!workspaceId) {
    return <WorkspaceSelector />;
  }

  return <WorkspaceShell />;
}

function WorkspaceShell() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  useWorkspaceEvents(workspaceId);

  const { capabilities } = useRuntime();
  const mainSurface = useShellStore((s) => s.mainSurface);
  const isThreadOpen = useShellStore((s) => s.isThreadOpen);
  const selectedRootMessageId = useShellStore((s) => s.selectedRootMessageId);

  const showThread = capabilities.dockedThreadPane && isThreadOpen && selectedRootMessageId;

  return (
    <KeybindProvider>
      <div className="flex h-screen bg-rim-void text-rim-text">
        <WorkspaceRail />
        <SideRail />

        {mainSurface.kind === "conversation" && (
          <>
            <ToolPanel />
            <main className="flex min-w-0 flex-1 flex-col">
              <ConversationHeader />
              <MessageTimeline />
            </main>
            {showThread && (
              <div className="w-80 shrink-0 border-l border-rim-line">
                <ThreadPanel />
              </div>
            )}
          </>
        )}

        {mainSurface.kind === "settings" && (
          <main className="flex min-w-0 flex-1 flex-col">
            <SettingsPage />
          </main>
        )}

        <CommandPalette />
      </div>
    </KeybindProvider>
  );
}
