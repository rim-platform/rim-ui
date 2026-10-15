import { useEffect, useRef, useCallback, useId } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { trackOpenDialog } from "./hostDialogs";
import { Z } from "./zIndex";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  maxWidth?: string;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, title, maxWidth = "max-w-sm", children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const titleId = useId();

  // Save previous focus, move focus into the panel when opening, prevent body scroll
  useEffect(() => {
    let frame: number | undefined;
    if (open) {
      previousFocusRef.current = document.activeElement;
      document.body.style.overflow = "hidden";
      // Next frame, focus the first focusable unless focus is already inside (e.g. `autoFocus`)
      frame = requestAnimationFrame(() => {
        const panel = panelRef.current;
        if (!panel || panel.contains(document.activeElement)) return;
        panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      });
    } else {
      document.body.style.overflow = "";
      if (previousFocusRef.current) {
        const el = previousFocusRef.current as HTMLElement;
        if (typeof el.focus === "function") {
          el.focus();
        }
        previousFocusRef.current = null;
      }
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.body.style.overflow = "";
    };
  }, [open]);

  // Plugin frames go inert while a host dialog is open.
  useEffect(() => {
    if (!open) return;
    return trackOpenDialog();
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Focus trap
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;

    const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        style={{ zIndex: Z.OVERLAY_BACKDROP }}
        onClick={onClose}
      />

      {/* Container */}
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex: Z.OVERLAY_CONTENT }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={handleKeyDown}
          className={cn("w-full rounded-xl border border-rim-line bg-rim-panel p-5", maxWidth)}
        >
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h3 id={titleId} className="text-sm font-medium text-rim-text">
              {title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-rim-text-muted transition hover:text-rim-text"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {children}
        </div>
      </div>
    </>
  );
}
