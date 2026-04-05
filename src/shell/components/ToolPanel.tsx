import { Plus } from "lucide-react";

import { ConversationList } from "../../features/conversations/components/ConversationList";
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

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-rim-line bg-rim-panel">
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-3">
        <h2 className="text-sm font-medium text-rim-text">
          {activePanel === "inbox" ? "Conversations" : "Plugins"}
        </h2>
        {activePanel === "inbox" && (
          <button
            type="button"
            onClick={() => setShowNewMessage(true)}
            title="New message"
            aria-label="New message"
            className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {activePanel === "inbox" && (
          <ConversationList onNewChannel={() => setShowNewChannel(true)} />
        )}
        {activePanel === "plugins" && <PluginToolPanel />}
      </div>
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
