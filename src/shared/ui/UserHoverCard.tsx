import { useState, useRef, useCallback, useEffect, cloneElement, type ReactElement } from "react";
import { createPortal } from "react-dom";

import type { PresenceStatus } from "./Avatar";
import type { HandleView } from "../utils/handles";
import { UserCardContent } from "./UserCardContent";
import { Z } from "./zIndex";

interface UserHoverCardProps {
  userId: string;
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
  children: ReactElement;
}

export function UserHoverCard({
  userId,
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
  children,
}: UserHoverCardProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number; flipRight: boolean }>({
    x: 0,
    y: 0,
    flipRight: false,
  });

  const triggerRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const computePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cardWidth = 288; // w-72
    const spaceRight = window.innerWidth - rect.right;
    const flipRight = spaceRight < cardWidth + 16;

    setPosition({
      x: flipRight ? rect.left : rect.right + 8,
      y: Math.max(8, rect.top - 20),
      flipRight,
    });
  }, []);

  const show = useCallback(() => {
    clearTimers();
    showTimerRef.current = setTimeout(() => {
      computePosition();
      setVisible(true);
    }, 400);
  }, [clearTimers, computePosition]);

  const startGrace = useCallback(() => {
    clearTimers();
    graceTimerRef.current = setTimeout(() => {
      setVisible(false);
    }, 150);
  }, [clearTimers]);

  const cancelGrace = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  const handleTriggerEnter = useCallback(() => {
    cancelGrace();
    show();
  }, [cancelGrace, show]);

  const handleTriggerLeave = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    startGrace();
  }, [startGrace]);

  const handleCardEnter = useCallback(() => {
    cancelGrace();
  }, [cancelGrace]);

  const handleCardLeave = useCallback(() => {
    startGrace();
  }, [startGrace]);

  // Extract existing event handlers from the child element
  const childProps = children.props as Record<string, unknown>;
  const existingMouseEnter = childProps.onMouseEnter as ((e: React.MouseEvent) => void) | undefined;
  const existingMouseLeave = childProps.onMouseLeave as ((e: React.MouseEvent) => void) | undefined;

  const cardStyle: React.CSSProperties = {
    position: "fixed",
    zIndex: Z.POPOVER,
    top: position.y,
    ...(position.flipRight ? { right: window.innerWidth - position.x + 8 } : { left: position.x }),
  };

  return (
    <>
      {cloneElement(children, {
        ref: (el: HTMLElement | null) => {
          triggerRef.current = el;
          // Forward ref if the child has one (React 19: ref is a regular prop)
          const childRef = childProps.ref as React.Ref<HTMLElement> | undefined;
          if (typeof childRef === "function") {
            childRef(el);
          } else if (childRef && typeof childRef === "object") {
            (childRef as React.RefObject<HTMLElement | null>).current = el;
          }
        },
        onMouseEnter: (e: React.MouseEvent) => {
          handleTriggerEnter();
          existingMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          handleTriggerLeave();
          existingMouseLeave?.(e);
        },
      } as Record<string, unknown>)}
      {visible &&
        createPortal(
          <div
            ref={cardRef}
            style={cardStyle}
            onMouseEnter={handleCardEnter}
            onMouseLeave={handleCardLeave}
            className="w-72 rounded-xl border border-rim-line bg-rim-panel shadow-xl p-4"
          >
            <UserCardContent
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
        )}
    </>
  );
}
