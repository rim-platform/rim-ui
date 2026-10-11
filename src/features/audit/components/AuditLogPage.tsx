import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardList, X } from "lucide-react";

import { cn } from "../../../shared/ui/cn";
import { formatTime } from "../../../shared/utils/formatTime";
import { useShellStore } from "../../../shell/state/useShellStore";
import { FORBIDDEN, graphqlErrorCode } from "../../../core/graphql/errors";
import { AuditOutcomeGql, TypedVerbGql } from "../../../core/graphql/generated/schema-types";
import type { AuditLogEntry } from "../../../core/graphql/generated/schema-types";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useWorkspace } from "../../workspaces/api/useWorkspace";
import { canModerate } from "../../workspaces/role";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { useListAuditLog, type AuditLogScope } from "../api/useListAuditLog";

// ── Typed verb display config ──────────────────────────────────────────────

const VERB_LABEL: Record<TypedVerbGql, string> = {
  [TypedVerbGql.READ]: "Read",
  [TypedVerbGql.WRITE]: "Write",
  [TypedVerbGql.DELETE]: "Delete",
  [TypedVerbGql.SEND]: "Send",
  [TypedVerbGql.OPEN]: "Open",
  [TypedVerbGql.CLOSE]: "Close",
  [TypedVerbGql.TOGGLE]: "Toggle",
  [TypedVerbGql.NAVIGATE]: "Navigate",
  [TypedVerbGql.EXECUTE]: "Execute",
  [TypedVerbGql.CONFIGURE]: "Configure",
  [TypedVerbGql.OTHER]: "Other",
};

const VERB_BADGE: Record<TypedVerbGql, string> = {
  [TypedVerbGql.READ]: "bg-rim-accent/15 text-rim-accent",
  [TypedVerbGql.WRITE]: "bg-rim-warm/15 text-rim-warm",
  [TypedVerbGql.DELETE]: "bg-rim-danger/15 text-rim-danger",
  [TypedVerbGql.SEND]: "bg-rim-success/15 text-rim-success",
  [TypedVerbGql.OPEN]: "bg-rim-accent/10 text-rim-accent",
  [TypedVerbGql.CLOSE]: "bg-rim-text-faint/15 text-rim-text-faint",
  [TypedVerbGql.TOGGLE]: "bg-rim-warm/10 text-rim-warm",
  [TypedVerbGql.NAVIGATE]: "bg-rim-accent/15 text-rim-accent",
  [TypedVerbGql.EXECUTE]: "bg-rim-danger/20 text-rim-danger",
  [TypedVerbGql.CONFIGURE]: "bg-rim-warm/15 text-rim-warm",
  [TypedVerbGql.OTHER]: "bg-rim-panel-soft text-rim-text-muted",
};

const VERB_OPTIONS: { value: TypedVerbGql; label: string }[] = Object.values(TypedVerbGql).map(
  (v) => ({ value: v, label: VERB_LABEL[v as TypedVerbGql] }),
);

// ── Outcome badge ──────────────────────────────────────────────────────────

function outcomeBadgeClass(outcome: AuditOutcomeGql): string {
  switch (outcome) {
    case AuditOutcomeGql.SUCCESS:
      return "bg-rim-success/15 text-rim-success";
    case AuditOutcomeGql.ERROR:
    case AuditOutcomeGql.PERMISSION_DENIED:
    case AuditOutcomeGql.STEP_ERROR:
    case AuditOutcomeGql.MACRO_PARTIAL_FAILURE:
      return "bg-rim-danger/15 text-rim-danger";
    case AuditOutcomeGql.CONFIRMATION_REQUIRED:
    case AuditOutcomeGql.RATE_LIMITED:
      return "bg-rim-warm/15 text-rim-warm";
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

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
      <div className="h-4 w-16 animate-pulse rounded bg-rim-panel-soft" />
      <div className="h-4 w-20 animate-pulse rounded bg-rim-panel-soft" />
      <div className="h-4 flex-1 animate-pulse rounded bg-rim-panel-soft" />
      <div className="h-4 w-24 animate-pulse rounded bg-rim-panel-soft" />
      <div className="h-4 w-32 animate-pulse rounded bg-rim-panel-soft" />
    </li>
  );
}

