import { Plus, Users } from "lucide-react";

import { ConversationList } from "../../features/conversations/components/ConversationList";
import { ConversationMembersPanel } from "../../features/conversations/components/ConversationMembersPanel";
import { useMembersPanelStore } from "../../features/conversations/state/useMembersPanelStore";
import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useMemberDirectoryStore } from "../../features/workspaces/state/useMemberDirectoryStore";
import { useIsGuest } from "../../features/workspaces/api/useMyServerRole";
import { WorkspaceMemberDirectory } from "../../features/workspaces/components/WorkspaceMemberDirectory";
import { NewChannelDialog } from "../../features/conversations/components/NewChannelDialog";
import { NewMessagePicker } from "../../features/conversations/components/NewMessagePicker";
import { PluginToolPanel } from "../../features/plugins/components/PluginToolPanel";
import { useShellStore } from "../state/useShellStore";

export function ToolPanel() {
  const activePanel = useShellStore((s) => s.activePanel);
  const setActivePanel = useShellStore((s) => s.setActivePanel);
  const setSelectedConversationId = useShellStore((s) => s.setSelectedConversationId);
  const showNewMessage = useShellStore((s) => s.showNewMessagePicker);
  const setShowNewMessage = useShellStore((s) => s.setShowNewMessagePicker);
  const showNewChannel = useShellStore((s) => s.showNewChannelDialog);
  const setShowNewChannel = useShellStore((s) => s.setShowNewChannelDialog);
  const selectedConversationId = useShellStore((s) => s.selectedConversationId);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const membersOpen = useMembersPanelStore((s) => s.open);
  const setMembersOpen = useMembersPanelStore((s) => s.setOpen);
  const directoryOpen = useMemberDirectoryStore((s) => s.open);
  const setDirectoryOpen = useMemberDirectoryStore((s) => s.setOpen);
  // Guests have no member directory (Track 1.2); the server narrows their member list too.
  const isGuest = useIsGuest(workspaceId ?? undefined);
  // The members panel takes over the tool panel while a conversation is open in the inbox.
  const showMembers =
    membersOpen && activePanel === "inbox" && Boolean(workspaceId && selectedConversationId);
  const showDirectory = !showMembers && directoryOpen && activePanel === "inbox" && !isGuest;

  return (
    <div
      data-panel="toolPanel"
      tabIndex={-1}
      onFocus={() => useShellStore.getState().setFocusedSurface("toolPanel")}
      className="flex w-64 shrink-0 flex-col border-r border-rim-line bg-rim-panel outline-none"
    >
      {showMembers && workspaceId && selectedConversationId ? (
        <ConversationMembersPanel
          workspaceId={workspaceId}
          conversationId={selectedConversationId}
          onClose={() => setMembersOpen(false)}
        />
      ) : showDirectory && workspaceId ? (
        <WorkspaceMemberDirectory
          workspaceId={workspaceId}
          onClose={() => setDirectoryOpen(false)}
        />
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-rim-line px-4 py-3">
            <h2 className="text-sm font-medium text-rim-text">
              {activePanel === "inbox" ? "Conversations" : "Plugins"}
            </h2>
            {activePanel === "inbox" && (
              <div className="flex items-center gap-0.5">
                {!isGuest && workspaceId && (
                  <button
                    type="button"
                    onClick={() => {
                      setMembersOpen(false);
                      setDirectoryOpen(true);
                    }}
                    title="Workspace members"
                    aria-label="Workspace members"
                    className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
                  >
                    <Users className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowNewMessage(true)}
                  title="New message"
                  aria-label="New message"
                  className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {activePanel === "inbox" && (
              <ConversationList onNewChannel={() => setShowNewChannel(true)} />
            )}
            {activePanel === "plugins" && <PluginToolPanel />}
          </div>
        </>
      )}
      <NewMessagePicker
        open={showNewMessage}
        onClose={() => setShowNewMessage(false)}
        onCreated={(conversationId) => {
          setSelectedConversationId(conversationId);
          setActivePanel("inbox");
          setShowNewMessage(false);
        }}
      />
      {showNewChannel && <NewChannelDialog onClose={() => setShowNewChannel(false)} />}
    </div>
  );
}
