import type { UseQueryResult } from "@tanstack/react-query";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import type { InstanceAbuseReport } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { formatTime } from "../../../shared/utils/formatTime";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import { useResolveInstanceReportMutation } from "../api/instanceModeration";
import { BADGE, ERROR_BOX, PANEL } from "./styles";

interface ReportsSectionProps {
  reports: UseQueryResult<InstanceAbuseReport[]>;
  openOnly: boolean;
  onOpenOnlyChange: (openOnly: boolean) => void;
  /** Opens the block form with this principal filled in. */
  onBlockPrincipal: (principalId: string) => void;
}

/** Who or what a report names: the local username, else the principal, else the server. */
function reportSubject(report: InstanceAbuseReport): string {
  if (report.subjectUsername) return `@${report.subjectUsername}`;
  return report.subjectPrincipalId ?? report.subjectServerId ?? "Unknown subject";
}

/** Who filed a report: a local user, or the operator from the abuse address. */
function reportReporter(report: InstanceAbuseReport): string {
  if (report.reporterUsername) return `@${report.reporterUsername}`;
  return report.reporterUserId ?? "the abuse address";
}

/** Abuse reports filed with this server, oldest first, with Resolve and Block principal. */
export function ReportsSection({
  reports,
  openOnly,
  onOpenOnlyChange,
  onBlockPrincipal,
}: ReportsSectionProps) {
  const { data, isPending, isError, error } = reports;

  return (
    <div className={PANEL}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-rim-text">Abuse reports</h3>
        <label className="flex items-center gap-2 text-xs text-rim-text-muted">
          Show resolved
          <ToggleSwitch
            checked={!openOnly}
            onChange={(showResolved) => onOpenOnlyChange(!showResolved)}
            label="Show resolved reports"
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-rim-text-faint">Oldest first.</p>
      {isPending && <p className="mt-2 text-sm text-rim-text-muted">Loading reports…</p>}
      {isError && (
        <p role="alert" className={`mt-2 ${ERROR_BOX}`}>
          {graphqlErrorMessage(error, "Failed to load reports.")}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="mt-2 text-sm text-rim-text-muted">
          {openOnly ? "No open reports." : "No reports."}
        </p>
      )}
      {data && data.length > 0 && (
        <ul className="mt-2 divide-y divide-rim-line" aria-label="Abuse reports">
          {data.map((report) => (
            <ReportRow key={report.id} report={report} onBlockPrincipal={onBlockPrincipal} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportRow({
  report,
  onBlockPrincipal,
}: {
  report: InstanceAbuseReport;
  onBlockPrincipal: (principalId: string) => void;
}) {
  const resolve = useResolveInstanceReportMutation();
  const subject = reportSubject(report);
  const principalId = report.subjectPrincipalId;

  function handleResolve() {
    resolve.mutate(
      { id: report.id },
      {
        onSuccess: () => toast.success("Report resolved"),
        onError: (err) => toast.error(graphqlErrorMessage(err, "Could not resolve the report")),
      },
    );
  }

  return (
    <li data-testid={`instance-report-${report.id}`} className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-rim-text-muted">
        <span className="font-medium text-rim-text">{subject}</span>
        <span>reported by {reportReporter(report)}</span>
        <span className="text-rim-text-faint">&middot; {formatTime(report.createdAt)}</span>
        {report.resolved && (
          <span className={BADGE}>
            Resolved{report.resolvedAt ? ` ${formatTime(report.resolvedAt)}` : ""}
          </span>
        )}
      </div>
      {report.subjectUsername && principalId && (
        <p className="truncate font-mono text-[11px] text-rim-text-faint">{principalId}</p>
      )}
      {report.subjectServerId && subject !== report.subjectServerId && (
        <p className="truncate text-[11px] text-rim-text-faint">
          Server <span className="font-mono">{report.subjectServerId}</span>
        </p>
      )}
      <p className="whitespace-pre-wrap break-words text-sm text-rim-text">{report.reason}</p>
      {(!report.resolved || principalId) && (
        <div className="flex gap-2 pt-1">
          {!report.resolved && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={resolve.isPending}
              onClick={handleResolve}
            >
              Resolve
            </Button>
          )}
          {principalId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onBlockPrincipal(principalId)}
              aria-label={`Block principal ${subject}`}
            >
              Block principal
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