interface AuditRowProps {
  entry: AuditLogEntry;
}

function AuditRow({ entry }: AuditRowProps) {
  return (
    <li
      data-testid={`audit-row-${entry.id}`}
      className="grid grid-cols-[80px_96px_1fr_96px_180px] items-center gap-3 border-b border-rim-line px-4 py-3"
    >
      {/* Typed verb chip */}
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-center text-[10px] font-bold uppercase leading-none",
          entry.typedVerb ? VERB_BADGE[entry.typedVerb] : "bg-rim-panel-soft text-rim-text-faint",
        )}
        data-testid="typed-verb-chip"
      >
        {entry.typedVerb ? VERB_LABEL[entry.typedVerb] : "—"}
      </span>

      {/* Outcome chip */}
      <span
        className={cn(
          "rounded px-2 py-0.5 text-center text-[10px] font-medium uppercase",
          outcomeBadgeClass(entry.outcome),
        )}
      >
        {entry.outcome}
      </span>

      {/* Command ID */}
      <span className="truncate font-mono text-xs text-rim-text">{entry.commandId}</span>

      {/* Initiator */}
      <span className="truncate text-xs text-rim-text-muted">{entry.initiator}</span>

      {/* Timestamp */}
      <span className="text-right text-xs text-rim-text-faint">{formatTime(entry.createdAt)}</span>
    </li>
  );
}

// ── Scope ──────────────────────────────────────────────────────────────────

interface AuditScope {
  /** The rows to request; `null` until the viewer's role in the workspace is known. */
  scope: AuditLogScope | null;
  /** Whether the viewer sees only their own actions rather than the whole workspace log. */
  ownOnly: boolean;
}

/**
 * The rows the viewer may read: Owners and Moderators read the current workspace's whole log;
 * everyone else, and anyone with no workspace selected, reads their own actions.
 */
function useAuditScope(): AuditScope {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const workspace = useWorkspace(workspaceId ?? undefined);

  if (workspaceId && workspace.isPending) return { scope: null, ownOnly: false };
  if (workspaceId && canModerate(workspace.data?.viewerRole)) {
    return { scope: { serverId: workspaceId, actorUserId: null }, ownOnly: false };
  }
  if (!userId) return { scope: null, ownOnly: true };
  return { scope: { serverId: workspaceId, actorUserId: userId }, ownOnly: true };
}

// ── Main page ──────────────────────────────────────────────────────────────

export function AuditLogPage() {
  const { scope, ownOnly } = useAuditScope();
  // A new scope starts over from the first page with no filter.
  const scopeKey = `${scope?.serverId ?? ""}:${scope?.actorUserId ?? ""}`;
  return <AuditLogView key={scopeKey} scope={scope} ownOnly={ownOnly} />;
}

