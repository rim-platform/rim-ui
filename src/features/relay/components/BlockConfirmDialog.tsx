import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";

/** Asks before blocking `name`: what a block does, that they are not told, and where to undo it. */
export function BlockConfirmDialog({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmActionDialog
      title={`Block ${name}?`}
      description="They won't be able to send you direct messages or requests. They won't be told. You can unblock them in Settings → Direct messages."
      confirmLabel="Block"
      danger
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
