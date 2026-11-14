import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { useState } from "react";
import { Shield } from "lucide-react";

import { toast } from "../../../shared/toast";
import { Dialog } from "../../../shared/ui/Dialog";
import { Button } from "../../../shared/ui/Button";
import { usePluginEnable } from "../api/usePluginActions";
import {
  useApproveCapabilities,
  useGrantCommands,
  useRevokeCapability,
} from "../api/usePluginCapabilities";
import {
  parsePluginCapabilities,
  runtimeKind,
  type PluginInfo,
  type PluginCapability,
} from "../types";
import {
  CAPABILITY_LABELS,
  capabilityLabel,
  CHAT_CONSENT_TEXT,
  KIND_CONSENT_TEXT,
  isChatCapability,
  networkFetchText,
  plainCapabilityOf,
} from "./consentText";
import { runsCommandNote, useRunsCommandRows, type RunsCommandRow } from "./runsCommands";

const capabilityDescriptions: Record<PluginCapability, string> = {
  "chat.read": CHAT_CONSENT_TEXT["chat.read"],
  "chat.write": CHAT_CONSENT_TEXT["chat.write"],
  "chat.read.encrypted": CHAT_CONSENT_TEXT["chat.read.encrypted"],
  "chat.write.encrypted": CHAT_CONSENT_TEXT["chat.write.encrypted"],
  "ui.notify": "Show desktop notifications",
  "ui.panel": "Render custom UI panels inside the workspace",
  "network.fetch": "Send and receive data from the sites the plugin lists",
};

const ENCRYPTED_CHAT_CAPABILITIES: readonly PluginCapability[] = [
  "chat.read.encrypted",
  "chat.write.encrypted",
];

/** How much of a plugin's description the permission prompt shows. */
const MAX_DESCRIPTION_LENGTH = 600;

