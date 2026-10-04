import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, X } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { formatTime } from "../../../shared/utils/formatTime";
import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  IncidentSeverityGql,
  IncidentStatusGql,
} from "../../../core/graphql/generated/schema-types";
import type { IncidentGql } from "../../../core/graphql/generated/schema-types";
import { useListIncidents, type IncidentListCursor, type PageDir } from "../api/useListIncidents";

const STATUS_OPTIONS: { value: IncidentStatusGql; label: string }[] = [
  { value: IncidentStatusGql.ACTIVE, label: "Active" },
  { value: IncidentStatusGql.MITIGATED, label: "Mitigated" },
  { value: IncidentStatusGql.RESOLVED, label: "Resolved" },
];

const SEVERITY_OPTIONS: { value: IncidentSeverityGql; label: string }[] = [
  { value: IncidentSeverityGql.SEV_1, label: "SEV1" },
  { value: IncidentSeverityGql.SEV_2, label: "SEV2" },
  { value: IncidentSeverityGql.SEV_3, label: "SEV3" },
  { value: IncidentSeverityGql.SEV_4, label: "SEV4" },
];

const SEVERITY_BADGE: Record<IncidentSeverityGql, string> = {
  [IncidentSeverityGql.SEV_1]: "bg-rim-danger text-white",
  [IncidentSeverityGql.SEV_2]: "bg-rim-warm text-white",
  [IncidentSeverityGql.SEV_3]: "bg-[#eab308] text-black",
  [IncidentSeverityGql.SEV_4]: "bg-rim-accent text-white",
};

// Derive the label map from SEVERITY_OPTIONS so the chip label and the row
// badge stay in lock-step — single source of truth within the file.
const SEVERITY_LABEL = Object.fromEntries(
  SEVERITY_OPTIONS.map((o) => [o.value, o.label]),
) as Record<IncidentSeverityGql, string>;

const STATUS_BADGE: Record<IncidentStatusGql, string> = {
  [IncidentStatusGql.ACTIVE]: "bg-rim-danger/15 text-rim-danger",
  [IncidentStatusGql.MITIGATED]: "bg-rim-warm/15 text-rim-warm",
  [IncidentStatusGql.RESOLVED]: "bg-rim-success/15 text-rim-success",
};

const STATUS_LABEL: Record<IncidentStatusGql, string> = {
  [IncidentStatusGql.ACTIVE]: "Active",
  [IncidentStatusGql.MITIGATED]: "Mitigated",
  [IncidentStatusGql.RESOLVED]: "Resolved",
};

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition",
        active
          ? "border-rim-accent bg-rim-accent/15 text-rim-accent"
          : "border-rim-line bg-rim-panel-soft text-rim-text-muted hover:text-rim-text",
      )}
    >
      {label}
    </button>
  );
}

function SkeletonRow() {
  return (
    <li className="flex items-center gap-3 border-b border-rim-line px-4 py-3">
      <div className="h-4 w-12 animate-pulse rounded bg-rim-panel-soft" />
      <div className="h-4 w-20 animate-pulse rounded bg-rim-panel-soft" />
      <div className="h-4 flex-1 animate-pulse rounded bg-rim-panel-soft" />
      <div className="h-4 w-32 animate-pulse rounded bg-rim-panel-soft" />
    </li>
  );
}

interface IncidentRowProps {
  incident: IncidentGql;
  onSelect: (incident: IncidentGql) => void;
}

function IncidentRow({ incident, onSelect }: IncidentRowProps) {
  const handleClick = useCallback(() => onSelect(incident), [incident, onSelect]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLLIElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(incident);
      }
    },
    [incident, onSelect],
  );

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-testid={`incident-row-${incident.id}`}
      className="grid cursor-pointer grid-cols-[64px_96px_1fr_220px] items-center gap-3 border-b border-rim-line px-4 py-3 outline-none transition hover:bg-rim-panel-soft focus:bg-rim-panel-soft focus:ring-1 focus:ring-rim-accent"
    >
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-center text-[10px] font-bold uppercase leading-none",
          incident.severity
            ? SEVERITY_BADGE[incident.severity]
            : "bg-rim-panel-soft text-rim-text-faint",
        )}
      >
        {incident.severity ? SEVERITY_LABEL[incident.severity] : "—"}
      </span>
      <span
        className={cn(
          "rounded px-2 py-0.5 text-center text-[10px] font-medium uppercase",
          STATUS_BADGE[incident.status],
        )}
      >
        {STATUS_LABEL[incident.status]}
      </span>
      <span className="truncate text-sm text-rim-text">{incident.title}</span>
      <span className="text-xs text-rim-text-muted">
        <span title="Started">{formatTime(incident.startedAt)}</span>
        {incident.resolvedAt && (
          <>
            <span className="mx-1 text-rim-text-faint">→</span>
            <span title="Resolved">{formatTime(incident.resolvedAt)}</span>
          </>
        )}
      </span>
    </li>
  );
}

interface IncidentHistoryPageProps {
  /** When true, hides this page's own header/back/close chrome — used by `IncidentsHub`,
   * which already renders that chrome one level up (segmented sub-tab header). Defaults
   * to `false` so standalone rendering (and existing tests) is unaffected. */
  embedded?: boolean;
}

