import { detectPlatform } from "../../../../core/runtime/runtime";
import { Button } from "../../../../shared/ui/Button";
import { HoverTooltip } from "../../../../shared/ui/HoverTooltip";
import { formatRelativeTime } from "../../../../shared/utils/formatTime";
import type { AgentSession, AgentSessionStatus } from "../../acp/agentSession";
import { DESKTOP_ONLY_MESSAGE } from "../../acp/agentRunner";
import { showInvisibleCharacters } from "../../runtime/invisibleCharacters";
import { useAgentProgramsStore } from "../../state/useAgentProgramsStore";
import {
  isLiveStatus,
  reopenAgentSession,
  removeRecentAgentSession,
  useAgentSessionsStore,
  useRunningAgentSessionsStore,
  type RecentAgentSession,
} from "../../state/useAgentSessionsStore";
import { useStartAgentSessionStore } from "../../state/useStartAgentSessionStore";
import { SessionStatusChip } from "./sessionParts";
import { useStatuses } from "./useSessionStatuses";
import {
  ADD_PROGRAM_FIRST,
  folderName,
  openAgentSession,
  openAgentsSettings,
  UNTITLED_SESSION,
} from "./sessionText";

/** A page's top line, as the other main pages have it. */
export function PageBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rim-line px-4">
      {children}
    </div>
  );
}

/** The agent sessions page: the sessions running now and the recent ones. */
export function AgentSessionsPage() {
  if (detectPlatform() !== "desktop") {
    return (
      <div className="flex h-full flex-col">
        <PageBar>
          <h1 className="text-sm font-medium text-rim-text">Agent sessions</h1>
        </PageBar>
        <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6">
          <p className="text-sm text-rim-text-muted">{DESKTOP_ONLY_MESSAGE}.</p>
        </div>
      </div>
    );
  }
  return <SessionList />;
}

