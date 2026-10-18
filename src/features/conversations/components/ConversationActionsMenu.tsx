import { MoreHorizontal } from "lucide-react";

import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { useContextMenu } from "../../../shared/ui/contextMenu/useContextMenu";
import { useConversationMenuItems } from "../hooks/useConversationMenuItems";
import type { ConversationSummary } from "../types";

interface ConversationActionsMenuProps {
  workspaceId: string;
  conversation: ConversationSummary;
}

/**
 * The conversation header's "…" button: the conversation's menu, as its sidebar row has it,
 * with Members on a DM too and, in the desktop app, the agent's switch for an encrypted
 * conversation.
 */
export function ConversationActionsMenu({
  workspaceId,
  conversation,
}: ConversationActionsMenuProps) {
  const menu = useContextMenu();
  const { getItems, dialogs } = useConversationMenuItems(workspaceId);

  return (
    <>
      <HoverTooltip
        content={<span className="text-xs text-rim-text whitespace-nowrap">More actions</span>}
      >
        <button
          type="button"
          aria-label="Conversation menu"
          aria-haspopup="menu"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            menu.openAt({ x: rect.right - 180, y: rect.bottom + 4 }, () =>
              getItems(conversation, { header: true }),
            );
          }}
          className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </HoverTooltip>

      {menu.menu}
      {dialogs}
    </>
  );
}
