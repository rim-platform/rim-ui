import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileIcon, Loader2, ShieldCheck } from "lucide-react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/toast";
import { formatTime } from "../../../shared/utils/formatTime";
import { findCachedConversation } from "../../conversations/api/useConversation";
import { fetchPrincipalDevices } from "../../e2ee/api/e2eeApi";
import { decryptReportedAttachment } from "../../e2ee/api/e2eeCommands";
import { downloadReportedBlob } from "../../e2ee/runtime/send";
import { withMentionNames } from "../../e2ee/utils/content";
import { parseReportedContent, type ReportedAttachment } from "../../e2ee/utils/report";
import { useCurrentUser } from "../../workspaces/api/useCurrentUser";
import {
  useDeleteReportedMessageMutation,
  useMessageReport,
  type MessageReportRow,
} from "../../workspaces/api/useModeration";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";

interface EncryptedReportViewProps {
  serverId: string;
  report: MessageReportRow;
}

/** Display names by principal id, and principal ids by user id, of the workspace's members. */
function usePrincipals(serverId: string) {
  const { data: me } = useCurrentUser();
  const { data: members } = useServerMembers(serverId);
  return useMemo(() => {
    const names = new Map<string, string>();
    const ofUser = new Map<string, string>();
    for (const member of members ?? []) {
      if (!member.principalId) continue;
      names.set(member.principalId, member.displayName || member.username || member.userId);
      ofUser.set(member.userId, member.principalId);
    }
    if (me?.principalId) {
      names.set(me.principalId, me.displayName || me.username);
      ofUser.set(me.id, me.principalId);
    }
    return { names, ofUser };
  }, [me, members]);
}

/** The name the sender's device was certified with, or its id. */
function useDeviceName(principalId: string | null, deviceId: string | null): string | null {
  const { data } = useQuery({
    queryKey: ["principalDevices", principalId],
    enabled: Boolean(principalId),
    staleTime: 60_000,
    queryFn: () => fetchPrincipalDevices([principalId!]),
  });
  if (!deviceId) return null;
  const device = data?.[0]?.devices.find((d) => d.deviceId === deviceId);
  return device ? `${device.name} (${deviceId.slice(0, 8)})` : deviceId;
}

/**
 * A verified report of an encrypted message as its moderator reads it: the exact content the
 * sender's device sent (body with mentions as names, attachments that download through the
 * report and decrypt here), who sent it from which device, where and when, and Delete.
 */
export function EncryptedReportView({ serverId, report }: EncryptedReportViewProps) {
  const detail = useMessageReport(serverId, report.id);
  const memberLookup = useMemberLookup(serverId);
  const principals = usePrincipals(serverId);
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMessage = useDeleteReportedMessageMutation();

  const authorId = detail.data?.messageAuthorId ?? report.messageAuthorId;
  const sender = authorId ? memberLookup.resolve(authorId).displayName : "the sender";
  const deviceName = useDeviceName(
    (authorId && principals.ofUser.get(authorId)) || null,
    report.frankedSenderDeviceId,
  );
  const conversation = findCachedConversation(qc, serverId, report.conversationId);
  const frankedContent = detail.data?.frankedContent ?? null;
  const content = useMemo(
    () => (frankedContent ? parseReportedContent(frankedContent) : null),
    [frankedContent],
  );

  if (detail.isPending) {
    return <p className="text-sm text-rim-text-muted">Opening the reported message…</p>;
  }
  if (detail.isError) {
    return (
      <p role="alert" className="text-sm text-rim-danger">
        {graphqlErrorMessage(detail.error, "Could not open the reported message.")}
      </p>
    );
  }

  const expiresAt = detail.data.frankedContentExpiresAt;

  return (
    <div className="space-y-2 rounded-lg border border-rim-line bg-rim-panel-soft p-3">
      {detail.data.frankedContent === null ? (
        <p className="text-sm italic text-rim-text-faint">
          The reported content has been deleted from the server.
        </p>
      ) : content === null ? (
        <p role="alert" className="text-sm text-rim-danger">
          The reported content could not be read.
        </p>
      ) : (
        <>
          <blockquote
            data-testid="reported-body"
            className="whitespace-pre-wrap break-words border-l-2 border-rim-accent pl-2 text-sm text-rim-text"
          >
            {withMentionNames(content.body, (p) => principals.names.get(p))}
          </blockquote>
          {content.attachments.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label="Reported attachments">
              {content.attachments.map((attachment) => (
                <ReportedAttachmentRow
                  key={attachment.blobSha256}
                  reportId={report.id}
                  contentBytes={content.bytes}
                  attachment={attachment}
                />
              ))}
            </ul>
          )}
        </>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-rim-text-muted">
        <dt>Sender</dt>
        <dd className="text-rim-text">{sender}</dd>
        <dt>Device</dt>
        <dd className="break-all text-rim-text">{deviceName ?? "unknown"}</dd>
        <dt>Conversation</dt>
        <dd className="text-rim-text">
          {conversation?.title ?? "An encrypted conversation you are not in"}
        </dd>
        <dt>Sent</dt>
        <dd className="text-rim-text">
          {detail.data.messageSentAt ? formatTime(detail.data.messageSentAt) : "unknown"}
        </dd>
      </dl>
      <p className="flex items-start gap-1.5 text-xs text-rim-success">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Verified: this is the exact message {sender}&apos;s device sent. Other messages in the
          conversation are not shown and are not verified.
        </span>
      </p>
      <p className="text-xs text-rim-text-faint">
        {expiresAt
          ? `The reported content is deleted from the server on ${formatTime(expiresAt)}.`
          : "The reported content is kept until 90 days after this report is closed."}
      </p>
      <div className="pt-1">
        <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
          Delete message
        </Button>
      </div>
      {confirmDelete && (
        <ModerationDialog
          title="Delete this message?"
          description="You are deleting a reported encrypted message as a moderator. It is removed for every member of the conversation. This cannot be undone, and it is recorded in the audit log."
          tone="danger"
          confirmLabel="Delete"
          errorFallback="Failed to delete message"
          onConfirm={() =>
            deleteMessage.mutateAsync({
              input: {
                serverId,
                conversationId: report.conversationId,
                messageId: report.messageId,
              },
            })
          }
          onDone={() => {
            setConfirmDelete(false);
            toast.success("Message deleted");
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function ReportedAttachmentRow({
  reportId,
  contentBytes,
  attachment,
}: {
  reportId: string;
  contentBytes: Uint8Array;
  attachment: ReportedAttachment;
}) {
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const blob = await downloadReportedBlob(reportId, attachment.blobSha256);
      const plain = await decryptReportedAttachment(contentBytes, attachment.blobSha256, blob);
      const url = URL.createObjectURL(new Blob([plain as BlobPart], { type: attachment.mime }));
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      toast.error("The file could not be opened", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        aria-label={`Download ${attachment.name}`}
        className="flex w-fit items-center gap-2 rounded-lg border border-rim-line bg-rim-panel px-3 py-1.5 text-xs text-rim-text hover:border-rim-accent/40"
      >
        <FileIcon className="h-4 w-4 text-rim-text-muted" aria-hidden />
        <span className="max-w-60 truncate">{attachment.name}</span>
        <span className="text-rim-text-faint">{formatSize(attachment.size)}</span>
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
    </li>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
