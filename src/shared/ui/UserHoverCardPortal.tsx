import { useRef } from "react";
import { createPortal } from "react-dom";

import type { PresenceStatus } from "./Avatar";
import { UserCardContent } from "./UserCardContent";
import { Z } from "./zIndex";

interface UserHoverCardPortalProps {
  userId: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  statusText?: string | null;
  role?: string;
  joinedAt?: string;
  bio?: string | null;
  presenceStatus?: PresenceStatus | null;
  isCurrentUser?: boolean;
  anchorRect: DOMRect;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function UserHoverCardPortal({
  userId,
  username,
  displayName,
  avatarUrl,
  statusText,
  role,
  joinedAt,
  bio,
  presenceStatus,
  isCurrentUser,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: UserHoverCardPortalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const cardWidth = 288; // w-72
  const cardHeight = 320; // estimated max height
  const gap = 8;

  // Horizontal: prefer right of anchor, flip left if not enough space
  const spaceRight = window.innerWidth - anchorRect.right;
  const flipHorizontal = spaceRight < cardWidth + gap;

  // Vertical: prefer aligning top with anchor, flip up if card overflows bottom
  const spaceBelow = window.innerHeight - anchorRect.top;
  const flipVertical = spaceBelow < cardHeight + gap;

  let top: number;
  if (flipVertical) {
    // Position above: card bottom aligns with anchor bottom
    top = Math.max(gap, anchorRect.bottom - cardHeight);
  } else {
    // Position below-ish: card top aligns near anchor top
    top = Math.max(gap, anchorRect.top);
  }

  // Clamp to viewport
  top = Math.min(top, window.innerHeight - cardHeight - gap);
  top = Math.max(gap, top);

  const cardStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: Z.POPOVER,
    top,
    ...(flipHorizontal
      ? { right: Math.max(gap, window.innerWidth - anchorRect.left + gap) }
      : { left: Math.min(anchorRect.right + gap, window.innerWidth - cardWidth - gap) }),
  };

  return createPortal(
    <div
      ref={cardRef}
      style={cardStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="w-72 rounded-xl border border-rim-line bg-rim-panel shadow-xl p-4"
    >
      <UserCardContent
        userId={userId}
        username={username}
        displayName={displayName}
        avatarUrl={avatarUrl}
        statusText={statusText}
        role={role}
        joinedAt={joinedAt}
        bio={bio}
        presenceStatus={presenceStatus}
        isCurrentUser={isCurrentUser}
      />
    </div>,
    document.body,
  );
}
