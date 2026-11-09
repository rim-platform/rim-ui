import { useEffect, useRef, useState } from "react";

import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { rejectOutsideAgentConfirmation } from "../../agent/state/confirmationModalStore";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import {
  agentBridgeSetEnabled,
  agentBridgeStatus,
  type AgentBridgeStatus,
} from "../api/agentBridge";
import { agentAvailable } from "../../agent/agentAvailability";
import { useShellStore } from "../../../shell/state/useShellStore";
import { cn } from "../../../shared/ui/cn";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import { plural } from "../runtime/runs";
import { useAgentRecordStore } from "../state/useAgentRecordStore";
import { useAgentsSettingsRequestStore } from "../state/useAgentsSettingsRequestStore";
import { useConnectedAgentsStore, type ConnectedAgent } from "../state/useConnectedAgentsStore";
import { usePendingPairingStore } from "../state/usePendingPairingStore";
import { AgentDetail, grantSummary, runCount } from "./AgentDetail";
import { AgentGrantsDialog } from "./AgentGrantsDialog";
import { AgentPluginsDialog } from "./AgentPluginsDialog";
import { AgentRecordDialog } from "./AgentRecordDialog";
import { AgentRunsDialog } from "./AgentRunsDialog";

const SWITCH_LABEL = "Let agents on this computer connect";

