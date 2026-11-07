import { useEffect, useRef, useState } from "react";

import { getApiOrigin } from "../../../core/graphql/config";
import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { useShellStore } from "../../../shell/state/useShellStore";
import { agentAvailable } from "../../agent/agentAvailability";
import { AgentRunDialog } from "../../agents/components/AgentRunDialog";
import { groupRuns, type AgentRun } from "../../agents/runtime/runs";
import { useAgentRecordStore } from "../../agents/state/useAgentRecordStore";
import { useConnectedAgentsStore } from "../../agents/state/useConnectedAgentsStore";
import { EmptyWorkspaceState } from "../../workspaces/components/EmptyWorkspaceState";
import { useHomeLayout } from "../api/useHomeLayout";
import { useHomeMentions } from "../api/useHomeMentions";
import { useHomeUnread } from "../api/useHomeUnread";
import { useHomeWaiting } from "../api/useHomeWaiting";
import { useHomeWorkspaces } from "../api/useHomeWorkspaces";
import type { HomeBoxData } from "../boxes/registry";
import { useHomeEditStore } from "../state/useHomeEditStore";
import { useHomeHiddenStore } from "../state/useHomeLayoutStore";
import { HomeBoxGrid } from "./HomeBoxes";
import { HomeEditor } from "./HomeEditor";

const RUNS_SHOWN = 5;

/** The key of a run, which has no id when it was kept before runs existed. */
function runKey(run: AgentRun): string {
  return run.id ?? `${run.agentId}:${run.startedAt}`;
}

/** The host name of the server this app talks to, for saying which one cannot be reached. */
function homeHost(): string {
  try {
    return new URL(getApiOrigin()).host || "your server";
  } catch {
    return "your server";
  }
}

/**
 * Home: boxes across the account's workspaces, in the layout the person chose or today's default,
 * with what waits for them, their unread mentions and replies, their unread counts and, in the
 * desktop app, the runs of connected agents. A filter limits it to one workspace while the page
 * is open. Edit Home rearranges the boxes where the server keeps the layout.
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
  const runs = agentAvailable() ? groupRuns(entries).slice(0, RUNS_SHOWN) : [];
  const [openRun, setOpenRun] = useState<string | null>(null);
  const selectedRun = runs.find((run) => runKey(run) === openRun);

  const view = useHomeLayout(agentsShown);
  const hidden = useHomeHiddenStore((s) => s.hidden);
  const hide = useHomeHiddenStore((s) => s.hide);
  const draft = useHomeEditStore((s) => s.draft);
  const editRequested = useHomeEditStore((s) => s.requested);
  const startEditing = useHomeEditStore((s) => s.start);
  const editing = view.editable ? draft : null;

  // Leaving Home drops an edit that was not finished.
  useEffect(
    () =>
      useShellStore.subscribe((state, prev) => {
        if (prev.mainSurface.kind === "home" && state.mainSurface.kind !== "home") {
          useHomeEditStore.getState().stop();
        }
      }),
    [],
  );

  // Edit Home, asked for from the palette, opens the editor once the layout can be edited.
  useEffect(() => {
    if (editRequested && view.editable) startEditing(view.layout);
  }, [editRequested, view.editable, view.layout, startEditing]);

  if (!isPending && workspaces.length === 0) return <EmptyWorkspaceState />;

  if (editing) {
    return (
      <div ref={rootRef} className="h-full">
        <HomeEditor draft={editing} saved={view.layout} />
      </div>
    );
  }

  const data: HomeBoxData = {
    waiting,
    mentions,
    unread,
    runs,
    shownWorkspaces: shown.length,
    labelOf,
    onOpenRun: (run) => setOpenRun(runKey(run)),
    onAllRuns: () => useShellStore.getState().setMainSurface({ kind: "settings", tab: "agents" }),
  };

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rim-line px-4">
        <h1 className="text-sm font-medium text-rim-text">Home</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm text-rim-text-muted">
                {view.editable
                  ? "Your layout, on every device"
                  : "What needs you across your workspaces"}
              </p>
              {view.editable && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => startEditing(view.layout)}
                >
                  Edit Home
                </Button>
              )}
            </div>
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

          {view.unreachable && (
            <p
              role="status"
              className="rounded-lg border border-rim-warm/30 bg-rim-warm/10 px-3 py-2 text-sm text-rim-warm"
            >
              Can&apos;t reach {homeHost()}. Showing your saved layout and what was last loaded.
            </p>
          )}
          {view.changedElsewhere && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-rim-accent/30 bg-rim-accent/10 px-3 py-2 text-sm text-rim-accent"
            >
              <span className="min-w-0 flex-1">
                Your layout changed on another device, so Home now shows that one.
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={view.dismissChangedElsewhere}
              >
                OK
              </Button>
            </div>
          )}

          <HomeBoxGrid
            layout={view.layout}
            hidden={hidden}
            data={data}
            stale={view.unreachable}
            onHide={hide}
            onFixSettings={(id) => startEditing(view.layout, id)}
          />
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