export function IncidentHistoryPage({ embedded = false }: IncidentHistoryPageProps = {}) {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const setSelectedConversationId = useShellStore((s) => s.setSelectedConversationId);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);

  const [statusFilter, setStatusFilter] = useState<IncidentStatusGql[]>([]);
  const [severityFilter, setSeverityFilter] = useState<IncidentSeverityGql[]>([]);
  const [cursor, setCursor] = useState<IncidentListCursor | null>(null);
  const [dir, setDir] = useState<PageDir>("AFTER");

  const toggleStatus = useCallback((value: IncidentStatusGql) => {
    setStatusFilter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
    setCursor(null);
    setDir("AFTER");
  }, []);

  const toggleSeverity = useCallback((value: IncidentSeverityGql) => {
    setSeverityFilter((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
    setCursor(null);
    setDir("AFTER");
  }, []);

  const clearFilters = useCallback(() => {
    setStatusFilter([]);
    setSeverityFilter([]);
    setCursor(null);
    setDir("AFTER");
  }, []);

  const filtersActive = statusFilter.length > 0 || severityFilter.length > 0;

  const query = useListIncidents({
    serverId: workspaceId,
    statusFilter,
    severityFilter,
    cursor,
    dir,
  });

  const handleSelect = useCallback(
    (incident: IncidentGql) => {
      setSelectedConversationId(incident.conversationId);
      setMainSurface({ kind: "conversation" });
    },
    [setMainSurface, setSelectedConversationId],
  );

  const handleClose = useCallback(() => {
    setMainSurface({ kind: "conversation" });
  }, [setMainSurface]);

  const handleNextPage = useCallback(() => {
    if (query.data?.next) {
      setCursor(query.data.next);
      setDir("AFTER");
    }
  }, [query.data]);

  const handlePrevPage = useCallback(() => {
    if (query.data?.prev) {
      setCursor(query.data.prev);
      setDir("BEFORE");
    }
  }, [query.data]);

  const items = query.data?.items ?? [];
  // When the query is disabled (no workspace yet) react-query keeps
  // `isPending: true` indefinitely. Treat that case as empty rather than
  // perpetual skeletons.
  const queryActive = Boolean(workspaceId);
  const showSkeleton = queryActive && query.isPending;
  const showEmpty = !showSkeleton && !query.isError && items.length === 0;
  const pageInfo = query.data?.pageInfo;

  const summary = useMemo(() => {
    if (showSkeleton) return "Loading incidents...";
    if (query.isError) return "Failed to load incidents.";
    if (!queryActive) return "Select a workspace to view incidents.";
    return `${items.length} incident${items.length === 1 ? "" : "s"}`;
  }, [showSkeleton, query.isError, queryActive, items.length]);

  return (
    <div className="flex h-full flex-col" data-testid="incident-history-page">
      {!embedded && (
        <header className="flex h-10 items-center justify-between border-b border-rim-line px-8">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Back to conversation"
              className="rounded p-1 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <AlertTriangle className="h-4 w-4 text-rim-danger" />
            <h1 className="text-lg font-semibold text-rim-text">Incident History</h1>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close incident history"
            title="Close"
            className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
      )}

      <div className="flex flex-col gap-3 border-b border-rim-line px-8 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-rim-text-faint">Status</span>
          {STATUS_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              active={statusFilter.includes(opt.value)}
              label={opt.label}
              onClick={() => toggleStatus(opt.value)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-rim-text-faint">Severity</span>
          {SEVERITY_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              active={severityFilter.includes(opt.value)}
              label={opt.label}
              onClick={() => toggleSeverity(opt.value)}
            />
          ))}
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-2 rounded-full border border-transparent px-3 py-1 text-xs text-rim-text-muted transition hover:text-rim-text"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-2 text-xs text-rim-text-faint">
          <span>{summary}</span>
          {query.isFetching && !query.isPending && <span>Refreshing...</span>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {showSkeleton && (
            <ul aria-label="Loading incidents">
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </ul>
          )}

          {query.isError && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-rim-danger">Failed to load incidents.</p>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="rounded border border-rim-line px-3 py-1 text-xs text-rim-text-muted transition hover:bg-rim-panel-soft hover:text-rim-text"
              >
                Retry
              </button>
            </div>
          )}

          {showEmpty && (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-rim-text-muted">
              <p>{filtersActive ? "No incidents match these filters." : "No incidents yet."}</p>
              {filtersActive && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-rim-accent hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {!showSkeleton && !query.isError && items.length > 0 && (
            <ul aria-label="Incidents">
              {items.map((incident) => (
                <IncidentRow key={incident.id} incident={incident} onSelect={handleSelect} />
              ))}
            </ul>
          )}
        </div>

        {pageInfo && (pageInfo.hasPrev || pageInfo.hasNext) && (
          <div className="flex items-center justify-between border-t border-rim-line px-8 py-2">
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={!pageInfo.hasPrev}
              className={cn(
                "flex items-center gap-1 rounded px-3 py-1 text-xs transition",
                pageInfo.hasPrev
                  ? "text-rim-text-muted hover:bg-rim-panel-soft hover:text-rim-text"
                  : "cursor-not-allowed text-rim-text-faint",
              )}
            >
              <ChevronLeft className="h-3 w-3" />
              Newer
            </button>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={!pageInfo.hasNext}
              className={cn(
                "flex items-center gap-1 rounded px-3 py-1 text-xs transition",
                pageInfo.hasNext
                  ? "text-rim-text-muted hover:bg-rim-panel-soft hover:text-rim-text"
                  : "cursor-not-allowed text-rim-text-faint",
              )}
            >
              Older
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
