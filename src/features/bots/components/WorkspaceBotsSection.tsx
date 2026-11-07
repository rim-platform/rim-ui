import { useState } from "react";
import { Bot } from "lucide-react";

import { BotBadge } from "../../../shared/ui/BotBadge";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { botName, useWorkspaceBots, type WorkspaceBot } from "../hooks/useWorkspaceBots";
import { BotCardDialog } from "./BotCardDialog";

/**
 * The conversation list's Bots section: the workspace's active bots by name, each marked as a
 * bot, for every member. A bot opens its card. Nothing renders while the workspace has no active
 * bot, in the direct space, or where its host does not mark bots.
 *
 * @param workspaceId - The open workspace.
 */
export function WorkspaceBotsSection({ workspaceId }: { workspaceId: string | null }) {
  const bots = useWorkspaceBots(workspaceId);
  const [shown, setShown] = useState<WorkspaceBot | null>(null);
  if (bots.length === 0) return null;
  return (
    <div>
      <h3 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
        Bots
      </h3>
      <ul className="space-y-0.5" aria-label="Bots">
        {bots.map((bot) => (
          <li key={bot.userId}>
            <button
              type="button"
              onClick={() => setShown(bot)}
              aria-haspopup="dialog"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
            >
              <Bot aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {showInvisibleCharacters(botName(bot))}
              </span>
              <BotBadge />
            </button>
          </li>
        ))}
      </ul>
      <BotCardDialog bot={shown} onClose={() => setShown(null)} />
    </div>
  );
}
