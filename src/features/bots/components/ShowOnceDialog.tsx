import type { ReactNode } from "react";

import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";

interface ShowOnceDialogProps {
  title: string;
  /** Names the value for a screen reader and the field's label. */
  label: string;
  /** The secret. Held only by whoever renders this, never in a store or the query cache. */
  value: string;
  /** Extra guidance below the warning. */
  children?: ReactNode;
  onClose: () => void;
}

/**
 * Shows a secret the server will not show again (a bot token or a webhook URL) in a read-only
 * field with a Copy button. It closes only through its Done button, never by a press on the
 * backdrop or Escape, so it cannot vanish before the value was copied.
 */
export function ShowOnceDialog({ title, label, value, children, onClose }: ShowOnceDialogProps) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  }

  return (
    <Dialog open persistent title={title} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
            {label}
          </span>
          <input
            type="text"
            readOnly
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 font-mono text-xs text-rim-text outline-none focus:border-rim-accent/40"
          />
        </label>
        <p className="text-sm text-rim-warm">
          RIM won&apos;t show this again. Anyone holding it can act as this bot, so keep it like a
          password.
        </p>
        {children}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => void copy()}>
            Copy
          </Button>
          <Button type="button" variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
