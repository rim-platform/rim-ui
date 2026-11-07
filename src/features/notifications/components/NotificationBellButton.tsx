import { useEffect, useId, useRef, type RefObject } from "react";
import { Bell } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { HoverTooltip } from "../../../shared/ui/HoverTooltip";
import { closeOnEscape } from "../../../shell/hooks/overlayEscape";
import { useOverlayFocus } from "../../../shell/hooks/useOverlayFocus";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { usePendingDmRequestCount } from "../../relay/api/useDmRequests";
import { useUnreadNotificationCount } from "../api/useNotifications";
import { useNotificationsPanelStore } from "../state/useNotificationsPanelStore";
import { NotificationsPanel } from "./NotificationsPanel";

/**
 * The top bar's bell: the unread notification count, and the notification inbox, which opens
 * under the bar while the bell is on. The bar must be positioned.
 */
export function NotificationBellButton() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const open = useNotificationsPanelStore((s) => s.open);
  const toggle = useNotificationsPanelStore((s) => s.toggle);
  const setOpen = useNotificationsPanelStore((s) => s.setOpen);
  const { data: notifications = 0 } = useUnreadNotificationCount(workspaceId);
  const requests = usePendingDmRequestCount();
  const count = notifications + requests;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const shown = open && Boolean(workspaceId);
  const label = count > 0 ? `Notifications (${count} unread)` : "Notifications";

  return (
    <>
      <HoverTooltip
        content={<span className="text-xs text-rim-text whitespace-nowrap">Notifications</span>}
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={toggle}
          aria-label={label}
          aria-expanded={shown}
          aria-controls={shown ? panelId : undefined}
          disabled={!workspaceId}
          className={cn(
            "relative flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-50",
            shown
              ? "bg-rim-accent/15 text-rim-accent"
              : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
          )}
        >
          <Bell aria-hidden className="h-4 w-4" />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rim-danger-solid px-1 text-[10px] font-bold leading-none text-white"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </HoverTooltip>
      {shown && workspaceId && (
        <NotificationsPopover
          id={panelId}
          workspaceId={workspaceId}
          buttonRef={buttonRef}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The notification inbox under the top bar's right edge. Focus moves in when it opens and back
 * when it closes; Escape and a press outside it close it, except a press on the bell, which
 * toggles it, or in a menu or dialog it opened.
 */
function NotificationsPopover({
  id,
  workspaceId,
  buttonRef,
  onClose,
}: {
  id: string;
  workspaceId: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlayFocus(ref);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (ref.current?.contains(target) || buttonRef.current?.contains(target)) return;
      if (target.closest('[role="menu"], [role="dialog"]')) return;
      onCloseRef.current();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [buttonRef]);

  return (
    <div
      ref={ref}
      id={id}
      role="region"
      aria-label="Notifications"
      tabIndex={-1}
      onKeyDown={(event) => closeOnEscape(event, onClose)}
      className="absolute right-2 top-full z-40 mt-1 flex h-[min(70vh,560px)] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-xl border border-rim-line bg-rim-panel shadow-xl outline-none"
    >
      <NotificationsPanel workspaceId={workspaceId} onClose={onClose} />
    </div>
  );
}
