import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { queryKeys } from "../../../core/query/keys";
import type { KnownServerInfo } from "../../updater/api/serverInfoApi";
import { Avatar } from "../../../shared/ui/Avatar";
import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/toast";
import { personName } from "../../../shared/utils/handles";
import { formatTime } from "../../../shared/utils/formatTime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { MessageReportStatus, ReportOutcome } from "../../../core/graphql/generated/schema-types";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import {
  useDeleteReportedMessageMutation,
  useMessageReports,
  useResolveReportMutation,
  useServerBans,
  useUnbanMemberMutation,
  type MessageReportRow,
  type ServerBanRow,
} from "../../workspaces/api/useModeration";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";
import { EncryptedReportView } from "./EncryptedReportView";

interface ModerationSettingsProps {
  serverId: string | null;
}

/**
 * Settings → Workspace → Moderation (Owner/Moderator): active bans with Unban, and message
 * reports with Resolve / Dismiss, including the verified content of reported encrypted
 * messages. The server answers `FORBIDDEN` to anyone else and that message is shown here.
 */
export function ModerationSettings({ serverId }: ModerationSettingsProps) {
  const canModerate = useCanModerate(serverId ?? undefined);
  if (!serverId || !canModerate) return null;

  return (
    <section className="space-y-6" aria-labelledby="moderation-heading">
      <div>
        <h2 id="moderation-heading" className="text-base font-semibold text-rim-text">
          Moderation
        </h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Bans and reported messages for this workspace. Every action here is recorded in the audit
          log.
        </p>
      </div>
      <BansList serverId={serverId} />
      <MessageReportsList serverId={serverId} />
    </section>
  );
}

const ERROR_BOX =
  "rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger";

