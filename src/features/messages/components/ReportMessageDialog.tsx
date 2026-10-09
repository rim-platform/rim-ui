import { useState } from "react";

import type { MessageItem } from "../../../core/types/messages";
import { toast } from "../../../shared/toast";
import { encryptedReport } from "../../e2ee/utils/report";
import {
  useReportEncryptedMessageMutation,
  useReportMessageMutation,
} from "../../workspaces/api/useModeration";
import { ModerationDialog, ReasonField } from "../../workspaces/components/ModerationDialog";

interface ReportMessageDialogProps {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  /** The message as this device holds it; an encrypted one is reported with its content. */
  message?: MessageItem | null;
  onClose: () => void;
}

const PLAIN_DESCRIPTION =
  "Moderators of this workspace will see your report, the reason and the message. The author is not told who reported it.";

const ENCRYPTED_DESCRIPTION =
  "This message is end-to-end encrypted. Reporting it sends its exact content and attachments to the server, where moderators of this workspace can read and verify it. Nothing else from the conversation is sent. The author is not told who reported it.";

/**
 * Reports a message to the workspace moderators with a required reason. An encrypted message
 * is reported by revealing its content with the proof that its sender's device sent it; a
 * message this device could not read or verify cannot be reported.
 */
export function ReportMessageDialog({
  workspaceId,
  conversationId,
  messageId,
  message,
  onClose,
}: ReportMessageDialogProps) {
  const [reason, setReason] = useState("");
  const reportMessage = useReportMessageMutation();
  const reportEncrypted = useReportEncryptedMessageMutation();
  const trimmed = reason.trim();
  const encrypted = message && (message.e2ee || message.encryption) ? message : null;
  const report = encrypted ? encryptedReport(encrypted, workspaceId, trimmed) : null;
  const refusal = report && "refusal" in report ? report.refusal : null;

  function send() {
    if (report) {
      if ("refusal" in report) return Promise.reject(new Error(report.refusal));
      return reportEncrypted.mutateAsync({ input: report.input });
    }
    return reportMessage.mutateAsync({
      serverId: workspaceId,
      conversationId,
      messageId,
      reason: trimmed,
    });
  }

  return (
    <ModerationDialog
      title="Report message"
      description={encrypted ? ENCRYPTED_DESCRIPTION : PLAIN_DESCRIPTION}
      tone="warm"
      confirmLabel="Report"
      confirmDisabled={!trimmed || refusal !== null}
      errorFallback="Could not report the message"
      onConfirm={send}
      onDone={() => {
        toast.success("Message reported to the moderators");
        onClose();
      }}
      onClose={onClose}
    >
      {refusal ? (
        <p role="alert" className="text-sm text-rim-warm">
          {refusal}
        </p>
      ) : (
        <ReasonField
          id="report-reason"
          label="Reason"
          value={reason}
          onChange={setReason}
          placeholder="What is wrong with this message?"
        />
      )}
    </ModerationDialog>
  );
}
