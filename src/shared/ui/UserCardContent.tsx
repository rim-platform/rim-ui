import { useCallback } from "react";
import { Copy, MessageCircle, Pencil } from "lucide-react";

import { Avatar, type PresenceStatus } from "./Avatar";
import { toast } from "../toast";
import { formatRelativeDate } from "../utils/formatDate";
import { viewHandle, type HandleView } from "../utils/handles";

export interface UserCardContentProps {
  userId: string;
  isFormerMember?: boolean;
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
  joinedAt?: string;
  bio?: string | null;
  presenceStatus?: PresenceStatus | null;
  isCurrentUser?: boolean;
  /** Opens the direct message with this person; without it the card offers no Send DM. */
  onSendDm?: () => void;
}

export function UserCardContent({
  userId,
  isFormerMember,
  username,
  handle,
  displayName,
  avatarUrl,
  statusText,
  role,
  joinedAt,
  bio,
  presenceStatus,
  isCurrentUser,
  onSendDm,
}: UserCardContentProps) {
  const resolvedDisplayName = displayName ?? username;
  const shownHandle = handle === undefined ? viewHandle(username, null, null) : handle;
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
          presenceStatus={presenceStatus}
        />
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-base font-semibold text-rim-text truncate">{resolvedDisplayName}</p>
          {shownHandle && (
            <p className="text-sm text-rim-text-muted truncate" title={shownHandle.copied}>
              {shownHandle.shown}
            </p>
          )}
        </div>
      </div>

      {isFormerMember && (
        <p className="mt-2 text-sm text-rim-text-muted">Not a member of this workspace</p>
      )}

      {/* Status */}
      {statusText && <p className="mt-2 text-sm text-rim-text-muted">{statusText}</p>}

      {/* Details */}
      {(role || joinedAt || bio) && (
        <>
          <hr className="border-rim-line my-3" />
          <div className="space-y-1 text-xs">
            {role && (
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
      <>
        <hr className="border-rim-line my-3" />
        <div className="flex items-center gap-2">
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
              {onSendDm && !isFormerMember && (
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
            </>
          )}
        </div>
      </>
    </>
  );
}
