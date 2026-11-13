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
      description="You won't get their messages or requests, and your DMs with them and the groups they started stay hidden until you unblock them. They are removed from your contacts and won't be told. You can unblock them in Settings > Direct messages, under Blocked people."
      confirmLabel="Block"
      danger
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
