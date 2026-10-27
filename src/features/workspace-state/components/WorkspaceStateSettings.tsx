import { useState, useCallback, useMemo, useDeferredValue } from "react";
import {
  Search,
  Plus,
  Trash2,
  Edit3,
  Clock,
  Database,
  User,
  ChevronDown,
  ChevronRight,
  X,
  Save,
  AlertCircle,
  Loader2,
} from "lucide-react";

import {
  useWorkspaceStateList,
  useSetWorkspaceState,
  useDeleteWorkspaceState,
  WorkspaceStateScopeGql,
} from "../index";
import type { WorkspaceStateEntryGql, SetWorkspaceStateInput } from "../index";
import { graphqlErrorMessage } from "../../../core/graphql/errors";
import { toast } from "../../../shared/toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_KEY_LENGTH = 512;
const MAX_VALUE_SIZE_KB = 64;
const MAX_TTL_DAYS = 30;
const MAX_TTL_SECONDS = MAX_TTL_DAYS * 24 * 60 * 60;
const DEFAULT_LIST_LIMIT = 100;

/** Key format: starts with a-z, body a-z0-9_./:-, ends with a-z0-9, max MAX_KEY_LENGTH chars total. */
const KEY_REGEX = new RegExp(`^[a-z][a-z0-9_.:-]{0,${MAX_KEY_LENGTH - 2}}[a-z0-9]$`);

/** The name each scope goes by in the page's copy; the `SERVER` scope is the workspace's. */
const SCOPE_LABELS: Record<WorkspaceStateScopeGql, string> = {
  [WorkspaceStateScopeGql.SERVER]: "Workspace",
  [WorkspaceStateScopeGql.USER]: "User",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a JSON value for display, truncating if too long. */
function formatValue(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (str.length > 200) return str.slice(0, 200) + "...";
  return str;
}

/** Format a date relative to now. */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);

  if (absDiffMs < 60_000) return diffMs > 0 ? "in <1m" : "<1m ago";
  if (absDiffMs < 3_600_000) {
    const mins = Math.round(absDiffMs / 60_000);
    return diffMs > 0 ? `in ${mins}m` : `${mins}m ago`;
  }
  if (absDiffMs < 86_400_000) {
    const hours = Math.round(absDiffMs / 3_600_000);
    return diffMs > 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(absDiffMs / 86_400_000);
  return diffMs > 0 ? `in ${days}d` : `${days}d ago`;
}

/** Check if an entry is expired. */
function isExpired(entry: WorkspaceStateEntryGql): boolean {
  if (!entry.expiresAt) return false;
  return new Date(entry.expiresAt).getTime() < Date.now();
}

/** Validate key format against backend rules. */
function isValidKey(key: string): boolean {
  if (key.length < 2 || key.length > MAX_KEY_LENGTH) return false;
  if (key.startsWith("system.")) return false;
  return KEY_REGEX.test(key);
}

// ---------------------------------------------------------------------------
// Editor (inline create/edit form)
// ---------------------------------------------------------------------------

interface EntryEditorProps {
  serverId: string;
  scope: WorkspaceStateScopeGql;
  existingEntry?: WorkspaceStateEntryGql;
  onClose: () => void;
}

