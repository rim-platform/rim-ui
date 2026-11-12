import { useId, useRef, useState, type KeyboardEvent } from "react";

import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { copyToClipboard } from "../../../shared/ui/contextMenu/menuActions";
import { Dialog } from "../../../shared/ui/Dialog";
import { ToggleSwitch } from "../../settings/components/ToggleSwitch";
import type { AgentBridgeStatus } from "../api/agentBridge";
import { TOOL_SETUPS } from "../runtime/connectSnippets";
import { showInvisibleCharacters } from "../runtime/invisibleCharacters";
import { mintAgent, NAME_RULE, type MintedAgent } from "../runtime/pairing";
import { useConnectedAgentsStore } from "../state/useConnectedAgentsStore";

/** The label of the switch that lets agents connect, as Settings > Agents names it. */
export const BRIDGE_SWITCH_LABEL = "Let agents on this computer connect";

/** What the once-only screen says about keeping the token. */
export const TOKEN_WARNING =
  "The token is saved in that tool's settings file. Any program running as you can read it. RIM won't show it again. If you lose it, disconnect this agent and connect again.";

/** What the token reads as until the person shows it. */
const HIDDEN_TOKEN = "•".repeat(24);

/** A value in a box, with a Copy button that copies `copy`. */
function CopyBox({
  label,
  copyLabel,
  shown,
  copy,
  multiline = false,
  extra,
}: {
  label: string;
  /** The Copy button's accessible name. */
  copyLabel: string;
  shown: string;
  copy: string;
  multiline?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <pre
        aria-label={label}
        className={cn(
          "min-w-0 flex-1 overflow-x-auto rounded-lg border border-rim-line bg-rim-void px-3 py-2 font-mono text-xs text-rim-text",
          multiline ? "whitespace-pre" : "whitespace-pre-wrap break-all",
        )}
      >
        {shown}
      </pre>
      <div className="flex shrink-0 flex-col gap-1">
        {extra}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={copyLabel}
          onClick={() => copyToClipboard(copy)}
        >
          Copy
        </Button>
      </div>
    </div>
  );
}

