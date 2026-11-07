import { Dialog } from "../../../shared/ui/Dialog";
import { UserCardContent } from "../../../shared/ui/UserCardContent";
import { botName, type WorkspaceBot } from "../hooks/useWorkspaceBots";

/**
 * A bot's profile card as a dialog: the same card its name opens in a message, with what the
 * person who added it says. Escape or Close dismisses it, and focus returns where it was.
 *
 * @param bot - The bot shown, or `null` while the dialog is closed.
 */
export function BotCardDialog({ bot, onClose }: { bot: WorkspaceBot | null; onClose: () => void }) {
  return (
    <Dialog open={bot !== null} onClose={onClose} title={bot ? botName(bot) : "Bot"}>
      {bot && (
        <UserCardContent
          userId={bot.userId}
          username={bot.username}
          displayName={bot.displayName}
          avatarUrl={bot.avatarUrl}
          joinedAt={bot.joinedAt}
          isBot
          bot={bot.bot}
        />
      )}
    </Dialog>
  );
}