function AuditLogView({ scope, ownOnly }: AuditScope) {
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const [verbFilter, setVerbFilter] = useState<TypedVerbGql | null>(null);
  const [afterCursor, setAfterCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const query = useListAuditLog({
    scope,
    typedVerbFilter: verbFilter,
    after: afterCursor,
  });
  const forbidden = query.isError && graphqlErrorCode(query.error) === FORBIDDEN;

  const handleSelectVerb = useCallback((value: TypedVerbGql) => {
    setVerbFilter((prev) => (prev === value ? null : value));
    setAfterCursor(null);
    setCursorStack([]);
  }, []);

  const handleClearFilter = useCallback(() => {
    setVerbFilter(null);
    setAfterCursor(null);
    setCursorStack([]);
  }, []);

  const handleClose = useCallback(() => {
    setMainSurface({ kind: "conversation" });
  }, [setMainSurface]);

  const handleNextPage = useCallback(() => {
    const next = query.data?.nextCursor;
    if (!next) return;
    setCursorStack((prev) => [...prev, afterCursor ?? ""]);
    setAfterCursor(next);
  }, [query.data, afterCursor]);

  const handlePrevPage = useCallback(() => {
    setCursorStack((prev) => {
      const updated = [...prev];
      const previous = updated.pop() ?? null;
      setAfterCursor(previous === "" ? null : previous);
      return updated;
    });
  }, []);

  const items = query.data?.items ?? [];
  const pageInfo = query.data?.pageInfo;
  const hasPrev = cursorStack.length > 0;
  const hasNext = Boolean(pageInfo?.hasNextPage);
  const filterActive = verbFilter != null;

  const summary = useMemo(() => {
    if (query.isPending) return "Loading audit log...";
    if (forbidden) return "Not permitted.";
    if (query.isError) return "Failed to load audit log.";
    return `${items.length} entr${items.length === 1 ? "y" : "ies"}`;
  }, [query.isPending, query.isError, forbidden, items.length]);

  return (
    <div className="flex h-full flex-col" data-testid="audit-log-page">
      {/* Header */}
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
          <ClipboardList className="h-4 w-4 text-rim-accent" />
          <h1 className="text-lg font-semibold text-rim-text">Audit Log</h1>
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close audit log"
          title="Close"
          className="rounded-lg p-1.5 text-rim-text-muted transition hover:bg-rim-void/50 hover:text-rim-text"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Filter bar */}
      <div className="flex flex-col gap-3 border-b border-rim-line px-8 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-rim-text-faint">Verb</span>
          {VERB_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              active={verbFilter === opt.value}
              label={opt.label}
              onClick={() => handleSelectVerb(opt.value)}
            />
          ))}
          {filterActive && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="ml-2 rounded-full border border-transparent px-3 py-1 text-xs text-rim-text-muted transition hover:text-rim-text"
            >
              Clear filter
            </button>
          )}
        </div>
        {ownOnly && (
          <p className="text-xs text-rim-text-muted" data-testid="audit-scope-note">
            Showing your own actions.
          </p>
        )}
      </div>

      {/* Table */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Column headers */}
        <div className="grid grid-cols-[80px_96px_1fr_96px_180px] gap-3 border-b border-rim-line px-4 py-1.5 text-[10px] uppercase tracking-wide text-rim-text-faint">
          <span>Verb</span>
          <span>Outcome</span>
          <span>Command</span>
          <span>Initiator</span>
          <span className="text-right">Time</span>
        </div>

        <div className="flex items-center justify-between px-8 py-2 text-xs text-rim-text-faint">
          <span>{summary}</span>
          {query.isFetching && !query.isPending && <span>Refreshing...</span>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {query.isPending && (
            <ul aria-label="Loading audit log">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </ul>
          )}

          {forbidden && (
            <div role="alert" className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-rim-danger">You are not allowed to read this audit log.</p>
              <p className="text-xs text-rim-text-muted">
                Workspace owners and moderators see the whole log. Everyone else sees their own
                actions.
              </p>
            </div>
          )}

          {query.isError && !forbidden && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-rim-danger">Failed to load audit log.</p>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="rounded border border-rim-line px-3 py-1 text-xs text-rim-text-muted transition hover:bg-rim-panel-soft hover:text-rim-text"
              >
                Retry
              </button>
            </div>
          )}

          {!query.isPending && !query.isError && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-rim-text-muted">
              <p>{filterActive ? "No entries match this filter." : "No audit log entries yet."}</p>
              {filterActive && (
                <button
                  type="button"
                  onClick={handleClearFilter}
                  className="text-xs text-rim-accent hover:underline"
                >
                  Clear filter
                </button>
              )}
            </div>
          )}

          {!query.isPending && !query.isError && items.length > 0 && (
            <ul aria-label="Audit log entries">
              {items.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </div>

        {/* Pagination */}
        {(hasPrev || hasNext) && (
          <div className="flex items-center justify-between border-t border-rim-line px-8 py-2">
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={!hasPrev}
              className={cn(
                "flex items-center gap-1 rounded px-3 py-1 text-xs transition",
                hasPrev
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
              disabled={!hasNext}
              className={cn(
                "flex items-center gap-1 rounded px-3 py-1 text-xs transition",
                hasNext
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