/** The Agents tab of the settings: whether agents may connect, and the ones that are. */
export function AgentsSettings() {
  const agents = useConnectedAgentsStore((s) => s.agents);
  const revoke = useConnectedAgentsStore((s) => s.revoke);
  const [status, setStatus] = useState<AgentBridgeStatus | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [disconnecting, setDisconnecting] = useState<ConnectedAgent | null>(null);
  const [choosing, setChoosing] = useState<ConnectedAgent | null>(null);
  const [choosingPlugins, setChoosingPlugins] = useState<ConnectedAgent | null>(null);
  const [viewing, setViewing] = useState<ConnectedAgent | null>(null);
  const [viewingAll, setViewingAll] = useState(false);
  const [runsOf, setRunsOf] = useState<ConnectedAgent | null>(null);
  const [allRuns, setAllRuns] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const entries = useAgentRecordStore((s) => s.entries);
  const hasRecord = entries.length > 0;
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    agents.find((agent) => agent.id === selectedId) ?? (agents.length === 1 ? agents[0] : null);
  const saving = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    agentBridgeStatus()
      .then((current) => {
        if (live) setStatus(current);
      })
      .catch(() => {
        logger.warn("[RIM:agents] could not read the bridge's status");
        if (live) setReadFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Opens what a command asked for: one agent's dialog, the whole record or every run.
  useEffect(() => {
    const take = () => {
      const request = useAgentsSettingsRequestStore.getState().take();
      if (!request) return;
      if (request.kind === "allRuns") return setAllRuns(true);
      if (request.kind === "record") return setViewingAll(true);
      if (request.kind === "clearRecord") return setClearingAll(true);
      const agent = useConnectedAgentsStore
        .getState()
        .agents.find((candidate) => candidate.id === request.agentId);
      if (!agent) {
        toast.info("That agent is no longer connected");
        return;
      }
      setSelectedId(agent.id);
      if (request.kind === "disconnect") setDisconnecting(agent);
      else if (request.kind === "chooseReads") setChoosing(agent);
      else setChoosingPlugins(agent);
    };
    take();
    return useAgentsSettingsRequestStore.subscribe(take);
  }, []);

  const change = (enabled: boolean) => {
    if (status === null || saving.current) return;
    setStatus({ ...status, enabled, listening: enabled, error: null });
    saving.current = true;
    agentBridgeSetEnabled(enabled)
      .then((current) => {
        setStatus(current);
        if (!enabled) {
          usePendingPairingStore.getState().reset();
          rejectOutsideAgentConfirmation();
        }
      })
      .catch(() => {
        logger.warn("[RIM:agents] could not save whether agents may connect");
        setStatus(status);
        toast.error("The setting could not be saved");
      })
      .finally(() => {
        saving.current = false;
      });
  };

  return (
    <div ref={rootRef} className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">Agents on this computer</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Optional. RIM works the same without them.
        </p>
      </div>

      <div className="rounded-lg border border-rim-line bg-rim-panel px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 flex-1 basis-48">
            <div className="text-sm font-medium text-rim-text">{SWITCH_LABEL}</div>
            <div className="text-xs text-rim-text-muted">
              An agent runs on your computer with its own model provider. What it reads goes to that
              provider, and RIM can&apos;t see or limit where it goes after that. Nothing can read
              your conversations until you connect it and choose what it may read.
            </div>
          </div>
          <ToggleSwitch
            checked={status?.enabled ?? false}
            onChange={change}
            label={SWITCH_LABEL}
            disabled={status === null}
          />
        </div>
        {status?.enabled && !status.listening && (
          <p role="alert" className="mt-2 text-xs text-rim-danger">
            RIM could not start listening: {status.error}. Close whatever else is using port{" "}
            {status.port}, then turn this off and on again.
          </p>
        )}
        {readFailed && (
          <p className="mt-2 text-xs text-rim-text-muted">
            RIM can&apos;t check this setting on this computer.
          </p>
        )}
      </div>

      {agents.length === 0 ? (
        <p className="text-sm text-rim-text-muted">Nothing is connected.</p>
      ) : (
        <div className="space-y-3">
          {status && !status.enabled && (
            <p className="text-sm text-rim-text-muted">
              These stay connected, but cannot reach RIM while this is off.
            </p>
          )}
          <ul className="space-y-2">
            {agents.map((agent) => {
              const name = showInvisibleCharacters(agent.name);
              const runs = runCount(entries, agent.id);
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    aria-pressed={selected?.id === agent.id}
                    onClick={() => setSelectedId(agent.id)}
                    className={cn(
                      "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                      selected?.id === agent.id
                        ? "border-rim-accent/40 bg-rim-panel-soft"
                        : "border-rim-line bg-rim-panel hover:bg-rim-panel-soft",
                    )}
                  >
                    <span className="block break-words text-sm font-medium text-rim-text">
                      {name}
                    </span>
                    <span className="block text-xs text-rim-text-muted">
                      Connected {new Date(agent.pairedAt).toLocaleString()} · {grantSummary(agent)}
                      {runs > 0 && ` · ${plural(runs, "run", "runs")}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {agentAvailable() && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-rim-text-muted">
            The agent built into this app has its own tab.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setMainSurface({ kind: "settings", tab: "agent" })}
          >
            Open AI Agent
          </Button>
        </div>
      )}

      {selected && (
        <AgentDetail
          agent={selected}
          onDisconnect={() => setDisconnecting(selected)}
          onChoose={() => setChoosing(selected)}
          onChoosePlugins={() => setChoosingPlugins(selected)}
          onViewRecord={() => setViewing(selected)}
          onViewRuns={() => setRunsOf(selected)}
        />
      )}

      {hasRecord && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setViewingAll(true)}>
            What agents were given
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAllRuns(true)}>
            All runs
          </Button>
        </div>
      )}

      {choosing && <AgentGrantsDialog agent={choosing} onClose={() => setChoosing(null)} />}
      {choosingPlugins && (
        <AgentPluginsDialog agent={choosingPlugins} onClose={() => setChoosingPlugins(null)} />
      )}
      {viewing && <AgentRecordDialog agent={viewing} onClose={() => setViewing(null)} />}
      {viewingAll && <AgentRecordDialog agent={null} onClose={() => setViewingAll(false)} />}
      {runsOf && <AgentRunsDialog agent={runsOf} onClose={() => setRunsOf(null)} />}
      {allRuns && <AgentRunsDialog agent={null} onClose={() => setAllRuns(false)} />}
      {clearingAll && (
        <AgentRecordDialog agent={null} startWithClear onClose={() => setClearingAll(false)} />
      )}

      {disconnecting && (
        <ConfirmActionDialog
          title={`Disconnect ${showInvisibleCharacters(disconnecting.name)}?`}
          description="It will not be able to reach RIM any more. It keeps nothing RIM can take back: what it has already read stays with it."
          confirmLabel="Disconnect"
          danger
          onConfirm={() => {
            revoke(disconnecting.id);
            setDisconnecting(null);
            // The detail that opened the dialog goes with the agent: focus moves to the next
            // agent in the list, or to the switch above it.
            setTimeout(() => {
              rootRef.current
                ?.querySelector<HTMLElement>('button[aria-pressed], [role="switch"]')
                ?.focus();
            });
          }}
          onClose={() => setDisconnecting(null)}
        />
      )}
    </div>
  );
}
