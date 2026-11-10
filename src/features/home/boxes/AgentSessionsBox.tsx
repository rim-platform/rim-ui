import { cn } from "../../../shared/ui/cn";
import { formatRelativeTime } from "../../../shared/utils/formatTime";
import { useShellStore } from "../../../shell/state/useShellStore";
import { SessionStatusChip } from "../../agents/components/sessions/sessionParts";
import { openAgentSession, UNTITLED_SESSION } from "../../agents/components/sessions/sessionText";
import type { AgentSessionRow } from "../../agents/components/sessions/useAgentSessionRows";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useStartAgentSessionStore } from "../../agents/state/useStartAgentSessionStore";

/** The most sessions the box lists. */
export const AGENT_SESSIONS_SHOWN = 6;

const ROW_CLASS =
  "block w-full rounded-lg border border-rim-line bg-rim-panel px-3 py-2.5 text-left text-sm text-rim-text transition hover:bg-rim-panel-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent";
const LINK_CLASS =
  "rounded px-1.5 py-0.5 text-xs text-rim-accent hover:bg-rim-panel-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent";

function NewSession() {
  return (
    <button
      type="button"
      onClick={() => useStartAgentSessionStore.getState().show()}
      className={LINK_CLASS}
    >
      New session
    </button>
  );
}

/**
 * The agent sessions box of Home: the running sessions, then the recent ones, each opening its
 * page, with the ones that finished or wait since the person last looked marked.
 */
export function AgentSessionsBoxBody({ rows }: { rows: readonly AgentSessionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-rim-text-muted">No agent sessions yet.</p>
        <NewSession />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row) => {
          const title = row.title ? showInvisibleCharacters(row.title) : UNTITLED_SESSION;
          const name = showInvisibleCharacters(row.agentName);
          return (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => openAgentSession(row.key)}
                aria-label={`Open ${name}: ${title}${row.unseen ? ", new" : ""}`}
                className={ROW_CLASS}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {row.unseen && (
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full bg-rim-accent"
                    />
                  )}
                  <span className={cn("min-w-0 truncate", row.unseen && "font-semibold")}>
                    {name}
                  </span>
                  {row.status !== null ? (
                    <SessionStatusChip status={row.status} />
                  ) : (
                    row.lastActivityAt && (
                      <time
                        dateTime={row.lastActivityAt}
                        className="shrink-0 text-xs text-rim-text-faint"
                      >
                        {formatRelativeTime(row.lastActivityAt)}
                      </time>
                    )
                  )}
                </span>
                <span className="block truncate text-xs text-rim-text-muted">{title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-1">
        <NewSession />
        <button
          type="button"
          onClick={() => useShellStore.getState().setMainSurface({ kind: "agent-sessions" })}
          className={LINK_CLASS}
        >
          All sessions
        </button>
      </div>
    </div>
  );
}
