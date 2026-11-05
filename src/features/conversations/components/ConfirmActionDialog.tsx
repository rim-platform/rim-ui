import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";

interface ConfirmActionDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  isPending?: boolean;
  /** Puts the keyboard on the confirm button, so Enter confirms. */
  focusConfirm?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** A small yes/no confirmation (archive or leave a conversation, quit the app). */
export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  isPending = false,
  focusConfirm = false,
  onConfirm,
  onClose,
}: ConfirmActionDialogProps) {
  return (
    <Dialog open title={title} onClose={onClose}>
      <p className="mb-4 text-sm text-rim-text-muted">{description}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={danger ? "danger" : "primary"}
          isLoading={isPending}
          autoFocus={focusConfirm}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
