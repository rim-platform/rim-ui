import { useRef, type ReactNode } from "react";

import { closeOnEscape } from "../hooks/overlayEscape";
import { useOverlayFocus } from "../hooks/useOverlayFocus";
import { useShellWidth } from "../hooks/useShellWidth";

interface OverlayPanelProps {
  /** The accessible name of the panel. */
  label: string;
  /** Closes the panel; Escape runs it. */
  onClose: () => void;
  children: ReactNode;
}

/**
 * A panel that opens over the right side of the main area instead of taking width from it:
 * up to 420 px wide, or the whole main area in a narrow window. Focus moves in when it opens and
 * back when it closes, and Escape closes it. The parent must be positioned.
 */
export function OverlayPanel({ label, onClose, children }: OverlayPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useShellWidth();
  useOverlayFocus(ref);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => closeOnEscape(event, onClose)}
      className={
        width === "narrow"
          ? "absolute inset-0 z-30 grid grid-cols-1 overflow-hidden bg-rim-panel outline-none *:min-h-0 *:min-w-0"
          : "absolute inset-y-0 right-0 z-30 grid w-[min(420px,100%)] grid-cols-1 overflow-hidden border-l border-rim-line bg-rim-panel shadow-xl outline-none *:min-h-0 *:min-w-0"
      }
    >
      {children}
    </div>
  );
}
