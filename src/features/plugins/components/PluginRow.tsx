import { useId, useRef, useState } from "react";
import {
  Puzzle,
  Trash2,
  Monitor,
  FolderOpen,
  GitBranch,
  AlertTriangle,
  ShieldCheck,
  PenLine,
  RefreshCw,
  SlidersHorizontal,
  Shield,
  Activity,
  Box,
  Link2,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import { usePluginFingerprintDismissStore } from "../state/usePluginFingerprintDismissStore";
import { runtimeKind, type PluginHealth, type PluginInfo } from "../types";
import { capabilityLabel, KIND_CONSENT_TEXT } from "./consentText";
import { PluginConsentRow } from "./PluginAiConsentPanel";
import { PluginAuditPanel } from "./PluginAuditPanel";
import { PluginDetailsDialog } from "./PluginDetailsDialog";
import { kindLabel, trustBadge } from "./pluginTrust";

const healthDisplay: Record<PluginHealth, { color: string; pill: string; label: string }> = {
  running: {
    color: "bg-rim-success",
    pill: "bg-rim-success/10 text-rim-success",
    label: "Running",
  },
  stopped: {
    color: "bg-rim-text-muted",
    pill: "bg-rim-panel-soft text-rim-text-muted",
    label: "Stopped",
  },
  crashed: { color: "bg-rim-danger", pill: "bg-rim-danger/10 text-rim-danger", label: "Crashed" },
  timeout: { color: "bg-rim-warm", pill: "bg-rim-warm/10 text-rim-warm", label: "Timed out" },
};

/** A line under a plugin's name: the outcome of its update, or how it is updated. */
export interface RowNote {
  tone: "success" | "muted" | "danger";
  text: string;
}

const noteTone: Record<RowNote["tone"], string> = {
  success: "text-rim-success",
  muted: "text-rim-text-muted",
  danger: "text-rim-danger",
};

interface PluginRowProps {
  plugin: PluginInfo;
  /** A local-process plugin seen on the web, which cannot run it. */
  needsDesktop?: boolean;
  onToggle: (plugin: PluginInfo) => void;
  onUninstall: (plugin: PluginInfo) => void;
  onPermissions: (plugin: PluginInfo) => void;
  /** Present when the plugin declares settings: opens its settings form. */
  onSettings?: () => void;
  onTrustFingerprint: (pluginId: string) => void;
  onDisable: (pluginId: string) => void;
  /** Present when this device can sign plugins with the account's identity key. */
  onSign?: (plugin: PluginInfo) => void;
  /** Present when the plugin can be updated from its source on this device. */
  onUpdate?: () => void;
  updatePending?: boolean;
  /** The outcome of the last update, or how this plugin is updated. */
  updateStatus?: RowNote;
  trustPending: boolean;
  /** Whether this app has the AI agent and the plugin host, so agent approvals can be shown. */
  aiConsent?: boolean;
  /** Present when Settings > Agents is available: opens it. */
  onOpenAgents?: () => void;
}

/**
 * Single row in the installed-plugins list.
 *
 * The closed row shows the name, version, author, health, the description's first two
 * lines, the chips (kind, signature, source), the outcome of the last update and the
 * enable switch. A button with `aria-expanded` opens the rest in place: update, settings,
 * details, activity, signing and uninstall; for a local process, the warning about what it
 * can do; the permissions granted; where its commands appear; and what the AI agent may
 * call.
 *
 * When `plugin.fingerprint_changed` is true, a warning banner with "Trust new version" and
 * "Dismiss" stays on the row whether it is open or not. Dismiss stops a running plugin and
 * hides the banner on this device until the fingerprint changes again; the "Bundle changed"
 * badge then shows it again. The switch still turns an enabled plugin off, but cannot turn
 * it on until the user trusts the new version.
 */
export function PluginRow({
  plugin,
  needsDesktop = false,
  onToggle,
  onUninstall,
  onPermissions,
  onSettings,
  onTrustFingerprint,
  onDisable,
  onSign,
  onUpdate,
  updatePending = false,
  updateStatus,
  trustPending,
  aiConsent = false,
  onOpenAgents,
}: PluginRowProps) {
  const healthState = plugin.health ? healthDisplay[plugin.health] : null;
  // A changed bundle blocks only enabling; turning the plugin off stays possible.
  const blocked = needsDesktop || (plugin.fingerprint_changed && !plugin.enabled);
  const [open, setOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const name = showInvisibleCharacters(plugin.display_name || plugin.plugin_id);
  const fingerprint = plugin.current_fingerprint ?? "";
  const warningDismissed = usePluginFingerprintDismissStore(
    (s) => s.dismissed[plugin.plugin_id] === fingerprint,
  );
  const dismissWarning = usePluginFingerprintDismissStore((s) => s.dismiss);
  const restoreWarning = usePluginFingerprintDismissStore((s) => s.restore);
  const localProcess = runtimeKind(plugin) !== "WebSandboxed";
  const commands = plugin.commands ?? [];
  const inPalette = commands.some((c) => !c.arguments.some((a) => a.required));

  function handleDismissWarning() {
    // A changed bundle must not keep running once the warning is out of sight.
    if (plugin.enabled) onDisable(plugin.plugin_id);
    dismissWarning(plugin.plugin_id, fingerprint);
  }

  return (
    <div className="rounded-xl border border-rim-line bg-rim-panel">
      <div className="flex items-start gap-3 p-4">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rim-accent"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rim-accent/10">
            <Puzzle className="h-[18px] w-[18px] text-rim-accent" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 break-words text-sm font-semibold text-rim-text">
                {name}
              </span>
              <span className="text-[11px] text-rim-text-faint">
                v{plugin.version}
                {plugin.author ? ` · ${showInvisibleCharacters(plugin.author)}` : ""}
              </span>
              {needsDesktop ? (
                <span className="rounded-full bg-rim-warm/15 px-2 py-0.5 text-[11px] font-medium text-rim-warm">
                  Needs the desktop app
                </span>
              ) : (
                healthState && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      healthState.pill,
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", healthState.color)} />
                    {healthState.label}
                  </span>
                )
              )}
            </span>
            {plugin.description && (
              <span className="line-clamp-2 break-words text-xs leading-relaxed text-rim-text-muted">
                {showInvisibleCharacters(plugin.description)}
              </span>
            )}
          </span>
          {open ? (
            <ChevronDown className="mt-2 h-4 w-4 shrink-0 text-rim-text-muted" aria-hidden />
          ) : (
            <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-rim-text-muted" aria-hidden />
          )}
        </button>

        <button
          type="button"
          onClick={() => onToggle(plugin)}
          disabled={blocked}
          className={cn(
            "relative mt-2 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition",
            blocked && "cursor-not-allowed opacity-40",
          )}
          style={{
            backgroundColor: plugin.enabled ? "var(--color-rim-accent)" : "var(--color-rim-line)",
          }}
          role="switch"
          aria-checked={plugin.enabled}
          aria-label={name}
          title={toggleLabel(plugin, needsDesktop)}
        >
          <span
            className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
            style={{ transform: plugin.enabled ? "translateX(18px)" : "translateX(3px)" }}
          />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 px-4 pb-4">
        <div className="flex flex-wrap gap-1.5">
          {trustChips(plugin).map((chip) => (
            <span
              key={chip.text}
              className={cn(
                "inline-flex max-w-full items-center gap-1 break-words rounded-md px-1.5 py-0.5 text-[11px]",
                chip.warn
                  ? "bg-rim-warm/10 text-rim-warm"
                  : "bg-rim-panel-soft text-rim-text-muted",
              )}
            >
              {chip.icon}
              {chip.text}
            </span>
          ))}
          {plugin.fingerprint_changed &&
            (warningDismissed ? (
              <button
                type="button"
                onClick={() => restoreWarning(plugin.plugin_id)}
                title="Show the changed-bundle warning"
                className="flex items-center gap-1 rounded-full bg-rim-warm/15 px-2 py-0.5 text-[10px] font-medium text-rim-warm hover:bg-rim-warm/25"
              >
                <AlertTriangle className="h-3 w-3" />
                Bundle changed
              </button>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-rim-warm/15 px-2 py-0.5 text-[10px] font-medium text-rim-warm">
                <AlertTriangle className="h-3 w-3" />
                Bundle changed
              </span>
            ))}
        </div>
        {updateStatus && (
          <p className={cn("break-words text-[11px]", noteTone[updateStatus.tone])} role="status">
            {updateStatus.text}
          </p>
        )}
        {plugin.enabled && plugin.last_error && (
          <p className="break-words text-[11px] text-rim-danger" role="status">
            {plugin.last_error}
          </p>
        )}
      </div>

      {/* Fingerprint-changed warning banner */}
      {plugin.fingerprint_changed && !warningDismissed && (
        <div className="border-t border-rim-warm/20 bg-rim-warm/5 px-4 py-3">
          <div className="flex flex-wrap items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rim-warm" />
            <div className="min-w-[12rem] flex-1">
              <p className="text-xs font-medium text-rim-warm">Plugin bundle has changed</p>
              <p className="mt-0.5 text-[11px] text-rim-text-muted">
                The files in this plugin&apos;s installation directory differ from what was recorded
                at install time. Review the changes before enabling.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                className="inline-flex items-center"
                variant="secondary"
                size="sm"
                onClick={() => onTrustFingerprint(plugin.plugin_id)}
                disabled={trustPending}
              >
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                {trustPending ? "Trusting..." : "Trust new version"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismissWarning}
                title="Dismiss without trusting — plugin stays disabled"
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div id={detailsId} className="space-y-4 border-t border-rim-line px-4 py-4 text-xs">
          <div className="flex flex-wrap gap-2">
            {onUpdate && (
              <Button
                className="inline-flex items-center"
                variant="secondary"
                size="sm"
                onClick={onUpdate}
                disabled={updatePending}
                title="Fetch the newest version from the plugin's git repository"
              >
                <RefreshCw className={cn("mr-1 h-3.5 w-3.5", updatePending && "animate-spin")} />
                {updatePending ? "Updating..." : "Update"}
              </Button>
            )}
            {onSettings && (
              <Button
                className="inline-flex items-center"
                variant="secondary"
                size="sm"
                onClick={onSettings}
                aria-label={`Settings for ${name}`}
              >
                <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                Settings
              </Button>
            )}
            <Button
              className="inline-flex items-center"
              variant="secondary"
              size="sm"
              onClick={() => setDetailsOpen(true)}
              aria-label={`View details for ${name}`}
            >
              <Info className="mr-1 h-3.5 w-3.5" />
              View details
            </Button>
            <Button
              className="inline-flex items-center"
              variant="secondary"
              size="sm"
              onClick={() => setActivityOpen((v) => !v)}
              aria-expanded={activityOpen}
            >
              <Activity className="mr-1 h-3.5 w-3.5" />
              {activityOpen ? "Hide activity" : "Activity"}
            </Button>
            {onSign && (
              <Button
                className="inline-flex items-center"
                variant="secondary"
                size="sm"
                onClick={() => onSign(plugin)}
              >
                <PenLine className="mr-1 h-3.5 w-3.5" />
                Sign and publish…
              </Button>
            )}
            <Button
              className="inline-flex items-center"
              variant="danger"
              size="sm"
              onClick={() => onUninstall(plugin)}
              aria-label={`Uninstall ${name}`}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Uninstall…
            </Button>
          </div>

          {localProcess && (
            <p className="rounded-lg border border-rim-warm/30 bg-rim-warm/5 px-3 py-2 text-rim-warm">
              {KIND_CONSENT_TEXT.DesktopLocalProcess}
            </p>
          )}

          <section aria-label="Permissions you granted" className="space-y-1.5">
            <h4 className="font-medium text-rim-text">Permissions you granted</h4>
            {plugin.approved_capabilities.length > 0 ? (
              <ul className="space-y-0.5 text-rim-text-muted">
                {plugin.approved_capabilities.map((capability) => (
                  <li key={capability}>{capabilityLabel(capability)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-rim-text-muted">None.</p>
            )}
            <Button
              className="inline-flex items-center"
              variant="secondary"
              size="sm"
              onClick={() => onPermissions(plugin)}
              aria-label={`Permissions for ${name}`}
            >
              <Shield className="mr-1 h-3.5 w-3.5" />
              Permissions
            </Button>
          </section>

          {inPalette && (
            <section aria-label="Use it your way" className="space-y-1">
              <h4 className="font-medium text-rim-text">Use it your way</h4>
              <p className="text-rim-text-muted">
                Its commands are in the command palette while it is on.
              </p>
            </section>
          )}

          {aiConsent && (
            <section aria-label="What your agents can do with it" className="space-y-2">
              <h4 className="font-medium text-rim-text">What your agents can do with it</h4>
              {plugin.ai_callable_commands.length > 0 || plugin.ai_consent_required ? (
                <PluginConsentRow plugin={plugin} />
              ) : (
                <p className="text-rim-text-muted">It has no commands the AI agent can call.</p>
              )}
              {onOpenAgents && (
                <>
                  <p className="text-rim-text-muted">
                    What programs connected from outside may run is approved per agent, in Agents.
                  </p>
                  <Button variant="secondary" size="sm" onClick={onOpenAgents}>
                    Open Agents settings
                  </Button>
                </>
              )}
            </section>
          )}
        </div>
      )}

      {open && activityOpen && <PluginAuditPanel plugin={plugin} />}

      {detailsOpen && <PluginDetailsDialog plugin={plugin} onClose={() => setDetailsOpen(false)} />}
    </div>
  );
}

/**
 * The switch's label and tooltip: why it is off-limits, or what clicking it does.
 *
 * @param plugin - The plugin the switch belongs to.
 * @param needsDesktop - Whether the plugin runs only in the desktop app.
 * @returns The text for the switch's `title`.
 */
function toggleLabel(plugin: PluginInfo, needsDesktop: boolean): string {
  if (needsDesktop) return "Needs the desktop app";
  if (plugin.enabled) return "Disable plugin";
  if (plugin.fingerprint_changed) return "Trust the new version before enabling";
  return "Enable plugin";
}

/** One chip under a plugin's description. */
interface TrustChip {
  text: string;
  icon?: React.ReactNode;
  /** Marks a plugin nobody signed. */
  warn?: boolean;
}

/**
 * The chips under a plugin's description: its kind, then whether it is signed and where it
 * came from, as {@link trustBadge} words them.
 *
 * @param plugin - The plugin of the row.
 * @returns The chips, in order.
 */
function trustChips(plugin: PluginInfo): TrustChip[] {
  const sandboxed = runtimeKind(plugin) === "WebSandboxed";
  const kind: TrustChip = {
    text: kindLabel(plugin),
    icon: sandboxed ? <Box className="h-3 w-3" /> : <Monitor className="h-3 w-3" />,
  };
  const sourceIcon: Partial<Record<string, React.ReactNode>> = {
    git: <GitBranch className="h-3 w-3" />,
    link: <Link2 className="h-3 w-3" />,
    local: <FolderOpen className="h-3 w-3" />,
    registry: <ShieldCheck className="h-3 w-3" />,
  };
  const parts = trustBadge(plugin).split(" · ");
  return [
    kind,
    ...parts.map((part, index) => ({
      text: part.charAt(0).toUpperCase() + part.slice(1),
      icon: index === parts.length - 1 ? sourceIcon[plugin.source?.kind ?? ""] : undefined,
      warn: part === "Unsigned",
    })),
  ];
}
