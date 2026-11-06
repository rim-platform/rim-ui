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
import { useAgentRecordStore } from "../state/useAgentRecordStore";
import { useConnectedAgentsStore, type ConnectedAgent } from "../state/useConnectedAgentsStore";
import { usePendingPairingStore } from "../state/usePendingPairingStore";
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
  const hasRecord = useAgentRecordStore((s) => s.entries.length > 0);
  const saving = useRef(false);

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
    <div className="space-y-6">
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
        <div className="space-y-2">
          {status && !status.enabled && (
            <p className="text-sm text-rim-text-muted">
              These stay connected, but cannot reach RIM while this is off.
            </p>
          )}
          <ul className="divide-y divide-rim-line rounded-lg border border-rim-line bg-rim-panel px-4">
            {agents.map((agent) => (
              <li key={agent.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="break-words text-sm font-medium text-rim-text">{agent.name}</div>
                  <div className="text-xs text-rim-text-muted">
                    Connected {new Date(agent.pairedAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Choose what ${agent.name} can read`}
                    onClick={() => setChoosing(agent)}
                  >
                    Choose what it can read
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Choose the plugin commands of ${agent.name}`}
                    onClick={() => setChoosingPlugins(agent)}
                  >
                    Choose its plugin commands
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`What ${agent.name} was given`}
                    onClick={() => setViewing(agent)}
                  >
                    What it was given
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Runs of ${agent.name}`}
                    onClick={() => setRunsOf(agent)}
                  >
                    Its runs
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Disconnect ${agent.name}`}
                    onClick={() => setDisconnecting(agent)}
                  >
                    Disconnect
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
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

      {disconnecting && (
        <ConfirmActionDialog
          title={`Disconnect ${disconnecting.name}?`}
          description="It will not be able to reach RIM any more. It keeps nothing RIM can take back: what it has already read stays with it."
          confirmLabel="Disconnect"
          danger
          onConfirm={() => {
            revoke(disconnecting.id);
            setDisconnecting(null);
          }}
          onClose={() => setDisconnecting(null)}
        />
      )}
    </div>
  );
}
