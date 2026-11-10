import { cn } from "../../../../shared/ui/cn";
import { formatRelativeTime } from "../../../../shared/utils/formatTime";
import { useShellStore } from "../../../../shell/state/useShellStore";
import { showInvisibleCharacters } from "../../runtime/invisibleCharacters";
import { useStartAgentSessionStore } from "../../state/useStartAgentSessionStore";
import { SessionStatusChip } from "./sessionParts";
import { openAgentSession, UNTITLED_SESSION } from "./sessionText";
import type { AgentSessionRow } from "./useAgentSessionRows";

const ROW_CLASS =
  "block w-full rounded-lg border border-rim-line bg-rim-panel px-3 py-2.5 text-left text-sm text-rim-text transition hover:bg-rim-panel-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent";
const LINK_CLASS =
  "rounded px-1.5 py-0.5 text-xs text-rim-accent hover:bg-rim-panel-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent";

/** A link-like button under the list. */
function ListAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={LINK_CLASS}>
      {label}
    </button>
  );
}

/** One session: its agent, its status or when it was last active, and its title. */
function SessionRowButton({ row, onOpen }: { row: AgentSessionRow; onOpen: () => void }) {
  const title = row.title ? showInvisibleCharacters(row.title) : UNTITLED_SESSION;
  const name = showInvisibleCharacters(row.agentName);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${name}: ${title}${row.unseen ? ", new" : ""}`}
      className={ROW_CLASS}
    >
      <span className="flex min-w-0 items-center gap-2">
        {row.unseen && (
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-rim-accent" />
        )}
        <span className={cn("min-w-0 truncate", row.unseen && "font-semibold")}>{name}</span>
        {row.status !== null ? (
          <SessionStatusChip status={row.status} />
        ) : (
          row.lastActivityAt && (
            <time dateTime={row.lastActivityAt} className="shrink-0 text-xs text-rim-text-faint">
              {formatRelativeTime(row.lastActivityAt)}
            </time>
          )
        )}
      </span>
      <span className="block truncate text-xs text-rim-text-muted">{title}</span>
    </button>
  );
}

/**
 * A short list of agent sessions, as Home's box and the top bar's menu show it: the running
 * sessions, then the recent ones, each opening its page, the ones that finished or wait since the
 * person last looked marked, then New session and All sessions. With no session it says so and
 * offers New session.
 *
 * @param rows - The sessions, in order.
 * @param onDone - Runs after any of its buttons did what it does, such as closing a menu.
 */
export function AgentSessionList({
  rows,
  onDone,
}: {
  rows: readonly AgentSessionRow[];
  onDone?: () => void;
}) {
  const then = (action: () => void) => () => {
    action();
    onDone?.();
  };
  const newSession = (
    <ListAction
      label="New session"
      onClick={then(() => useStartAgentSessionStore.getState().show())}
    />
  );
  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-rim-text-muted">No agent sessions yet.</p>
        {newSession}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.key}>
            <SessionRowButton row={row} onOpen={then(() => openAgentSession(row.key))} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1">
        {newSession}
        <ListAction
          label="All sessions"
          onClick={then(() => useShellStore.getState().setMainSurface({ kind: "agent-sessions" }))}
        />
      </div>
    </div>
  );
}
