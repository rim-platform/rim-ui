import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import type { MessageAttachment } from "../../../core/types/messages";
import { useDeleteAttachmentMutation } from "../api/useAttachments";

interface AttachmentDeleteDialogProps {
  serverId: string;
  /** The attachments a person may remove: the ones whose upload failed. */
  attachments: MessageAttachment[];
  onClose: () => void;
}

/**
 * Lists a message's attachments that failed to upload, each with a Remove button, so the
 * command that deletes an attachment names the one to remove. Closes once none is left.
 */
export function AttachmentDeleteDialog({
  serverId,
  attachments,
  onClose,
}: AttachmentDeleteDialogProps) {
  const deleteAttachment = useDeleteAttachmentMutation();

  function remove(attachmentId: string) {
    deleteAttachment.mutate(
      { attachmentId, serverId },
      {
        onSuccess: () => {
          if (attachments.length <= 1) onClose();
        },
        onError: () => toast.error("Failed to remove attachment"),
      },
    );
  }

  return (
    <Dialog open title="Delete attachment" onClose={onClose}>
      <ul className="mb-4 space-y-2">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-rim-text">{attachment.filename}</span>
            <Button
              type="button"
              variant="danger"
              size="sm"
              isLoading={
                deleteAttachment.isPending &&
                deleteAttachment.variables?.attachmentId === attachment.id
              }
              onClick={() => remove(attachment.id)}
            >
              Remove
            </Button>
          </li>
        ))}
        {attachments.length === 0 && (
          <li className="text-sm text-rim-text-muted">No failed attachments are left.</li>
        )}
      </ul>
      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
