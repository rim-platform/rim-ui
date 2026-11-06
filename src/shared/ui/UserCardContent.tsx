import { useCallback } from "react";
import { Copy, MessageCircle, Pencil, UserX } from "lucide-react";

import type { BotInfo } from "../../core/graphql/generated/schema-types";
import { activeBan } from "../utils/banStatus";
import type { AuthorBan } from "../utils/banStatus";
import { Avatar, type PresenceStatus } from "./Avatar";
import { toast } from "../toast";
import { formatRelativeDate } from "../utils/formatDate";
import { viewHandle, type HandleView } from "../utils/handles";
import { hourCycleOptions } from "../utils/formatTime";
import { BotBadge } from "./BotBadge";

export interface UserCardContentProps {
  userId: string;
  isFormerMember?: boolean;
  ban?: AuthorBan;
  username: string;
  /**
   * How the person's handle reads and what Copy puts on the clipboard; without it, `@username`
   * unless the username is a server's internal name for a person from elsewhere.
   */
  handle?: HandleView | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  statusText?: string | null;
  role?: string;
  /** The person is a bot: no message, block or presence, and what its adder says is shown. */
  isBot?: boolean;
  /** What the person who added a bot says about it. */
  bot?: BotInfo | null;
  joinedAt?: string;
  bio?: string | null;
  presenceStatus?: PresenceStatus | null;
  isCurrentUser?: boolean;
  /** Opens the direct message with this person; without it the card offers no Send DM. */
  onSendDm?: () => void;
  /**
   * Called as the card renders: the Block… action for this person, or undefined when they
   * cannot be blocked from here.
   */
  blockAction?: () => (() => void) | undefined;
}

export function UserCardContent({
  userId,
  isFormerMember,
  ban,
  username,
  handle,
  displayName,
  avatarUrl,
  statusText,
  role,
  isBot,
  bot,
  joinedAt,
  bio,
  presenceStatus,
  isCurrentUser,
  onSendDm,
  blockAction,
}: UserCardContentProps) {
  const onBlock = isCurrentUser || isBot ? undefined : blockAction?.();
  const resolvedDisplayName = displayName ?? username;
  // A bot has no handle to show or copy.
  const shownHandle = isBot
    ? null
    : handle === undefined
      ? viewHandle(username, null, null)
      : handle;
  const copied = shownHandle?.copied;

  const handleCopyUsername = useCallback(() => {
    if (!copied) return;
    navigator.clipboard.writeText(copied);
    toast.success(`Copied ${copied}`);
  }, [copied]);

  return (
    <>
      {/* Header: avatar + names */}
      <div className="flex items-start gap-3">
        <Avatar
          url={avatarUrl}
          name={resolvedDisplayName}
          userId={userId}
          size="lg"
          presenceStatus={isBot ? undefined : presenceStatus}
        />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-base font-semibold text-rim-text truncate">{resolvedDisplayName}</p>
          {isBot && <BotBadge className="mt-0.5" />}
          {shownHandle && (
            <p className="text-sm text-rim-text-muted truncate" title={shownHandle.copied}>
              {shownHandle.shown}
            </p>
          )}
        </div>
      </div>

      {activeBan(ban) ? (
        <div className="mt-2 text-sm text-rim-text-muted">
          <p>
            Banned from this workspace
            {ban?.bannedUntil
              ? ` until ${new Date(ban.bannedUntil).toLocaleString(undefined, hourCycleOptions())}`
              : ""}
          </p>
          {ban?.banReason && (
            <p className="whitespace-pre-wrap break-words">Reason: {ban.banReason}</p>
          )}
        </div>
      ) : (
        isFormerMember && (
          <p className="mt-2 text-sm text-rim-text-muted">Not a member of this workspace</p>
        )
      )}

      {/* Status */}
      {statusText && !isBot && <p className="mt-2 text-sm text-rim-text-muted">{statusText}</p>}

      {/* Details */}
      {isBot && bot && <BotDisclosure bot={bot} />}

      {(role || joinedAt || bio) && (
        <>
          <hr className="border-rim-line my-3" />
          <div className="space-y-1 text-xs">
            {role && !isBot && (
              <p className="text-rim-text-muted">
                Role: <span className="text-rim-text capitalize">{role.toLowerCase()}</span>
              </p>
            )}
            {joinedAt && (
              <p className="text-rim-text-muted">
                Joined: <span className="text-rim-text">{formatRelativeDate(joinedAt)}</span>
              </p>
            )}
            {bio && <p className="mt-1.5 text-rim-text line-clamp-2">{bio}</p>}
          </div>
        </>
      )}

      {/* Actions */}
      {isBot ? null : (
        <>
          <hr className="border-rim-line my-3" />
          <div className="flex flex-wrap items-center gap-2">
            {isCurrentUser ? (
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text-muted transition hover:text-rim-text"
              >
                <Pencil className="h-3 w-3" />
                Edit Status
              </button>
            ) : (
              <>
                {onSendDm && !isFormerMember && !activeBan(ban) && (
                  <button
                    type="button"
                    onClick={onSendDm}
                    className="flex items-center gap-1.5 rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text-muted transition hover:text-rim-text"
                  >
                    <MessageCircle className="h-3 w-3" />
                    Send DM
                  </button>
                )}
                {shownHandle && (
                  <button
                    type="button"
                    onClick={handleCopyUsername}
                    className="flex items-center gap-1.5 rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text-muted transition hover:text-rim-text"
                  >
                    <Copy className="h-3 w-3" />
                    Copy {shownHandle.shown}
                  </button>
                )}
                {onBlock && (
                  <button
                    type="button"
                    onClick={onBlock}
                    className="flex items-center gap-1.5 rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-xs text-rim-text-muted transition hover:text-rim-danger"
                  >
                    <UserX className="h-3 w-3" />
                    Block…
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

/**
 * What the person who added a bot says about it, marked as theirs: RIM cannot check it. Plain
 * text only.
 */
function BotDisclosure({ bot }: { bot: BotInfo }) {
  return (
    <div data-testid="bot-disclosure" className="mt-3 space-y-2 text-xs">
      <div>
        <p className="font-medium text-rim-text-muted">Who runs it</p>
        <p className="whitespace-pre-wrap break-words text-rim-text">{bot.runBy}</p>
      </div>
      <div>
        <p className="font-medium text-rim-text-muted">Where what it reads goes</p>
        <p className="whitespace-pre-wrap break-words text-rim-text">{bot.readsGoTo}</p>
      </div>
      <div>
        <p className="font-medium text-rim-text-muted">Added by</p>
        <p className="break-words text-rim-text">{bot.addedByName ?? "someone no longer here"}</p>
      </div>
      <p className="text-rim-text-faint">
        This is what the person who added it says. RIM can&apos;t check it.
      </p>
    </div>
  );
}
