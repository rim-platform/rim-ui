import { Plus } from "lucide-react";

import { ConversationList } from "../../features/conversations/components/ConversationList";
import { NewChannelDialog } from "../../features/conversations/components/NewChannelDialog";
import { NewMessagePicker } from "../../features/conversations/components/NewMessagePicker";
import { useShellStore } from "../state/useShellStore";
import { useState } from "react";

export function ToolPanel() {
  const activePanel = useShellStore((s) => s.activePanel);
  const setActivePanel = useShellStore((s) => s.setActivePanel);
  const setSelectedConversationId = useShellStore((s) => s.setSelectedConversationId);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);

  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-rim-line bg-rim-panel">
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-3">
        <h2 className="text-sm font-medium text-white">
          {activePanel === "inbox"
            ? "Conversations"
            : activePanel === "search"
              ? "Search"
              : "Plugins"}
        </h2>
        {activePanel === "inbox" && (
          <button
            type="button"
            onClick={() => setShowNewMessage(true)}
            title="New message"
            aria-label="New message"
            className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-white"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {activePanel === "inbox" && (
          <ConversationList onNewChannel={() => setShowNewChannel(true)} />
        )}
        {activePanel === "search" && (
          <p className="px-2 py-4 text-sm text-rim-text-muted">Search coming soon.</p>
        )}
        {activePanel === "plugins" && (
          <p className="px-2 py-4 text-sm text-rim-text-muted">Plugin panels coming soon.</p>
        )}
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