function EntryEditor({ serverId, scope, existingEntry, onClose }: EntryEditorProps) {
  const isEditing = Boolean(existingEntry);

  const [key, setKey] = useState(existingEntry?.key ?? "");
  const [valueStr, setValueStr] = useState(
    existingEntry ? JSON.stringify(existingEntry.value, null, 2) : "",
  );
  const [ttlMinutes, setTtlMinutes] = useState<string>(() => {
    if (!existingEntry?.expiresAt) return "";
    const remaining = Math.max(
      0,
      Math.round((new Date(existingEntry.expiresAt).getTime() - Date.now()) / 60_000),
    );
    return remaining > 0 ? String(remaining) : "";
  });
  const [error, setError] = useState<string | null>(null);

  const setWorkspaceState = useSetWorkspaceState();

  const handleSave = useCallback(async () => {
    setError(null);

    // Validate key
    if (!key.trim()) {
      setError("Key is required.");
      return;
    }
    if (!isValidKey(key)) {
      setError(
        "Key must start with a-z, contain only a-z, 0-9, '.', '_', ':', '-', end with a-z/0-9, and cannot start with 'system.'",
      );
      return;
    }

    // Validate value — must be valid JSON
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(valueStr);
    } catch {
      setError("Value must be valid JSON.");
      return;
    }

    // Check value size
    const byteSize = new TextEncoder().encode(valueStr).length;
    if (byteSize > MAX_VALUE_SIZE_KB * 1024) {
      setError(`Value exceeds ${MAX_VALUE_SIZE_KB} KB limit.`);
      return;
    }

    // Validate TTL
    let ttlSeconds: number | undefined;
    if (ttlMinutes.trim()) {
      const mins = Number(ttlMinutes);
      if (isNaN(mins) || mins <= 0) {
        setError("TTL must be a positive number (in minutes).");
        return;
      }
      ttlSeconds = Math.round(mins * 60);
      if (ttlSeconds > MAX_TTL_SECONDS) {
        setError(`TTL cannot exceed ${MAX_TTL_DAYS} days.`);
        return;
      }
    }

    try {
      const input: SetWorkspaceStateInput = {
        serverId,
        key,
        value: parsedValue,
        scope,
        ttlSeconds: ttlSeconds ?? null,
      };
      await setWorkspaceState.mutateAsync(input);
      toast.success(isEditing ? `Updated "${key}"` : `Created "${key}"`);
      onClose();
    } catch (err: unknown) {
      const msg = graphqlErrorMessage(err, "Failed to save");
      setError(msg);
    }
  }, [key, valueStr, ttlMinutes, serverId, scope, isEditing, setWorkspaceState, onClose]);

  return (
    <div className="rounded-lg border border-rim-accent/40 bg-rim-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-rim-text">
          {isEditing ? `Edit: ${existingEntry!.key}` : "New entry"}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-rim-text-muted hover:bg-rim-void/50 hover:text-rim-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Key */}
      <div>
        <label className="mb-1 block text-xs font-medium text-rim-text-muted">Key</label>
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={isEditing}
          placeholder="e.g. feature.dark-mode, config.rate-limit"
          className="w-full rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-sm text-rim-text placeholder:text-rim-text-faint disabled:opacity-50 focus:border-rim-accent focus:outline-none"
        />
        {!isEditing && (
          <p className="mt-0.5 text-[11px] text-rim-text-faint">
            Lowercase, dots/underscores/colons/hyphens. Cannot start with &quot;system.&quot;
          </p>
        )}
      </div>

      {/* Value (JSON) */}
      <div>
        <label className="mb-1 block text-xs font-medium text-rim-text-muted">
          Value <span className="text-rim-text-faint">(JSON)</span>
        </label>
        <textarea
          value={valueStr}
          onChange={(e) => setValueStr(e.target.value)}
          rows={6}
          placeholder='e.g. "hello", 42, {"enabled": true}'
          className="w-full rounded-md border border-rim-line bg-rim-void px-3 py-1.5 font-mono text-xs text-rim-text placeholder:text-rim-text-faint focus:border-rim-accent focus:outline-none"
        />
      </div>

      {/* TTL */}
      <div>
        <label className="mb-1 block text-xs font-medium text-rim-text-muted">
          TTL <span className="text-rim-text-faint">(minutes, optional)</span>
        </label>
        <input
          type="number"
          value={ttlMinutes}
          onChange={(e) => setTtlMinutes(e.target.value)}
          min={1}
          placeholder="Leave empty for no expiry"
          className="w-48 rounded-md border border-rim-line bg-rim-void px-3 py-1.5 text-sm text-rim-text placeholder:text-rim-text-faint focus:border-rim-accent focus:outline-none"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rim-danger/30 bg-rim-danger/10 px-3 py-2 text-xs text-rim-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={setWorkspaceState.isPending}
          className="flex items-center gap-1.5 rounded-md bg-rim-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rim-accent/80 disabled:opacity-50"
        >
          {setWorkspaceState.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {isEditing ? "Update" : "Create"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-xs text-rim-text-muted hover:text-rim-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry Row (expandable)
// ---------------------------------------------------------------------------

interface EntryRowProps {
  entry: WorkspaceStateEntryGql;
  onEdit: (entry: WorkspaceStateEntryGql) => void;
  onDelete: (key: string) => Promise<void>;
  isDeleting: boolean;
}

function EntryRow({ entry, onEdit, onDelete, isDeleting }: EntryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const expired = isExpired(entry);

  const handleDelete = useCallback(async () => {
    await onDelete(entry.key);
  }, [onDelete, entry.key]);

  return (
    <div
      className={`rounded-lg border bg-rim-panel transition ${expired ? "border-rim-danger/30 opacity-60" : "border-rim-line"}`}
    >
      {/* Header row */}
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-rim-text-muted" />
        )}

        <span className="min-w-0 flex-1 truncate font-mono text-sm text-rim-text">{entry.key}</span>

        {/* Badges */}
        {entry.expiresAt && (
          <span
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${expired ? "bg-rim-danger/20 text-rim-danger" : "bg-rim-warm/20 text-rim-warm"}`}
            title={
              expired
                ? `Expired ${formatRelativeTime(entry.expiresAt)}`
                : `Expires ${formatRelativeTime(entry.expiresAt)}`
            }
          >
            <Clock className="h-3 w-3" />
            {expired ? "expired" : formatRelativeTime(entry.expiresAt)}
          </span>
        )}

        <span className="rounded bg-rim-void px-1.5 py-0.5 text-[10px] text-rim-text-faint">
          v{entry.version}
        </span>

        {/* Value preview (collapsed).
            SECURITY: entry.value is user-controlled JSON. Rendered as React text node
            which auto-escapes HTML. MUST NOT use dangerouslySetInnerHTML. */}
        {!expanded && (
          <span className="max-w-[200px] truncate text-xs text-rim-text-muted">
            {formatValue(entry.value)}
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => onEdit(entry)}
            title="Edit"
            className="rounded p-1 text-rim-text-muted hover:bg-rim-void/50 hover:text-rim-text"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              title="Delete"
              className="rounded p-1 text-rim-text-muted hover:bg-rim-danger/20 hover:text-rim-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="rounded bg-rim-danger px-2 py-0.5 text-[10px] font-medium text-white hover:bg-rim-danger/80 disabled:opacity-50"
              >
                {isDeleting ? "..." : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded px-1.5 py-0.5 text-[10px] text-rim-text-muted hover:text-rim-text"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-rim-line px-3 py-2 space-y-2">
          {/* SECURITY: entry.value is user-controlled. Rendered as React text node (safe).
              MUST NOT use dangerouslySetInnerHTML or pass to a markdown renderer unsanitized. */}
          <pre className="max-h-48 overflow-auto rounded bg-rim-void p-2 font-mono text-xs text-rim-text">
            {JSON.stringify(entry.value, null, 2)}
          </pre>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-rim-text-faint">
            <span>Created: {formatRelativeTime(entry.createdAt)}</span>
            <span>Updated: {formatRelativeTime(entry.updatedAt)}</span>
            {entry.expiresAt && <span>Expires: {formatRelativeTime(entry.expiresAt)}</span>}
            <span>Version: {entry.version}</span>
            {entry.userId && <span>User: {entry.userId}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface WorkspaceStateSettingsProps {
  serverId: string | undefined;
}

export function WorkspaceStateSettings({ serverId }: WorkspaceStateSettingsProps) {
  const [scope, setScope] = useState<WorkspaceStateScopeGql>(WorkspaceStateScopeGql.SERVER);
  const [prefix, setPrefix] = useState("");
  const deferredPrefix = useDeferredValue(prefix);
  const [editorMode, setEditorMode] = useState<
    { kind: "closed" } | { kind: "create" } | { kind: "edit"; entry: WorkspaceStateEntryGql }
  >({ kind: "closed" });

  const {
    data: entries,
    isLoading,
    error,
  } = useWorkspaceStateList(serverId, deferredPrefix, scope, DEFAULT_LIST_LIMIT);

  // Single delete mutation instance shared by all entry rows
  const deleteWorkspaceState = useDeleteWorkspaceState();
  const handleDeleteEntry = useCallback(
    async (key: string) => {
      if (!serverId) return;
      try {
        await deleteWorkspaceState.mutateAsync({ serverId, key, scope });
        toast.success(`Deleted "${key}"`);
      } catch (err: unknown) {
        const msg = graphqlErrorMessage(err, "Failed to delete");
        toast.error(msg);
      }
    },
    [deleteWorkspaceState, serverId, scope],
  );

  // Sort entries: non-expired first, then alphabetically by key
  const sortedEntries = useMemo(() => {
    if (!entries) return [];
    return [...entries].sort((a, b) => {
      const aExpired = isExpired(a);
      const bExpired = isExpired(b);
      if (aExpired !== bExpired) return aExpired ? 1 : -1;
      return a.key.localeCompare(b.key);
    });
  }, [entries]);

  const handleEdit = useCallback((entry: WorkspaceStateEntryGql) => {
    setEditorMode({ kind: "edit", entry });
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditorMode({ kind: "closed" });
  }, []);

  if (!serverId) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-base font-semibold text-rim-text">Workspace State</h2>
          <p className="mt-1 text-sm text-rim-text-muted">
            No workspace selected. Join or create a workspace first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-rim-text">Workspace State</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Key-value store for workspace configuration, feature flags, and runtime state. Keys are
          scoped to the workspace or to one user. Values are JSON with optional TTL.
        </p>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Scope toggle */}
        <div className="flex rounded-lg border border-rim-line bg-rim-void">
          <button
            type="button"
            onClick={() => setScope(WorkspaceStateScopeGql.SERVER)}
            className={`flex items-center gap-1.5 rounded-l-lg px-3 py-1.5 text-xs font-medium transition ${
              scope === WorkspaceStateScopeGql.SERVER
                ? "bg-rim-accent text-white"
                : "text-rim-text-muted hover:text-rim-text"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            {SCOPE_LABELS[WorkspaceStateScopeGql.SERVER]}
          </button>
          <button
            type="button"
            onClick={() => setScope(WorkspaceStateScopeGql.USER)}
            className={`flex items-center gap-1.5 rounded-r-lg px-3 py-1.5 text-xs font-medium transition ${
              scope === WorkspaceStateScopeGql.USER
                ? "bg-rim-accent text-white"
                : "text-rim-text-muted hover:text-rim-text"
            }`}
          >
            <User className="h-3.5 w-3.5" />
            {SCOPE_LABELS[WorkspaceStateScopeGql.USER]}
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-rim-text-faint" />
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="Filter by prefix..."
            className="w-full rounded-md border border-rim-line bg-rim-void py-1.5 pl-8 pr-3 text-sm text-rim-text placeholder:text-rim-text-faint focus:border-rim-accent focus:outline-none"
          />
        </div>

        {/* Create button */}
        <button
          type="button"
          onClick={() => setEditorMode({ kind: "create" })}
          className="flex items-center gap-1.5 rounded-md bg-rim-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rim-accent/80"
        >
          <Plus className="h-3.5 w-3.5" />
          New entry
        </button>
      </div>

      {/* Editor (inline) */}
      {editorMode.kind !== "closed" && (
        <EntryEditor
          serverId={serverId}
          scope={scope}
          existingEntry={editorMode.kind === "edit" ? editorMode.entry : undefined}
          onClose={handleCloseEditor}
        />
      )}

      {/* Entry list */}
      {isLoading && (
        <div className="flex items-center gap-2 py-8 text-sm text-rim-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading state entries...
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rim-danger/30 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Failed to load entries: {graphqlErrorMessage(error, "unknown error")}
        </div>
      )}

      {!isLoading && !error && sortedEntries.length === 0 && (
        <div className="rounded-lg border border-dashed border-rim-line py-12 text-center">
          <Database className="mx-auto h-8 w-8 text-rim-text-faint" />
          <p className="mt-2 text-sm text-rim-text-muted">
            {prefix
              ? `No entries matching "${prefix}" in ${SCOPE_LABELS[scope].toLowerCase()} scope.`
              : `No ${SCOPE_LABELS[scope].toLowerCase()}-scoped entries yet.`}
          </p>
          <button
            type="button"
            onClick={() => setEditorMode({ kind: "create" })}
            className="mt-3 text-xs font-medium text-rim-accent hover:underline"
          >
            Create the first entry
          </button>
        </div>
      )}

      {sortedEntries.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-rim-text-faint">
            {sortedEntries.length} {sortedEntries.length === 1 ? "entry" : "entries"}
            {deferredPrefix && ` matching "${deferredPrefix}"`}
            {sortedEntries.length >= DEFAULT_LIST_LIMIT && (
              <span className="ml-1 text-rim-warm">
                (limit reached — refine your prefix to see more)
              </span>
            )}
          </p>
          {sortedEntries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              onEdit={handleEdit}
              onDelete={handleDeleteEntry}
              isDeleting={deleteWorkspaceState.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
