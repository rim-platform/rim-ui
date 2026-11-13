import { Bot, Terminal } from "lucide-react";

import { BotBadge } from "../../../shared/ui/BotBadge";
import { BotDisclosure } from "../../../shared/ui/UserCardContent";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useAgentsReadingChannel } from "../../agents/hooks/useAgentsReadingChannel";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useConversation } from "../../conversations/api/useConversation";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import { botName, botsInChannel, useWorkspaceBots } from "../hooks/useWorkspaceBots";

interface ChannelBotsPanelProps {
  workspaceId: string;
  conversationId: string;
  onClose: () => void;
}

/**
 * Bots in this channel: each active bot that is a member, with what the person who added it says
 * and that RIM can't check it; a link to Settings > Bots for an Owner or Moderator; and the
 * programs connected on this device whose grant covers the channel.
 */
export function ChannelBotsPanel({ workspaceId, conversationId, onClose }: ChannelBotsPanelProps) {
  const { data: conversation } = useConversation(workspaceId, conversationId);
  const bots = botsInChannel(useWorkspaceBots(workspaceId), conversation);
  const agents = useAgentsReadingChannel(workspaceId, conversation);
  const canModerate = useCanModerate(workspaceId);
  const open = (tab: "bots" | "agents") =>
    useShellStore.getState().setMainSurface({ kind: "settings", tab });

  return (
    <section
      aria-label="Bots in this channel"
      className="flex h-full flex-col border-l border-rim-line bg-rim-panel"
    >
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-2">
        <div className="flex items-center gap-2">
          <Bot aria-hidden className="h-4 w-4 text-rim-accent" />
          <h3 className="text-sm font-medium text-rim-text">Bots in this channel</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close bots in this channel"
          className="rounded p-1 text-rim-text-muted transition hover:text-rim-text"
        >
          &times;
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {bots.length === 0 ? (
          <p className="text-sm text-rim-text-muted">No bots in this channel.</p>
        ) : (
          <ul className="space-y-3">
            {bots.map((bot) => (
              <li key={bot.userId} className="rounded-lg border border-rim-line p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-rim-text">
                    {showInvisibleCharacters(botName(bot))}
                  </span>
                  <BotBadge />
                </div>
                <BotDisclosure bot={bot.bot} />
              </li>
            ))}
          </ul>
        )}
        {canModerate && (
          <button
            type="button"
            onClick={() => open("bots")}
            className="text-xs text-rim-accent hover:underline"
          >
            Manage bots in Settings &gt; Bots &amp; webhooks
          </button>
        )}
        {agents.length > 0 && (
          <div>
            <h4 className="pb-2 text-[11px] font-medium uppercase tracking-wider text-rim-text-faint">
              Your agents
            </h4>
            <ul className="space-y-2">
              {agents.map((agent) => (
                <li key={agent.id} className="rounded-lg border border-rim-line p-3 text-xs">
                  <p className="flex items-center gap-2 text-sm font-medium text-rim-text">
                    <Terminal aria-hidden className="h-3.5 w-3.5" />
                    {showInvisibleCharacters(agent.name)}
                  </p>
                  <p className="mt-1 text-rim-text-muted">
                    {agent.everyChannel
                      ? "You let it read every channel of this workspace, this one included."
                      : "You let it read this channel."}
                  </p>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => open("agents")}
              className="mt-2 text-xs text-rim-accent hover:underline"
            >
              Change this in Settings &gt; Agents
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
