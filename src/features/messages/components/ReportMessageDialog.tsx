import { useRef, useState } from "react";

import { CONFLICT, graphqlErrorCode } from "../../../core/graphql/errors";
import type { MessageItem } from "../../../core/types/messages";
import { toast } from "../../../shared/toast";
import { encryptedReport } from "../../e2ee/utils/report";
import { useDirectSpaceIds } from "../../relay/api/useDirectInbox";
import {
  useReportEncryptedMessageMutation,
  useReportMessageMutation,
} from "../../workspaces/api/useModeration";
import { useMyServers } from "../../workspaces/api/useMyServers";
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

const DIRECT_PLAIN_DESCRIPTION =
  "The people who run the server this conversation is on will see your report, the reason and the message. The author is not told who reported it.";

const DIRECT_ENCRYPTED_DESCRIPTION =
  "This message is end-to-end encrypted. Reporting it sends its exact content and attachments to the server this conversation is on, where the people who run it can read and verify it. Nothing else from the conversation is sent. The author is not told who reported it.";

/** What the dialog says happens to a report, by where the message is and how it is sent. */
function description(direct: boolean, encrypted: boolean): string {
  if (direct) return encrypted ? DIRECT_ENCRYPTED_DESCRIPTION : DIRECT_PLAIN_DESCRIPTION;
  return encrypted ? ENCRYPTED_DESCRIPTION : PLAIN_DESCRIPTION;
}

/**
 * Reports a message with a required reason: to the workspace moderators, or for a DM or group
 * (a direct space, which has no moderators) to the people who run its server. An encrypted
 * message is reported by revealing its content with the proof that its sender's device sent
 * it; a message this device could not read or verify cannot be reported. A message the viewer
 * already reported says so and closes.
 */
export function ReportMessageDialog({
  workspaceId,
  conversationId,
  messageId,
  message,
  onClose,
}: ReportMessageDialogProps) {
  const { data: workspaces } = useMyServers(false);
  const workspaceName = workspaces?.find((workspace) => workspace.id === workspaceId)?.name;
  const [reason, setReason] = useState("");
  const reportMessage = useReportMessageMutation();
  const reportEncrypted = useReportEncryptedMessageMutation();
  const direct = useDirectSpaceIds().includes(workspaceId);
  const trimmed = reason.trim();
  const encrypted = message && (message.e2ee || message.encryption) ? message : null;
  const report = encrypted ? encryptedReport(encrypted, workspaceId, trimmed) : null;
  const refusal = report && "refusal" in report ? report.refusal : null;
  // Set when the server answered that the viewer already reported this message.
  const alreadyReported = useRef(false);

  /** Takes the server's "already reported" answer as done; any other failure goes on. */
  function noteAlreadyReported(err: unknown) {
    if (graphqlErrorCode(err) === CONFLICT) {
      alreadyReported.current = true;
      return;
    }
    throw err;
  }

  function send() {
    if (report) {
      if ("refusal" in report) return Promise.reject(new Error(report.refusal));
      return reportEncrypted.mutateAsync({ input: report.input }).catch(noteAlreadyReported);
    }
    return reportMessage
      .mutateAsync({
        serverId: workspaceId,
        conversationId,
        messageId,
        reason: trimmed,
      })
      .catch(noteAlreadyReported);
  }

  return (
    <ModerationDialog
      title="Report message"
      description={
        workspaceName && !direct
          ? description(false, Boolean(encrypted)).split("this workspace").join(workspaceName)
          : description(direct, Boolean(encrypted))
      }
      tone="warm"
      confirmLabel="Report"
      confirmDisabled={!trimmed || refusal !== null}
      errorFallback="Could not report the message"
      onConfirm={send}
      onDone={() => {
        if (alreadyReported.current) toast.info("You already reported this message.");
        else
          toast.success(
            direct
              ? "Message reported to the people who run the server"
              : workspaceName
                ? `Reported to the moderators of ${workspaceName}`
                : "Message reported to the moderators",
          );
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