function clipDescription(text: string): string {
  return text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH)}…` : text;
}

interface PluginCapabilityPromptProps {
  open: boolean;
  onClose: () => void;
  plugin: PluginInfo;
  /** Set right after an install or from the plugin's switch: approving also turns it on. */
  startOnApprove?: boolean;
}

export function PluginCapabilityPrompt({
  open,
  onClose,
  plugin,
  startOnApprove = false,
}: PluginCapabilityPromptProps) {
  const parsedCapabilities = parsePluginCapabilities(plugin.capabilities);
  // The encrypted chat pair starts unticked unless it was approved before: they are the most
  // sensitive grants, which a person turns on deliberately.
  const [selected, setSelected] = useState<Set<PluginCapability>>(
    () =>
      new Set(
        parsedCapabilities.filter(
          (cap) =>
            !ENCRYPTED_CHAT_CAPABILITIES.includes(cap) ||
            plugin.approved_capabilities.includes(cap),
        ),
      ),
  );
  const approve = useApproveCapabilities();
  const revoke = useRevokeCapability();
  const grantCommands = useGrantCommands();
  const enable = usePluginEnable();
  const commandRows = useRunsCommandRows(plugin.runs_commands ?? []);
  const alreadyGranted = new Set(plugin.granted_commands ?? []);
  // Nothing is checked for the person: each command is granted only by its own tick.
  const [commandsSelected, setCommandsSelected] = useState<Set<string>>(() => new Set());
  const [grantError, setGrantError] = useState<string | null>(null);

  function toggleCommand(id: string) {
    setCommandsSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [startError, setStartError] = useState<string | null>(null);
  const start = startOnApprove && !plugin.enabled;

  // An encrypted chat capability needs its plain one: checking it checks the plain one,
  // and unchecking the plain one unchecks it.
  function toggleCapability(cap: PluginCapability) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) {
        next.delete(cap);
        for (const other of parsedCapabilities) {
          if (plainCapabilityOf(other) === cap) next.delete(other);
        }
      } else {
        next.add(cap);
        const plain = plainCapabilityOf(cap);
        if (plain && parsedCapabilities.includes(plain as PluginCapability)) {
          next.add(plain as PluginCapability);
        }
      }
      return next;
    });
  }

  /**
   * Closes the prompt, or turns the plugin on first when it was opened to start it or when
   * taking a permission back stopped it.
   */
  function finish(restart = false) {
    if (!start && !restart) {
      onClose();
      return;
    }
    enable.mutate(plugin.plugin_id, {
      onSuccess: () => {
        if ((plugin.panels ?? []).length > 0) {
          toast.success(`${plugin.display_name} is on. Open it from Plugins in the top bar.`);
        }
        onClose();
      },
      onError: (err) =>
        setStartError(
          `The permissions are saved, but the plugin did not start: ${err.message}. Turn it on in Settings > Plugins.`,
        ),
    });
  }

  function handleApprove() {
    setStartError(null);
    setGrantError(null);
    const newCommands = commandRows
      .filter((row) => commandsSelected.has(row.id) && !alreadyGranted.has(row.id))
      .map((row) => row.id);
    // An approved permission the person unticked is taken back before the rest is granted.
    const revoked = plugin.approved_capabilities.filter(
      (cap) =>
        parsedCapabilities.includes(cap as PluginCapability) &&
        !selected.has(cap as PluginCapability),
    );
    if (revoked.length === 0) {
      grantSelected(newCommands, false);
      return;
    }
    void takeBack(revoked).then((failure) => {
      if (failure !== null) {
        setGrantError(`A permission could not be taken back: ${failure}`);
        return;
      }
      grantSelected(newCommands, revoked.length > 0 && plugin.enabled);
    });
  }

  /** Revokes each of `capabilities` in turn; resolves with the first failure's message, if any. */
  async function takeBack(capabilities: string[]): Promise<string | null> {
    try {
      for (const capability of capabilities) {
        await revoke.mutateAsync({ pluginId: plugin.plugin_id, capability });
      }
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  function grantSelected(newCommands: string[], restart: boolean) {
    approve.mutate(
      { pluginId: plugin.plugin_id, capabilities: Array.from(selected) },
      {
        onSuccess: () => {
          if (newCommands.length === 0) {
            finish(restart);
            return;
          }
          grantCommands.mutate(
            { pluginId: plugin.plugin_id, commandIds: newCommands },
            {
              onSuccess: () => finish(restart),
              onError: (err) =>
                setGrantError(
                  `The permissions are saved, but the commands were not granted: ${err.message}`,
                ),
            },
          );
        },
      },
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="Plugin Permissions" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rim-accent/15">
            <Shield className="h-5 w-5 text-rim-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-rim-text">
              {showInvisibleCharacters(plugin.display_name || plugin.plugin_id)}
            </span>
            <p className="text-xs text-rim-text-muted">
              v{plugin.version}
              {plugin.author ? ` by ${plugin.author}` : ""}
            </p>
          </div>
        </div>

        <div
          role="region"
          aria-label="What the plugin asks for"
          tabIndex={0}
          className="max-h-[calc(100dvh-16rem)] space-y-4 overflow-y-auto pr-2"
        >
          {/* The plugin's own account of what it does, e.g. where its data goes. It is
            the author's claim, so it is labelled and set apart from the app's words. */}
          {plugin.description && (
            <figure className="space-y-1">
              <figcaption className="text-[11px] text-rim-text-faint">
                From the plugin author:
              </figcaption>
              <blockquote className="whitespace-pre-line border-l-2 border-rim-line pl-3 text-xs text-rim-text-muted">
                {showInvisibleCharacters(clipDescription(plugin.description))}
              </blockquote>
            </figure>
          )}

          <p className="rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-xs text-rim-text">
            {KIND_CONSENT_TEXT[runtimeKind(plugin)]}
          </p>

          <p className="text-xs text-rim-text-muted">
            {parsedCapabilities.length > 0
              ? "This plugin requests the following permissions. Uncheck any you want to deny."
              : "This plugin asks for no permissions."}
          </p>

          <div className="space-y-1">
            {parsedCapabilities.map((cap) => (
              <label
                key={cap}
                className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={selected.has(cap)}
                  onChange={() => toggleCapability(cap)}
                  className="mt-0.5 accent-rim-accent"
                />
                {isChatCapability(cap) ? (
                  <ChatConsentLine text={CHAT_CONSENT_TEXT[cap]} />
                ) : cap === "network.fetch" ? (
                  <p className="text-sm text-rim-text">
                    <span className="font-medium">{CAPABILITY_LABELS[cap]}:</span>{" "}
                    <span className="text-rim-text-muted">
                      {networkFetchText(plugin.network_origins ?? [])}
                    </span>
                  </p>
                ) : (
                  <div>
                    <p className="text-sm text-rim-text">{capabilityLabel(cap)}</p>
                    <p className="text-xs text-rim-text-muted">
                      {capabilityDescriptions[cap] ?? ""}
                    </p>
                  </div>
                )}
              </label>
            ))}
          </div>

          {commandRows.length > 0 && (
            <RunsCommandsSection
              rows={commandRows}
              granted={alreadyGranted}
              selected={commandsSelected}
              onToggle={toggleCommand}
            />
          )}
        </div>

        {grantError && (
          <p className="text-xs text-rim-danger" role="alert">
            {grantError}
          </p>
        )}

        {start && (
          <p className="text-xs text-rim-text-muted">
            The plugin starts once you approve. Cancel leaves it installed and turned off.
          </p>
        )}
        {startError && (
          <p className="text-xs text-rim-danger" role="alert">
            {startError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {startError || grantError ? "Close" : "Cancel"}
          </Button>
          {!startError && !grantError && (
            <Button
              size="sm"
              isLoading={
                approve.isPending || revoke.isPending || grantCommands.isPending || enable.isPending
              }
              onClick={handleApprove}
            >
              {start ? "Approve and turn on" : "Approve"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** A chat capability's line: the words before the colon name it, the rest says what it allows. */
function ChatConsentLine({ text }: { text: string }) {
  const colon = text.indexOf(":");
  return (
    <p className="text-sm text-rim-text">
      <span className="font-medium">{text.slice(0, colon + 1)}</span>
      <span className="text-rim-text-muted">{text.slice(colon + 1)}</span>
    </p>
  );
}

/**
 * The built-in and app commands the plugin asks to run: a box per one the person may grant,
 * none checked, those already granted shown as granted, and those no plugin may run or that
 * are not offered here greyed with why.
 */
function RunsCommandsSection({
  rows,
  granted,
  selected,
  onToggle,
}: {
  rows: RunsCommandRow[];
  granted: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <section aria-label="Commands it can run" className="space-y-1">
      <h4 className="text-xs font-medium text-rim-text">Commands it can run</h4>
      <p className="text-xs text-rim-text-muted">
        Tick each command it may run as you. Those that change something ask you each time.
      </p>
      <div className="space-y-1">
        {rows.map((row) => {
          const grantable = row.kind === "runs" || row.kind === "asks";
          const note = runsCommandNote(row);
          const label = (
            <div className="min-w-0">
              <p className={`text-sm ${grantable ? "text-rim-text" : "text-rim-text-faint"}`}>
                {showInvisibleCharacters(row.title)}
                {row.category && (
                  <span className="ml-1 text-xs text-rim-text-faint">· {row.category}</span>
                )}
              </p>
              <p className="font-mono text-[11px] text-rim-text-faint">{row.id}</p>
              {note && <p className="text-xs text-rim-text-muted">{note}</p>}
            </div>
          );
          if (!grantable) {
            return (
              <div key={row.id} className="flex items-start gap-3 px-3 py-2 opacity-60">
                <span className="mt-0.5 w-[13px] shrink-0" aria-hidden />
                {label}
              </div>
            );
          }
          const already = granted.has(row.id);
          return (
            <label
              key={row.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={already || selected.has(row.id)}
                disabled={already}
                onChange={() => onToggle(row.id)}
                className="mt-0.5 accent-rim-accent"
                aria-label={`Let it run ${row.title}`}
              />
              {label}
              {already && <span className="ml-auto text-xs text-rim-success">Granted</span>}
            </label>
          );
        })}
      </div>
    </section>
  );
}
