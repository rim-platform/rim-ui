import { useEffect } from "react";
import { X } from "lucide-react";
import { Z } from "../../../shared/ui/zIndex";
import { useCommandResultStore } from "../state/useCommandResultStore";

/** The answer of a read command run on its own: its rows, closed with Esc or the button. */
export function CommandResultView() {
  const view = useCommandResultStore((s) => s.view);
  const dismiss = useCommandResultStore((s) => s.dismiss);

  useEffect(() => {
    if (!view) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, dismiss]);

  if (!view) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[12vh]"
      style={{ zIndex: Z.OVERLAY_CONTENT }}
      onClick={dismiss}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={view.title}
        className="relative w-full max-w-lg rounded-xl border border-rim-line bg-rim-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rim-line px-4 py-3">
          <h2 className="text-sm font-medium text-rim-text">{view.title}</h2>
          <button
            type="button"
            aria-label="Close"
            className="text-rim-text-muted hover:text-rim-text transition-colors"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {view.note && <div className="px-4 py-3 text-xs text-rim-text-muted">{view.note}</div>}
        {view.rows.length > 0 && (
          <ul className="max-h-[50vh] overflow-y-auto py-1" aria-label="Results">
            {view.rows.map((row) => (
              <li key={row.key} className="px-4 py-1.5">
                <div className="text-sm text-rim-text break-words">{row.primary}</div>
                {row.secondary && (
                  <div className="text-[11px] text-rim-text-muted">{row.secondary}</div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-rim-line px-4 py-2 text-[11px] text-rim-text-muted">
          <kbd className="font-mono">Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
