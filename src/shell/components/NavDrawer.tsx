import { useRef, type ReactNode } from "react";

import { closeOnEscape } from "../hooks/overlayEscape";
import { useOverlayFocus } from "../hooks/useOverlayFocus";

interface NavDrawerProps {
  onClose: () => void;
  children: ReactNode;
}

/**
 * The navigation of a narrow window: the workspace rail, side rail and tool panel as a drawer
 * over the left of the main area. A press on the dimmed area outside it closes it, and so does
 * Escape. The parent must be positioned.
 */
export function NavDrawer({ onClose, children }: NavDrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlayFocus(ref);
  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 z-40 bg-rim-void/70" />
      <div
        ref={ref}
        role="dialog"
        aria-label="Navigation"
        tabIndex={-1}
        onKeyDown={(event) => closeOnEscape(event, onClose)}
        className="absolute inset-y-0 left-0 z-50 flex max-w-full overflow-x-auto bg-rim-void shadow-xl outline-none"
      >
        {children}
      </div>
    </>
  );
}
