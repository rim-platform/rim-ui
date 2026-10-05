import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";

interface ConfirmActionDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  isPending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** A small yes/no confirmation for conversation actions (archive, leave). */
export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  isPending = false,
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
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