function BansList({ serverId }: { serverId: string }) {
  const { data: bans, isPending, isError, error } = useServerBans(serverId);
  const unban = useUnbanMemberMutation();
  const qc = useQueryClient();

  function banName(ban: ServerBanRow): string {
    return ban.user ? personName(ban.user, ban.userId, null) : "this person";
  }

  function handleUnban(ban: ServerBanRow) {
    unban.mutate(
      { serverId, userId: ban.userId },
      {
        onSuccess: () => {
          const isDefault =
            qc.getQueryData<KnownServerInfo>(queryKeys.serverInfo)?.defaultWorkspace === serverId;
          toast.success(
            `Unbanned ${banName(ban)}${isDefault ? ". Local accounts are restored to the default workspace." : ""}`,
          );
        },
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not lift the ban")),
      },
    );
  }

  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
      <h3 className="text-sm font-medium text-rim-text">Bans</h3>
      {isPending && <p className="mt-2 text-sm text-rim-text-muted">Loading bans…</p>}
      {isError && (
        <p role="alert" className={`mt-2 ${ERROR_BOX}`}>
          {graphqlErrorMessage(error, "Failed to load bans.")}
        </p>
      )}
      {bans && bans.length === 0 && (
        <p className="mt-2 text-sm text-rim-text-muted">No active bans.</p>
      )}
      {bans && bans.length > 0 && (
        <ul className="mt-2 divide-y divide-rim-line" aria-label="Bans">
          {bans.map((ban) => {
            const name = banName(ban);
            return (
              <li
                key={ban.userId}
                data-testid={`ban-row-${ban.userId}`}
                className="flex items-center gap-3 py-2"
              >
                <Avatar url={ban.user?.avatarUrl} name={name} userId={ban.userId} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-rim-text">{name}</p>
                  <p className="truncate text-xs text-rim-text-muted">
                    {ban.reason ? ban.reason : "No reason given"}
                    {" · "}
                    {ban.expiresAt ? `Expires ${formatTime(ban.expiresAt)}` : "Never expires"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={unban.isPending && unban.variables?.userId === ban.userId}
                  onClick={() => handleUnban(ban)}
                  aria-label={`Unban ${name}`}
                >
                  Unban
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const STATUS_FILTERS: { value: MessageReportStatus | "ALL"; label: string }[] = [
  { value: MessageReportStatus.OPEN, label: "Open" },
  { value: MessageReportStatus.RESOLVED, label: "Resolved" },
  { value: MessageReportStatus.DISMISSED, label: "Dismissed" },
  { value: "ALL", label: "All" },
];

const STATUS_LABEL: Record<MessageReportStatus, string> = {
  [MessageReportStatus.OPEN]: "Open",
  [MessageReportStatus.RESOLVED]: "Resolved",
  [MessageReportStatus.DISMISSED]: "Dismissed",
};

/**
 * The message reports of `serverId`, newest first, filtered by status, with Resolve, Dismiss
 * and the verified content of reported encrypted messages. Titled `title`.
 *
 * With `onBlockPrincipal` the list is an instance operator's view of the direct space: it asks
 * for each author's principal id, shows it with a Block principal action that calls
 * `onBlockPrincipal`, and offers Delete on a reported unencrypted message.
 */
export function MessageReportsList({
  serverId,
  title = "Reports",
  onBlockPrincipal,
}: {
  serverId: string;
  title?: string;
  onBlockPrincipal?: (principalId: string) => void;
}) {
  const [filter, setFilter] = useState<MessageReportStatus | "ALL">(MessageReportStatus.OPEN);
  const status = filter === "ALL" ? null : filter;
  const { data, isPending, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useMessageReports(serverId, status, true, onBlockPrincipal !== undefined);
  const reports = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-rim-text">{title}</h3>
        <label className="flex items-center gap-2 text-xs text-rim-text-muted">
          Status
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as MessageReportStatus | "ALL")}
            className="rounded-md border border-rim-line bg-rim-void px-2 py-1 text-xs text-rim-text outline-none focus:border-rim-accent"
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1 text-xs text-rim-text-faint">Newest first.</p>
      {isPending && <p className="mt-2 text-sm text-rim-text-muted">Loading reports…</p>}
      {isError && (
        <p role="alert" className={`mt-2 ${ERROR_BOX}`}>
          {graphqlErrorMessage(error, "Failed to load reports.")}
        </p>
      )}
      {data && reports.length === 0 && (
        <p className="mt-2 text-sm text-rim-text-muted">No reports.</p>
      )}
      {reports.length > 0 && (
        <ul className="mt-2 divide-y divide-rim-line" aria-label="Reports">
          {reports.map((report) => (
            <ReportRow
              key={report.id}
              serverId={serverId}
              report={report}
              onBlockPrincipal={onBlockPrincipal}
            />
          ))}
        </ul>
      )}
      {hasNextPage && (
        <div className="mt-2 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            isLoading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

function ReportRow({
  serverId,
  report,
  onBlockPrincipal,
}: {
  serverId: string;
  report: MessageReportRow;
  onBlockPrincipal?: (principalId: string) => void;
}) {
  const memberLookup = useMemberLookup(serverId);
  const resolve = useResolveReportMutation();
  const deleteMessage = useDeleteReportedMessageMutation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reporter = memberLookup.resolve(report.reporterUserId).displayName;
  const principalId = report.messageAuthorPrincipalId ?? null;
  const authorId = report.messageAuthorId;
  // Someone the viewer shares no conversation with is named by their principal, not an id prefix.
  const author = !authorId
    ? null
    : principalId && !memberLookup.map.has(authorId)
      ? principalId
      : memberLookup.resolve(authorId).displayName;
  const isOpen = report.status === MessageReportStatus.OPEN;
  const verified = report.frankingVerifiedAt !== null && report.frankingVerifiedAt !== undefined;
  const [showContent, setShowContent] = useState(false);
  // Only the reported message is shown: an instance operator reads no other message of the
  // conversation, and a deleted one shows its author but no text.
  const singleMessage = !report.messageReadable && !verified && authorId !== null;
  // An instance operator deletes a reported unencrypted message here; a verified encrypted one
  // is deleted from its content view.
  const canDelete = onBlockPrincipal !== undefined && !verified && report.messageText !== null;

  function handleResolve(outcome: ReportOutcome) {
    resolve.mutate(
      { serverId, reportId: report.id, outcome },
      {
        onSuccess: () =>
          toast.success(
            outcome === ReportOutcome.RESOLVED ? "Report resolved" : "Report dismissed",
          ),
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not update the report")),
      },
    );
  }

  return (
    <li data-testid={`report-row-${report.id}`} className="space-y-1 py-3">
      <div className="flex items-center gap-2 text-xs text-rim-text-muted">
        <span className="font-medium text-rim-text">{reporter}</span>
        <span>reported</span>
        {author && <span>a message by {author}</span>}
        <span className="text-rim-text-faint">&middot; {formatTime(report.createdAt)}</span>
        {!isOpen && (
          <span className="rounded border border-rim-line px-1 text-[10px] uppercase tracking-wider text-rim-text-faint">
            {STATUS_LABEL[report.status]}
          </span>
        )}
        {verified && (
          <span className="rounded border border-rim-success/40 px-1 text-[10px] uppercase tracking-wider text-rim-success">
            Encrypted &middot; verified
          </span>
        )}
      </div>
      <p className="text-sm text-rim-text">{report.reason}</p>
      {principalId && (
        <p className="flex flex-wrap items-center gap-2 text-[11px] text-rim-text-faint">
          <span>
            Author principal <span className="font-mono">{principalId}</span>
          </span>
          {onBlockPrincipal && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onBlockPrincipal(principalId)}
              aria-label={`Block principal ${principalId}`}
            >
              Block principal
            </Button>
          )}
        </p>
      )}
      {verified ? (
        showContent ? (
          <EncryptedReportView serverId={serverId} report={report} />
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => setShowContent(true)}>
            Show reported message
          </Button>
        )
      ) : report.messageReadable || singleMessage ? (
        <>
          <blockquote className="whitespace-pre-wrap break-words border-l-2 border-rim-line pl-2 text-sm text-rim-text-muted">
            {report.messageText ?? <span className="italic">This message was deleted</span>}
          </blockquote>
          {singleMessage && report.messageText !== null && (
            <p className="text-xs text-rim-text-faint">
              Only the reported message is shown, not the rest of the conversation.
            </p>
          )}
        </>
      ) : (
        <p className="border-l-2 border-rim-line pl-2 text-sm italic text-rim-text-faint">
          message not visible to you
        </p>
      )}
      {(isOpen || canDelete) && (
        <div className="flex gap-2 pt-1">
          {isOpen && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={resolve.isPending}
                onClick={() => handleResolve(ReportOutcome.RESOLVED)}
              >
                Resolve
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={resolve.isPending}
                onClick={() => handleResolve(ReportOutcome.DISMISSED)}
              >
                Dismiss
              </Button>
            </>
          )}
          {canDelete && (
            <Button type="button" variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete message
            </Button>
          )}
        </div>
      )}
      {confirmDelete && (
        <ModerationDialog
          title="Delete this message?"
          description="You are deleting a reported message as an instance operator. It is removed for every member of the conversation. This cannot be undone, and it is recorded in the audit log."
          tone="danger"
          chips={["DANGEROUS", "OPERATOR"]}
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
    </li>
  );
}