/** The address, the token behind Show, and each tool's setup, shown once. */
function ConnectedStep({
  minted,
  address,
  onDone,
}: {
  minted: MintedAgent;
  address: string;
  onDone: () => void;
}) {
  const [showToken, setShowToken] = useState(false);
  const [tab, setTab] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const { token, agent } = minted;
  const shownToken = showToken ? token : HIDDEN_TOKEN;
  const setup = TOOL_SETUPS[tab];

  const moveTab = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = TOOL_SETUPS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? tab === last
          ? 0
          : tab + 1
        : event.key === "ArrowLeft"
          ? tab === 0
            ? last
            : tab - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setTab(next);
    tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div className="space-y-4">
      <p className="break-words text-sm text-rim-text">
        “{showInvisibleCharacters(agent.name)}” is connected. It can read nothing until you choose
        what. Set it up in its tool with the address and token below.
      </p>

      <div className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wider text-rim-text-faint">
          Address
        </div>
        <CopyBox label="Address" copyLabel="Copy address" shown={address} copy={address} />
      </div>

      <div className="space-y-1">
        <div className="text-xs font-medium uppercase tracking-wider text-rim-text-faint">
          Token
        </div>
        <CopyBox
          label="Token"
          copyLabel="Copy token"
          shown={shownToken}
          copy={token}
          extra={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              autoFocus
              aria-pressed={showToken}
              onClick={() => setShowToken((shown) => !shown)}
            >
              {showToken ? "Hide" : "Show"}
            </Button>
          }
        />
      </div>

      <div>
        <div
          ref={tabsRef}
          role="tablist"
          aria-label="Setup for your tool"
          onKeyDown={moveTab}
          className="flex flex-wrap gap-1 border-b border-rim-line"
        >
          {TOOL_SETUPS.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${candidate.id}`}
              aria-selected={index === tab}
              aria-controls={`${baseId}-panel`}
              tabIndex={index === tab ? 0 : -1}
              onClick={() => setTab(index)}
              className={cn(
                "-mb-px rounded-t-md border-b-2 px-2.5 py-1.5 text-xs transition-colors",
                index === tab
                  ? "border-rim-accent text-rim-text"
                  : "border-transparent text-rim-text-muted hover:text-rim-text",
              )}
            >
              {candidate.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${setup.id}`}
          className="space-y-2 pt-3"
        >
          <p className="text-xs text-rim-text-muted">{setup.where}</p>
          <CopyBox
            label={`${setup.label} setup`}
            copyLabel={`Copy ${setup.label} setup`}
            shown={setup.snippet(address, shownToken)}
            copy={setup.snippet(address, token)}
            multiline
          />
        </div>
      </div>

      <p
        role="note"
        className="rounded-lg border border-rim-warm/30 bg-rim-warm/10 px-3 py-2 text-sm text-rim-text"
      >
        {TOKEN_WARNING}
      </p>
      <p className="text-xs text-rim-text-muted">
        Connection fails? The tool must use streamable HTTP. RIM doesn&apos;t serve the older SSE
        transport.
      </p>

      <div className="flex justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * Connects an agent from the app: the person names it, RIM adds it with nothing granted, and the
 * address, the token and each tool's setup show once. Closing it forgets the token.
 *
 * @param status - The bridge's status, `null` while it is not known.
 * @param onTurnOn - Turns on letting agents connect, as the Settings > Agents switch does.
 * @param onClose - Closes the dialog.
 */
export function ConnectAgentDialog({
  status,
  onTurnOn,
  onClose,
}: {
  status: AgentBridgeStatus | null;
  onTurnOn: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [nameRefused, setNameRefused] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [minted, setMinted] = useState<MintedAgent | null>(null);
  const [address, setAddress] = useState("");
  const errorId = useId();
  const bridgeOn = status?.enabled === true;

  const connect = async () => {
    if (!status || !bridgeOn || connecting) return;
    setConnecting(true);
    try {
      const made = await mintAgent(name);
      if (made === null) {
        setNameRefused(true);
        return;
      }
      useConnectedAgentsStore.getState().add(made.agent);
      setAddress(`http://127.0.0.1:${status.port}/mcp`);
      setMinted(made);
    } catch {
      logger.warn("[RIM:agents] could not connect an agent from the app");
      toast.error("RIM could not connect this agent");
    } finally {
      setConnecting(false);
    }
  };

  const done = () => {
    setMinted(null);
    onClose();
  };

  return (
    <Dialog
      open
      persistent={minted !== null}
      title={minted ? "Set up the agent" : "Connect an agent"}
      maxWidth={minted ? "max-w-xl" : "max-w-md"}
      onClose={minted ? done : onClose}
    >
      {minted ? (
        <ConnectedStep minted={minted} address={address} onDone={done} />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <p className="text-sm text-rim-text-muted">
            For a program on this computer that speaks the Model Context Protocol, such as Codex,
            opencode or Cursor. RIM shows its token and setup once.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-rim-text-faint">
              Name
            </span>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameRefused(false);
              }}
              placeholder="Codex on laptop"
              aria-invalid={nameRefused}
              aria-describedby={nameRefused ? errorId : undefined}
              className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2.5 text-sm text-rim-text outline-none transition placeholder:text-rim-text-faint focus:border-rim-accent/40"
            />
            <span className="mt-1 block text-xs text-rim-text-muted">
              What you&apos;ll call it in RIM.
            </span>
          </label>
          {nameRefused && (
            <p id={errorId} role="alert" className="text-sm text-rim-danger">
              {NAME_RULE}
            </p>
          )}

          {status === null ? (
            <p className="text-sm text-rim-text-muted">
              RIM can&apos;t tell whether agents may connect on this computer.
            </p>
          ) : (
            !bridgeOn && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-rim-line bg-rim-panel px-3 py-2">
                <p className="text-sm text-rim-text">
                  Agents can&apos;t connect while <strong>{BRIDGE_SWITCH_LABEL}</strong> is off.
                  Turn it on to connect one.
                </p>
                <ToggleSwitch checked={false} onChange={onTurnOn} label={BRIDGE_SWITCH_LABEL} />
              </div>
            )
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!bridgeOn || connecting}>
              Connect
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