function SessionList() {
  const sessions = useRunningAgentSessionsStore((s) => s.sessions);
  const recent = useAgentSessionsStore((s) => s.recent);
  const hasPrograms = useAgentProgramsStore((s) => s.profiles.length > 0);
  const statuses = useStatuses(sessions);
  const showStart = useStartAgentSessionStore((s) => s.show);

  const running = Object.keys(sessions).filter((key) => {
    const status = statuses[key];
    return status !== undefined && (isLiveStatus(status) || status === "failed");
  });
  const runningKeys = new Set(running);
  const recentShown = recent.filter((entry) => !runningKeys.has(entry.key));
  const entryOf = (key: string) => recent.find((entry) => entry.key === key);
  const empty = running.length === 0 && recentShown.length === 0;

  return (
    <div className="flex h-full flex-col">
      <PageBar>
        <h1 className="text-sm font-medium text-rim-text">Agent sessions</h1>
      </PageBar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-5 sm:px-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <p className="min-w-0 flex-[1_1_16rem] text-sm text-rim-text-muted">
              Agents RIM started on this computer. RIM keeps no transcripts: they stay in memory
              while the app runs.
            </p>
            {!empty && hasPrograms && (
              <Button type="button" size="sm" variant="secondary" onClick={showStart}>
                Start a session
              </Button>
            )}
          </header>

          {empty && (
            <div className="space-y-3 rounded-xl border border-rim-line bg-rim-panel p-6 text-center">
              <p className="text-sm font-semibold text-rim-text">No agent sessions yet.</p>
              {hasPrograms ? (
                <Button type="button" size="sm" onClick={showStart}>
                  Start a session
                </Button>
              ) : (
                <>
                  <p className="text-xs text-rim-text-muted">{ADD_PROGRAM_FIRST}</p>
                  <Button type="button" size="sm" variant="secondary" onClick={openAgentsSettings}>
                    Open Settings &gt; Agents
                  </Button>
                </>
              )}
            </div>
          )}

          {running.length > 0 && (
            <section aria-labelledby="running-sessions" className="space-y-2">
              <h2
                id="running-sessions"
                className="text-xs font-medium uppercase tracking-wider text-rim-text-faint"
              >
                Running
              </h2>
              <ul className="space-y-2">
                {running.map((key) => (
                  <RunningRow
                    key={key}
                    sessionKey={key}
                    session={sessions[key]}
                    status={statuses[key]}
                    entry={entryOf(key)}
                  />
                ))}
              </ul>
            </section>
          )}

          {recentShown.length > 0 && (
            <section aria-labelledby="recent-sessions" className="space-y-2">
              <h2
                id="recent-sessions"
                className="text-xs font-medium uppercase tracking-wider text-rim-text-faint"
              >
                Recent
              </h2>
              <ul className="space-y-2">
                {recentShown.map((entry) => (
                  <RecentRow key={entry.key} entry={entry} inMemory={entry.key in sessions} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** A folder's name, with its full path on hover or focus. */
export function FolderName({ path }: { path: string }) {
  return (
    <HoverTooltip content={<span className="font-mono">{path}</span>}>
      <span
        tabIndex={0}
        aria-label={`Folder ${path}`}
        className="min-w-0 truncate rounded font-mono text-xs text-rim-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-rim-accent"
      >
        {folderName(path)}
      </span>
    </HoverTooltip>
  );
}

interface RowProps {
  name: string;
  title: string | null;
  cwd: string | null;
  lastActivityAt: string | null;
  status?: AgentSessionStatus;
  /** Whether it finished a turn or started waiting since the person last had its page open. */
  unseen: boolean;
  onOpen: () => void;
  openLabel: string;
  children?: React.ReactNode;
}

function Row({
  name,
  title,
  cwd,
  lastActivityAt,
  status,
  unseen,
  onOpen,
  openLabel,
  children,
}: RowProps) {
  const shownName = showInvisibleCharacters(name);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-rim-line bg-rim-panel px-4 py-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${openLabel} ${shownName}: ${title ?? UNTITLED_SESSION}${unseen ? ", new" : ""}`}
        className="min-w-0 flex-[1_1_14rem] rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rim-accent"
      >
        <span className="flex flex-wrap items-center gap-2">
          {unseen && (
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-rim-accent" />
          )}
          <span className="text-sm font-medium text-rim-text">{shownName}</span>
          {status && <SessionStatusChip status={status} />}
        </span>
        <span className="mt-0.5 block truncate text-sm text-rim-text-muted">
          {title ? showInvisibleCharacters(title) : UNTITLED_SESSION}
        </span>
      </button>
      <span className="flex min-w-0 items-center gap-3">
        {cwd && <FolderName path={cwd} />}
        {lastActivityAt && (
          <time dateTime={lastActivityAt} className="shrink-0 text-xs text-rim-text-faint">
            {formatRelativeTime(lastActivityAt)}
          </time>
        )}
        {children}
      </span>
    </li>
  );
}

function RunningRow({
  sessionKey,
  session,
  status,
  entry,
}: {
  sessionKey: string;
  session: AgentSession;
  status: AgentSessionStatus;
  entry: RecentAgentSession | undefined;
}) {
  const snapshot = session.getSnapshot();
  const unseen = useRunningAgentSessionsStore((s) => s.unseen[sessionKey] === true);
  return (
    <Row
      unseen={unseen}
      name={snapshot.name}
      title={entry?.title ?? null}
      cwd={snapshot.cwd}
      lastActivityAt={entry?.lastActivityAt ?? null}
      status={status}
      openLabel="Open"
      onOpen={() => openAgentSession(sessionKey)}
    />
  );
}

function RecentRow({ entry, inMemory }: { entry: RecentAgentSession; inMemory: boolean }) {
  const profileThere = useAgentProgramsStore((s) =>
    s.profiles.some((profile) => profile.id === entry.profileId),
  );
  const reopens = !inMemory && entry.canReopen && profileThere;
  const unseen = useRunningAgentSessionsStore((s) => s.unseen[entry.key] === true);
  return (
    <Row
      unseen={unseen}
      name={entry.agentName}
      title={entry.title}
      cwd={entry.cwd}
      lastActivityAt={entry.lastActivityAt}
      openLabel={reopens ? "Reopen" : "Open"}
      onOpen={() => {
        if (reopens) reopenAgentSession(entry.key);
        openAgentSession(entry.key);
      }}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Remove ${showInvisibleCharacters(entry.agentName)}: ${entry.title ?? UNTITLED_SESSION} from the list`}
        onClick={() => removeRecentAgentSession(entry.key)}
      >
        Remove
      </Button>
    </Row>
  );
}
