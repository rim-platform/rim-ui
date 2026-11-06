import { useEffect, useRef, type ReactNode } from "react";

import { FOCUSABLE_SELECTOR } from "../../shared/ui/Dialog";
import { hostDialogOpen } from "../../shared/ui/hostDialogs";
import { useOverlayFocus } from "../hooks/useOverlayFocus";

interface NavDrawerProps {
  onClose: () => void;
  children: ReactNode;
}

/**
 * The navigation of a narrow window: the workspace rail, side rail and tool panel as a modal
 * drawer over the left of the main area. A press on the dimmed area outside it closes it, and so
 * does Escape. Tab stays inside it. While a dialog or menu is open on top of it, the keys belong
 * to that one. The parent must be positioned.
 */
export function NavDrawer({ onClose, children }: NavDrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useOverlayFocus(ref);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const drawer = ref.current;
      if (!drawer || event.defaultPrevented || hostDialogOpen()) return;
      if (event.key === "Escape") {
        if (document.querySelector('[role="menu"]')) return;
        const target = event.target;
        if (target === document.body || (target instanceof Node && drawer.contains(target))) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const active = document.activeElement;
      if (!drawer.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === drawer)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 z-40 bg-rim-void/70" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="absolute inset-y-0 left-0 z-50 flex max-w-full overflow-x-auto bg-rim-void shadow-xl outline-none"
      >
        {children}
      </div>
    </>
  );
}
