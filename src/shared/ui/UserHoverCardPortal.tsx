import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import type { AuthorBan } from "../utils/banStatus";
import type { PresenceStatus } from "./Avatar";
import type { HandleView } from "../utils/handles";
import { UserCardContent } from "./UserCardContent";
import { Z } from "./zIndex";

interface UserHoverCardPortalProps {
  userId: string;
  isFormerMember?: boolean;
  ban?: AuthorBan;
  username: string;
  /** How the person's handle reads; see `UserCardContent`. */
  handle?: HandleView | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  statusText?: string | null;
  role?: string;
  joinedAt?: string;
  bio?: string | null;
  presenceStatus?: PresenceStatus | null;
  isCurrentUser?: boolean;
  /** Opens the direct message with this person. */
  onSendDm?: () => void;
  anchorRect: DOMRect;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Closes a card opened on purpose rather than by hovering: on Escape or a press outside it. */
  onDismiss?: () => void;
}

export function UserHoverCardPortal({
  userId,
  isFormerMember,
  ban,
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
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  onDismiss,
}: UserHoverCardPortalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onDismiss) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onDismiss]);

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
        isFormerMember={isFormerMember}
        ban={ban}
        userId={userId}
        username={username}
        handle={handle}
        displayName={displayName}
        avatarUrl={avatarUrl}
        statusText={statusText}
        role={role}
        joinedAt={joinedAt}
        bio={bio}
        presenceStatus={presenceStatus}
        isCurrentUser={isCurrentUser}
        onSendDm={onSendDm}
      />
    </div>,
    document.body,
  );
}
