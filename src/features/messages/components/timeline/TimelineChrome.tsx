import { Loader2 } from "lucide-react";

import { cn } from "../../../../shared/ui/cn";

export function NewMessagesDivider({ fading }: { fading: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2 transition-opacity duration-1000",
        fading ? "opacity-0" : "opacity-100",
      )}
      role="separator"
      aria-label="New messages"
      data-new-messages-divider
    >
      <div className="flex-1 border-t border-rim-warm/40" />
      <span className="select-none text-xs font-medium text-rim-warm">New messages</span>
      <div className="flex-1 border-t border-rim-warm/40" />
    </div>
  );
}

/**
 * Floats over the top of the list instead of sitting in it, so showing and
 * hiding it never shifts the rows while an older page is being prepended.
 */
export function OlderMessagesLoader() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
      <div className="flex items-center gap-2 rounded border border-rim-line bg-rim-panel px-3 py-1 text-xs text-rim-text-muted shadow-lg">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading older messages...
      </div>
    </div>
  );
}

interface NavigationHintsProps {
  hasSelection: boolean;
  isSelectedOwnMessage: boolean;
  isDeleteConfirming: boolean;
  hasNewMessages: boolean;
  /** Whether `r` starts a reply here. */
  canReply: boolean;
  /** Whether `t` opens the selected message's thread. */
  canThread: boolean;
  /** Whether `p` pins here. */
  canPin: boolean;
}

/** Action hints bar shown in NAVIGATE mode. */
export function NavigationHints({
  hasSelection,
  isSelectedOwnMessage,
  isDeleteConfirming,
  hasNewMessages,
  canReply,
  canThread,
  canPin,
}: NavigationHintsProps) {
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 flex justify-center pb-1">
      <div
        className={cn(
          "inline-flex items-center gap-3 rounded border border-rim-line bg-rim-panel px-3 py-1.5",
          "text-[10px] text-rim-text-faint shadow-lg transition-opacity duration-150",
        )}
      >
        <span className="font-medium text-rim-accent">NAVIGATE</span>
        <span className="text-rim-line">|</span>
        <Hint keys="j/k" label="Navigate" />
        {hasSelection && (
          <>
            {canReply && <Hint keys="r" label="Reply" />}
            {isSelectedOwnMessage && <Hint keys="e" label="Edit" />}
            {canThread && <Hint keys="t" label="Thread" />}
            {canPin && <Hint keys="p" label="Pin" />}
            <Hint keys="c" label="Copy" />
            <Hint keys="f" label="Forward" />
            {isSelectedOwnMessage && (
              <span>
                <kbd className="font-mono">d</kbd>{" "}
                {isDeleteConfirming ? (
                  <span className="font-medium text-rim-danger">Press d again to delete</span>
                ) : (
                  "Delete"
                )}
              </span>
            )}
          </>
        )}
        <span className="text-rim-line">|</span>
        {hasNewMessages && <Hint keys={"⇧N"} label="Jump to new" />}
        <Hint keys="/" label="Search" />
        <Hint keys="i" label="Compose" />
        <Hint keys="Esc" label="Exit" />
      </div>
    </div>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span>
      <kbd className="font-mono">{keys}</kbd> {label}
    </span>
  );
}
