import { useEffect, useRef, useState } from "react";

import { cn } from "../../../shared/ui/cn";
import { NavMenuButton } from "../../../shell/components/NavMenuButton";
import { useShellStore } from "../../../shell/state/useShellStore";
import { agentAvailable } from "../../agent/agentAvailability";
import { AgentRunDialog } from "../../agents/components/AgentRunDialog";
import { groupRuns, type AgentRun } from "../../agents/runtime/runs";
import { useAgentRecordStore } from "../../agents/state/useAgentRecordStore";
import { useConnectedAgentsStore } from "../../agents/state/useConnectedAgentsStore";
import { EmptyWorkspaceState } from "../../workspaces/components/EmptyWorkspaceState";
import { useHomeMentions } from "../api/useHomeMentions";
import { useHomeUnread } from "../api/useHomeUnread";
import { useHomeWaiting } from "../api/useHomeWaiting";
import { useHomeWorkspaces } from "../api/useHomeWorkspaces";
import { AgentRunsSection, MentionsSection, UnreadSection, WaitingSection } from "./HomeSections";

const RUNS_SHOWN = 5;

/** The key of a run, which has no id when it was kept before runs existed. */
function runKey(run: AgentRun): string {
  return run.id ?? `${run.agentId}:${run.startedAt}`;
}

/**
 * Home: one page across the account's workspaces with what waits for the person, their unread
 * mentions and replies, their unread counts and, in the desktop app, the runs of connected
 * agents. A filter limits it to one workspace while the page is open.
 */
export function HomePage() {
  const { workspaces, isPending } = useHomeWorkspaces();
  const [filter, setFilter] = useState<string | null>(null);
  const only = workspaces.some((w) => w.id === filter) ? filter : null;
  const shown = only === null ? workspaces : workspaces.filter((w) => w.id === only);
  const rootRef = useRef<HTMLDivElement>(null);

  // Tab starts on the page, not wherever focus was before it opened.
  useEffect(() => {
    const panel = rootRef.current?.closest<HTMLElement>('[data-panel="mainSurface"]');
    if (panel && !panel.contains(document.activeElement)) panel.focus();
  }, []);

  const waiting = useHomeWaiting(workspaces, only);
  const mentions = useHomeMentions(only);
  const unread = useHomeUnread(shown);
  const labelOf = (id: string) => workspaces.find((w) => w.id === id)?.label ?? id;

  const connectedAgents = useConnectedAgentsStore((s) => s.agents.length);
  const agentsShown = agentAvailable() && connectedAgents > 0;
  const entries = useAgentRecordStore((s) => s.entries);
  const runs = agentsShown ? groupRuns(entries).slice(0, RUNS_SHOWN) : [];
  const [openRun, setOpenRun] = useState<string | null>(null);
  const selectedRun = runs.find((run) => runKey(run) === openRun);

  if (!isPending && workspaces.length === 0) return <EmptyWorkspaceState />;

  const nothing =
    !isPending &&
    waiting.length === 0 &&
    !mentions.isPending &&
    mentions.items.length === 0 &&
    mentions.failed.length === 0 &&
    unread.length === 0;

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rim-line px-4">
        <NavMenuButton />
        <h1 className="text-sm font-medium text-rim-text">Home</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-5">
          <header className="space-y-3">
            <p className="text-sm text-rim-text-muted">What needs you across your workspaces</p>
            {workspaces.length > 1 && (
              <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label="Workspace">
                <FilterButton pressed={only === null} onClick={() => setFilter(null)}>
                  All workspaces
                </FilterButton>
                {workspaces.map((workspace) => (
                  <FilterButton
                    key={workspace.id}
                    pressed={only === workspace.id}
                    onClick={() => setFilter(workspace.id)}
                  >
                    {workspace.label}
                  </FilterButton>
                ))}
              </div>
            )}
          </header>

          <WaitingSection rows={waiting} />
          <MentionsSection
            items={mentions.items}
            failed={mentions.failed}
            isPending={mentions.isPending}
            nameWorkspaces={shown.length > 1}
            labelOf={labelOf}
            hasOthers={shown.length > 1}
          />
          <UnreadSection rows={unread} />
          {nothing && <p className="text-sm text-rim-text-muted">Nothing needs you right now.</p>}
          {agentsShown && (
            <AgentRunsSection
              runs={runs}
              onOpenRun={(run) => setOpenRun(runKey(run))}
              onAllRuns={() =>
                useShellStore.getState().setMainSurface({ kind: "settings", tab: "agents" })
              }
            />
          )}
        </div>
      </div>
      {selectedRun && (
        <AgentRunDialog
          run={selectedRun}
          onBack={() => setOpenRun(null)}
          onClose={() => setOpenRun(null)}
        />
      )}
    </div>
  );
}

function FilterButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "max-w-full truncate rounded px-2 py-0.5 transition",
        pressed ? "bg-rim-accent/15 text-rim-accent" : "text-rim-text-muted hover:text-rim-text",
      )}
    >
      {children}
    </button>
  );
}
