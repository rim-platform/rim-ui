import { useState } from "react";

import { toast } from "../../../shared/toast";
import { useReportMessageMutation } from "../../workspaces/api/useModeration";
import { ModerationDialog, ReasonField } from "../../workspaces/components/ModerationDialog";

interface ReportMessageDialogProps {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  onClose: () => void;
}

/** Reports a message to the workspace moderators with a required reason. */
export function ReportMessageDialog({
  workspaceId,
  conversationId,
  messageId,
  onClose,
}: ReportMessageDialogProps) {
  const [reason, setReason] = useState("");
  const reportMessage = useReportMessageMutation();
  const trimmed = reason.trim();

  return (
    <ModerationDialog
      title="Report message"
      description="Moderators of this workspace will see your report, the reason and the message. The author is not told who reported it."
      tone="warm"
      confirmLabel="Report"
      confirmDisabled={!trimmed}
      errorFallback="Could not report the message"
      onConfirm={() =>
        reportMessage.mutateAsync({
          serverId: workspaceId,
          conversationId,
          messageId,
          reason: trimmed,
        })
      }
      onDone={() => {
        toast.success("Message reported to the moderators");
        onClose();
      }}
      onClose={onClose}
    >
      <ReasonField
        id="report-reason"
        label="Reason"
        value={reason}
        onChange={setReason}
        placeholder="What is wrong with this message?"
      />
    </ModerationDialog>
  );
}
