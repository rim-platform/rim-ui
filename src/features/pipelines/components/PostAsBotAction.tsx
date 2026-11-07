import { ChevronDown, X } from "lucide-react";
import { useId } from "react";

import { useBots } from "../../bots/api/botsApi";
import { useAllChannels } from "../../bots/api/useAllChannels";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useArchivedChannels } from "../../conversations/api/useChannels";
import type { PostAsBot } from "../postAsBot";

/** Said above an editable action: nobody confirms what it posts. */
const NOBODY_ASKED = "Posted by the bot, without asking anyone, each time someone joins.";

/** Shown for a channel that is not among those the viewer can see. */
export const UNSEEN_CHANNEL = "a channel you can't see";

/** Shown for a channel while the viewer's channels are still loading. */
const LOADING_CHANNEL = "a channel";

/** Shown for a bot the viewer's list does not hold. */
const UNKNOWN_BOT = "a bot";

const SELECT_CLASS =
  "w-full appearance-none rounded border border-rim-line bg-rim-panel px-2 py-1.5 pr-8 text-sm text-rim-text outline-none focus:border-rim-accent";

/**
 * A workspace's bots and channels as the viewer may see them.
 *
 * @param serverId - The workspace.
 * @returns The lists, and how to name a bot and a channel, each name with its invisible
 *   characters shown.
 */
export function usePostAsBotNames(serverId: string) {
  const bots = useBots(serverId);
  const channels = useAllChannels(serverId);
  const archived = useArchivedChannels(serverId, Boolean(channels.data));
  return {
    bots: bots.data ?? [],
    channels: channels.data?.items ?? [],
    channelsLoaded: channels.isSuccess,
    botName(botUserId: string): string {
      const bot = bots.data?.find((b) => b.userId === botUserId);
      return bot ? showInvisibleCharacters(bot.name) : UNKNOWN_BOT;
    },
    channelName(conversationId: string): string {
      const channel =
        channels.data?.items.find((c) => c.id === conversationId) ??
        archived.data?.find((c) => c.id === conversationId);
      if (channel?.title) return `#${showInvisibleCharacters(channel.title)}`;
      return channels.isPending ? LOADING_CHANNEL : UNSEEN_CHANNEL;
    },
  };
}

/**
 * One line naming a Post as bot action and the text it posts, read-only, with no id in it.
 *
 * @param action - The action.
 * @param names - The names from {@link usePostAsBotNames}.
 */
export function PostAsBotSummary({
  action,
  names,
}: {
  action: PostAsBot;
  names: ReturnType<typeof usePostAsBotNames>;
}) {
  return (
    <div className="min-w-0 text-xs">
      <p className="break-words text-rim-text-muted">
        Post as {names.botName(action.botUserId)} in {names.channelName(action.conversationId)}
      </p>
      {action.text && (
        <p className="whitespace-pre-wrap break-words text-rim-text-faint">
          {showInvisibleCharacters(action.text)}
        </p>
      )}
    </div>
  );
}

interface PostAsBotFieldsProps {
  serverId: string;
  index: number;
  action: PostAsBot;
  /** Why it is read-only, for someone who may keep the action and not change it; else nothing. */
  lockedNote: string | null;
  /** Whether the pipeline's trigger is one the action runs on. */
  triggerFits: boolean;
  /** Why it could not be saved, as the server said. */
  error: string | null;
  onChange: (next: PostAsBot) => void;
  onRemove: () => void;
}

/**
 * One Post as bot action in the pipeline editor: a bot, one of that bot's channels and the text,
 * or for someone who may not change it the same read-only, with the action still removable.
 */
export function PostAsBotFields({
  serverId,
  index,
  action,
  lockedNote,
  triggerFits,
  error,
  onChange,
  onRemove,
}: PostAsBotFieldsProps) {
  const names = usePostAsBotNames(serverId);
  const hintId = useId();
  const errorId = useId();

  const activeBots = names.bots.filter((b) => !b.deactivatedAt);
  const botChannels = names.channels
    .filter((c) => c.memberIds.includes(action.botUserId) && !c.encryptedAt)
    .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
  // A saved channel stays chosen until someone changes it, under the name the viewer may see.
  const savedElsewhere =
    action.conversationId !== "" && !botChannels.some((c) => c.id === action.conversationId);
  const noChannels =
    action.botUserId !== "" && names.channelsLoaded && botChannels.length === 0 && !savedElsewhere;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-rim-line bg-rim-void p-3">
      <span className="mt-1 font-mono text-xs text-rim-text-muted">{index + 1}.</span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-rim-text">Post as bot</p>
        {lockedNote ? (
          <>
            <PostAsBotSummary action={action} names={names} />
            <p className="text-xs text-rim-text-faint">{lockedNote}</p>
          </>
        ) : (
          <>
            <p className="text-xs text-rim-text-muted">{NOBODY_ASKED}</p>
            <div className="relative">
              <select
                aria-label={`Bot of action ${index + 1}`}
                value={action.botUserId}
                onChange={(e) =>
                  onChange({ ...action, botUserId: e.target.value, conversationId: "" })
                }
                className={SELECT_CLASS}
              >
                <option value="">Choose a bot</option>
                {activeBots.map((bot) => (
                  <option key={bot.userId} value={bot.userId}>
                    {showInvisibleCharacters(bot.name)}
                  </option>
                ))}
                {action.botUserId !== "" &&
                  !activeBots.some((b) => b.userId === action.botUserId) && (
                    <option value={action.botUserId}>{names.botName(action.botUserId)}</option>
                  )}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-rim-text-muted" />
            </div>
            {noChannels ? (
              <p className="text-xs text-rim-text-muted">
                This bot is in no channels yet. Add it to one in Settings &gt; Bots.
              </p>
            ) : (
              <div className="relative">
                <select
                  aria-label={`Channel of action ${index + 1}`}
                  value={action.conversationId}
                  disabled={action.botUserId === ""}
                  onChange={(e) => onChange({ ...action, conversationId: e.target.value })}
                  className={`${SELECT_CLASS} disabled:opacity-50`}
                >
                  <option value="">Choose a channel</option>
                  {botChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{showInvisibleCharacters(channel.title ?? "Untitled")}
                    </option>
                  ))}
                  {savedElsewhere && (
                    <option value={action.conversationId}>
                      {names.channelName(action.conversationId)}
                    </option>
                  )}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-rim-text-muted" />
              </div>
            )}
            <textarea
              aria-label={`Text of action ${index + 1}`}
              aria-describedby={error ? `${hintId} ${errorId}` : hintId}
              aria-invalid={error ? true : undefined}
              value={action.text}
              onChange={(e) => onChange({ ...action, text: e.target.value })}
              placeholder="Welcome, {name}!"
              rows={2}
              className="w-full resize-y rounded border border-rim-line bg-rim-panel px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
            />
            <p id={hintId} className="text-xs text-rim-text-faint">
              <code>{"{username}"}</code> is their username, at their home server if they&apos;re
              from another one. <code>{"{name}"}</code> is their display name, or their username
              without one. A welcome mentions nobody, and every member can read this text in the
              list.
            </p>
          </>
        )}
        {!triggerFits && (
          <p className="text-xs text-rim-danger">This only runs on the Member Joined trigger.</p>
        )}
        {error && (
          <p id={errorId} role="alert" className="break-words text-xs text-rim-danger">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove action ${index + 1}`}
        className="mt-1 rounded p-0.5 text-rim-text-muted transition hover:text-rim-danger"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
