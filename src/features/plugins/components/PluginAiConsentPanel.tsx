import { useEffect, useState } from "react";
import { Bot, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";

import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { cn } from "../../../shared/ui/cn";
import { toast } from "../../../shared/toast/useToastStore";
import { logger } from "../../../core/logger";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { usePluginList } from "../api/usePluginList";
import {
  useApproveAiCommands,
  useRevokeAiConsent,
  useRevokeAllAiConsent,
  useRevokeAllPluginsAiConsent,
} from "../api/usePluginAiConsent";
import type { PluginIpcError } from "../api/ipc";
import type { PluginInfo } from "../types";

// ──────────────────────────────────────────────────────────────
// Error handling helpers
// ──────────────────────────────────────────────────────────────

function friendlyError(err: PluginIpcError | Error | unknown): string {
  if (typeof err === "object" && err !== null && "kind" in err) {
    const e = err as PluginIpcError;
    if (e.kind === "permission_denied") return e.message;
    if (e.kind === "invalid_args") return `Invalid arguments: ${e.message}`;
    if (e.kind === "ipc_unavailable") return "Plugin host is not available.";
    if (e.kind === "backend_error") {
      if (e.code === "INVALID_MANIFEST")
        return "The plugin manifest is invalid or has changed. Please re-install the plugin.";
      return e.message;
    }
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

// ──────────────────────────────────────────────────────────────
// First-grant confirmation modal
// ──────────────────────────────────────────────────────────────

interface GrantConfirmModalProps {
  open: boolean;
  plugin: PluginInfo | null;
  commandIds: string[];
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function GrantConfirmModal({
  open,
  plugin,
  commandIds,
  onConfirm,
  onCancel,
  isPending,
}: GrantConfirmModalProps) {
  if (!plugin) return null;

  return (
    <Dialog open={open} onClose={onCancel} title="Grant AI Access?" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-rim-warm/30 bg-rim-warm/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rim-warm" />
          <p className="text-xs text-rim-warm">
            You are granting the AI agent permission to invoke commands in{" "}
            <strong>{plugin.display_name}</strong> on your behalf. The agent can call these commands
            automatically without asking each time.
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-rim-text-muted">Commands that will be approved:</p>
          <ul className="space-y-1">
            {commandIds.map((id) => (
              <li key={id} className="flex items-center gap-2 text-xs text-rim-text">
                <span className="h-1 w-1 rounded-full bg-rim-accent" />
                <code className="font-mono">{id}</code>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button size="sm" isLoading={isPending} onClick={onConfirm}>
            Grant Access
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// Per-plugin consent row
// ──────────────────────────────────────────────────────────────

interface PluginConsentRowProps {
  plugin: PluginInfo;
}

function PluginConsentRow({ plugin }: PluginConsentRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [pendingGrant, setPendingGrant] = useState<{
    commandIds: string[];
    isBulk: boolean;
  } | null>(null);

  const approve = useApproveAiCommands();
  const revoke = useRevokeAiConsent();
  const revokeAll = useRevokeAllAiConsent();

  const isApproved = (commandId: string) => plugin.approved_ai_commands.includes(commandId);

  const allApproved =
    plugin.ai_callable_commands.length > 0 && plugin.ai_callable_commands.every(isApproved);

  const noneApproved = plugin.approved_ai_commands.length === 0;

  const showConsentRequiredBadge = plugin.ai_consent_required && noneApproved;

  function requestGrant(commandIds: string[]) {
    // Show confirmation modal on first grant (transition from empty)
    if (noneApproved) {
      setPendingGrant({ commandIds, isBulk: commandIds.length > 1 });
    } else {
      doGrant(commandIds);
    }
  }

  function doGrant(commandIds: string[]) {
    approve.mutate(
      { pluginId: plugin.plugin_id, commandIds },
      {
        onError: (err) => {
          toast.error("Failed to grant AI access", {
            description: friendlyError(err),
          });
        },
      },
    );
  }

  function handleToggle(commandId: string) {
    if (isApproved(commandId)) {
      revoke.mutate(
        { pluginId: plugin.plugin_id, commandId },
        {
          onError: (err) => {
            toast.error("Failed to revoke AI access", {
              description: friendlyError(err),
            });
          },
        },
      );
    } else {
      requestGrant([commandId]);
    }
  }

  function handleBulkApprove() {
    requestGrant(plugin.ai_callable_commands);
  }

  function handleRevokeAll() {
    revokeAll.mutate(
      { pluginId: plugin.plugin_id, commandIds: plugin.approved_ai_commands },
      {
        onSuccess: ({ failed }) => {
          if (failed.length > 0) {
            toast.error("Some commands could not be revoked", {
              description: `Failed: ${failed.join(", ")}`,
            });
          }
        },
        onError: (err) => {
          toast.error("Failed to revoke AI access", {
            description: friendlyError(err),
          });
        },
      },
    );
  }

  const hasAiCommands = plugin.ai_callable_commands.length > 0;

  return (
    <>
      <div className="rounded-lg border border-rim-line bg-rim-void">
        {/* Header row */}
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rim-accent/10">
            <Bot className="h-4 w-4 text-rim-accent" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-rim-text">{plugin.display_name}</span>
              <span className="text-xs text-rim-text-faint font-mono">{plugin.manifest_id}</span>
              {showConsentRequiredBadge && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rim-warm/15 px-2 py-0.5 text-[10px] font-medium text-rim-warm">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  AI consent required
                </span>
              )}
            </div>
            <p className="text-xs text-rim-text-muted mt-0.5">
              {hasAiCommands
                ? `${plugin.approved_ai_commands.length} / ${plugin.ai_callable_commands.length} AI commands approved`
                : "No AI-callable commands"}
            </p>
          </div>

          {hasAiCommands && (
            <div className="flex shrink-0 items-center gap-2">
              {!allApproved && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBulkApprove}
                  disabled={approve.isPending}
                >
                  Approve all
                </Button>
              )}
              {!noneApproved && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRevokeAll}
                  disabled={revokeAll.isPending}
                  isLoading={revokeAll.isPending}
                >
                  Revoke all
                </Button>
              )}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded p-1 text-rim-text-muted transition hover:text-rim-text"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
          )}
        </div>

        {/* Expanded command list */}
        {expanded && hasAiCommands && (
          <div className="border-t border-rim-line px-4 pb-3 pt-2 space-y-1">
            {plugin.ai_callable_commands.map((commandId) => {
              const approved = isApproved(commandId);
              return (
                <label
                  key={commandId}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition",
                    "hover:bg-white/5",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={() => handleToggle(commandId)}
                    className="accent-rim-accent"
                    disabled={approve.isPending || revoke.isPending || revokeAll.isPending}
                  />
                  <code className="text-xs font-mono text-rim-text">{commandId}</code>
                  {approved && (
                    <span className="ml-auto text-[10px] text-rim-success">Approved</span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <GrantConfirmModal
        open={pendingGrant !== null}
        plugin={plugin}
        commandIds={pendingGrant?.commandIds ?? []}
        onConfirm={() => {
          if (pendingGrant) {
            doGrant(pendingGrant.commandIds);
          }
          setPendingGrant(null);
        }}
        onCancel={() => setPendingGrant(null)}
        isPending={approve.isPending}
      />
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// Panel-level revoke-all confirmation dialog
// ──────────────────────────────────────────────────────────────

interface RevokeAllConfirmDialogProps {
  open: boolean;
  totalGrants: number;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function RevokeAllConfirmDialog({
  open,
  totalGrants,
  onConfirm,
  onCancel,
  isPending,
}: RevokeAllConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title="Revoke all AI grants?" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-rim-danger/30 bg-rim-danger/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rim-danger" />
          <p className="text-xs text-rim-text-muted">
            Revoke AI consent for{" "}
            <strong className="text-rim-text">
              {totalGrants} approved command{totalGrants !== 1 ? "s" : ""}
            </strong>{" "}
            across all plugins? The AI agent will immediately lose access to these commands for the
            current session.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" isLoading={isPending} onClick={onConfirm}>
            Revoke all grants
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// Main panel
// ──────────────────────────────────────────────────────────────

export function PluginAiConsentPanel() {
  const { capabilities } = useRuntime();
  const { data: plugins, isLoading, refetch } = usePluginList();
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const revokeAllPlugins = useRevokeAllPluginsAiConsent();

  // Subscribe to Tauri event to auto-refresh consent state.
  // Guard against the race where the component unmounts before listen() resolves:
  // if cancelled is true when the promise settles, call unlisten immediately and
  // discard — otherwise store it for the normal cleanup path.
  useEffect(() => {
    if (!capabilities.pluginHost || !capabilities.agent) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen("plugin-ai-consent-changed", () => {
      void refetch();
    })
      .then((fn) => {
        if (cancelled) {
          fn(); // resolved after unmount — unregister immediately
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        logger.warn("[RIM:Plugin] Failed to register plugin-ai-consent-changed listener:", err);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [capabilities.pluginHost, capabilities.agent, refetch]);

  if (!capabilities.pluginHost || !capabilities.agent) {
    return (
      <p className="text-sm text-rim-text-muted">
        Plugin AI consent is only available in the desktop app.
      </p>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-rim-text-muted">Loading plugins...</p>;
  }

  const aiEnabledPlugins = (plugins ?? []).filter(
    (p) => p.ai_callable_commands.length > 0 || p.ai_consent_required,
  );

  if (aiEnabledPlugins.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Bot className="h-8 w-8 text-rim-text-muted" />
        <p className="text-sm text-rim-text-muted">
          No plugins with AI-callable commands installed.
        </p>
      </div>
    );
  }

  const totalApprovedGrants = aiEnabledPlugins.reduce(
    (sum, p) => sum + p.approved_ai_commands.length,
    0,
  );

  function handleRevokeAllPlugins() {
    const targets = aiEnabledPlugins
      .filter((p) => p.approved_ai_commands.length > 0)
      .map((p) => ({ pluginId: p.plugin_id, commandIds: p.approved_ai_commands }));

    revokeAllPlugins.mutate(targets, {
      onSuccess: ({ revokedCount, failedCount }) => {
        setRevokeAllOpen(false);
        if (failedCount === 0) {
          toast.success(`Revoked ${revokedCount} AI grant${revokedCount !== 1 ? "s" : ""}`);
        } else {
          toast.error(`Revoked ${revokedCount}, failed ${failedCount} (see console)`);
        }
      },
      onError: () => {
        setRevokeAllOpen(false);
        toast.error("Failed to revoke AI grants");
      },
    });
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-rim-text">Plugin AI Access</h2>
            <p className="mt-1 text-xs text-rim-text-muted">
              Control which plugin commands the AI agent can invoke on your behalf. Approval means
              the agent can call these commands automatically during a session.
            </p>
          </div>
          {totalApprovedGrants > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setRevokeAllOpen(true)}
              disabled={revokeAllPlugins.isPending}
              className="shrink-0"
            >
              Revoke all grants
            </Button>
          )}
        </div>

        <div className="space-y-2">
          {aiEnabledPlugins.map((plugin) => (
            <PluginConsentRow key={plugin.plugin_id} plugin={plugin} />
          ))}
        </div>
      </div>

      <RevokeAllConfirmDialog
        open={revokeAllOpen}
        totalGrants={totalApprovedGrants}
        onConfirm={handleRevokeAllPlugins}
        onCancel={() => setRevokeAllOpen(false)}
        isPending={revokeAllPlugins.isPending}
      />
    </>
  );
}
