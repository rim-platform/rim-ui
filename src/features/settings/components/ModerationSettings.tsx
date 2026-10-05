import { useState } from "react";

import { Avatar } from "../../../shared/ui/Avatar";
import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/toast";
import { formatTime } from "../../../shared/utils/formatTime";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { MessageReportStatus, ReportOutcome } from "../../../core/graphql/generated/schema-types";
import { useCanModerate } from "../../workspaces/api/useMyServerRole";
import {
  useMessageReports,
  useResolveReportMutation,
  useServerBans,
  useUnbanMemberMutation,
  type MessageReportRow,
  type ServerBanRow,
} from "../../workspaces/api/useModeration";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";

interface ModerationSettingsProps {
  serverId: string | null;
}

/**
 * Settings → Workspace → Moderation (Owner/Moderator, Track 1.2): active bans with Unban, and
 * message reports with Resolve / Dismiss. The server answers `FORBIDDEN` to anyone else and
 * that message is shown here.
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
      <ReportsList serverId={serverId} />
    </section>
  );
}

const ERROR_BOX =
  "rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger";

function BansList({ serverId }: { serverId: string }) {
  const { data: bans, isPending, isError, error } = useServerBans(serverId);
  const unban = useUnbanMemberMutation();

  function banName(ban: ServerBanRow): string {
    return ban.user?.displayName || ban.user?.username || ban.userId.slice(0, 8);
  }

  function handleUnban(ban: ServerBanRow) {
    unban.mutate(
      { serverId, userId: ban.userId },
      {
        onSuccess: () => toast.success(`Unbanned ${banName(ban)}`),
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

function ReportsList({ serverId }: { serverId: string }) {
  const [filter, setFilter] = useState<MessageReportStatus | "ALL">(MessageReportStatus.OPEN);
  const status = filter === "ALL" ? null : filter;
  const { data, isPending, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useMessageReports(serverId, status);
  const reports = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-rim-text">Reports</h3>
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
            <ReportRow key={report.id} serverId={serverId} report={report} />
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

function ReportRow({ serverId, report }: { serverId: string; report: MessageReportRow }) {
  const memberLookup = useMemberLookup(serverId);
  const resolve = useResolveReportMutation();
  const reporter = memberLookup.resolve(report.reporterUserId).displayName;
  const author = report.messageAuthorId
    ? memberLookup.resolve(report.messageAuthorId).displayName
    : null;
  const isOpen = report.status === MessageReportStatus.OPEN;

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
      </div>
      <p className="text-sm text-rim-text">{report.reason}</p>
      {report.messageReadable ? (
        <blockquote className="whitespace-pre-wrap break-words border-l-2 border-rim-line pl-2 text-sm text-rim-text-muted">
          {report.messageText ?? <span className="italic">This message was deleted</span>}
        </blockquote>
      ) : (
        <p className="border-l-2 border-rim-line pl-2 text-sm italic text-rim-text-faint">
          message not visible to you
        </p>
      )}
      {isOpen && (
        <div className="flex gap-2 pt-1">
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
        </div>
      )}
    </li>
  );
}
