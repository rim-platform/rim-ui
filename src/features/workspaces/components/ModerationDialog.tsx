import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { confirmShortcutLabel } from "../../../core/runtime/runtime";

export type ModerationTone = "danger" | "warm" | "accent";

interface ModerationDialogProps {
  title: string;
  description: ReactNode;
  /** `danger` gives the confirm button the danger style; `warm` and `accent` the primary one. */
  tone: ModerationTone;
  confirmLabel: string;
  confirmDisabled?: boolean;
  /** Runs the action; a rejection keeps the dialog open with the server's message. */
  onConfirm: () => Promise<unknown>;
  /** Called after `onConfirm` resolves. */
  onDone: () => void;
  onClose: () => void;
  /** Fallback when a failure carries no server message. */
  errorFallback?: string;
  children?: ReactNode;
}

/**
 * Confirmation for moderation actions in the dangerous-action style of the command
 * confirmation modal: Cancel focused first, Escape always cancels, Ctrl/Cmd+Enter confirms, and
 * a failure shows the server's message inline with Close / Retry instead of closing.
 */
export function ModerationDialog({
  title,
  description,
  tone,
  confirmLabel,
  confirmDisabled = false,
  onConfirm,
  onDone,
  onClose,
  errorFallback = "The action failed",
  children,
}: ModerationDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // `Dialog` focuses its first focusable element on the next frame; Cancel is the safe
  // default, so take focus one frame later.
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => cancelRef.current?.focus());
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  async function handleConfirm() {
    if (pending || confirmDisabled) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setPending(false);
      onDone();
    } catch (err) {
      setPending(false);
      setError(graphqlErrorMessage(err, errorFallback));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleConfirm();
    }
  }

  return (
    <Dialog open title={title} onClose={onClose} maxWidth="max-w-md">
      <div onKeyDown={handleKeyDown} className="space-y-4" data-testid="moderation-dialog">
        <div className="text-sm text-rim-text-muted">{description}</div>
        {children}
        {error && (
          <p
            role="alert"
            className="rounded border border-rim-danger/40 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="secondary" size="sm" onClick={onClose}>
            {error ? "Close" : "Cancel"}
          </Button>
          <Button
            type="button"
            variant={tone === "danger" ? "danger" : "primary"}
            size="sm"
            isLoading={pending}
            disabled={confirmDisabled}
            title={confirmShortcutLabel()}
            onClick={() => void handleConfirm()}
          >
            {error ? "Retry" : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Optional free-text reason, shared by the timeout, kick, ban and report dialogs. */
export function ReasonField({
  id,
  label = "Reason (optional)",
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-rim-text">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
      />
    </div>
  );
}
