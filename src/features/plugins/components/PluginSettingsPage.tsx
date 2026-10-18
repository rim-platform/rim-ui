import { useState, useRef, useCallback } from "react";
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
  MoreHorizontal,
  Shield,
  Activity,
  Box,
  Link2,
} from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useShellStore } from "../../../shell/state/useShellStore";
import { usePluginList } from "../api/usePluginList";
import {
  usePluginEnable,
  usePluginDisable,
  usePluginUninstall,
  usePluginInstallFromLocal,
  usePluginInstallFromGit,
  usePluginTrustFingerprint,
  usePluginUpdate,
} from "../api/usePluginActions";
import { InstallFromLink } from "./InstallFromLink";
import { PluginAuditPanel } from "./PluginAuditPanel";
import { PluginCapabilityPrompt } from "./PluginCapabilityPrompt";
import { PluginDetailsDialog } from "./PluginDetailsDialog";
import { PluginSettingsDialog } from "./PluginSettingsDialog";
import { PostInstallConsentDialog } from "./PostInstallConsentDialog";
import { UninstallPluginDialog } from "./UninstallPluginDialog";
import { kindLabel, trustBadge } from "./pluginTrust";
import { RegistryNotes } from "../registry/components/RegistryNotes";
import { SignAndPublishDialog } from "../registry/components/SignAndPublishDialog";
import { usePluginSigning } from "../registry/signing";
import { usePluginFingerprintDismissStore } from "../state/usePluginFingerprintDismissStore";
import { hasSettings } from "../pluginSettings";
import {
  parsePostInstallConsent,
  runtimeKind,
  type PluginInfo,
  type PluginHealth,
  type PluginUpdateResult,
  type PostInstallConsentRequest,
} from "../types";

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

/**
 * The plugin settings page. The desktop lists both kinds of plugin; the web,
 * which runs only WebSandboxed plugins, lists those and shows any local-process
 * entry as needing the desktop app.
 *
 * Surfaces:
 * - Install from local folder button (webkitdirectory input, works in Tauri webview), desktop only
 * - Install from git URL button + text input, desktop only
 * - Install from link (a `.rimbundle` link pinned by its SHA-256), desktop and web
 * - List of installed plugins with enable/disable/uninstall + fingerprint trust action
 * - Settings on the row of a plugin that declares settings, opening its settings form; a
 *   `{ kind: "settings", tab: "plugins", plugin }` surface opens that plugin's form
 * - Update on the row of a plugin installed from a git URL, desktop only
 * - Empty state with onboarding copy when no plugins are installed
 *
 * Note: folder-picker uses `<input type="file" webkitdirectory>` because
 * `@tauri-apps/plugin-dialog` is not a declared dependency.  The Tauri webview
 * exposes the full filesystem path via `file.path` (Tauri-injected property) when
 * running in the desktop shell.  On web the picker is disabled.
 */
export function PluginSettingsPage() {
  const { platform, capabilities } = useRuntime();
  const { data: plugins, isLoading } = usePluginList();
  const enable = usePluginEnable();
  const disable = usePluginDisable();
  const uninstall = usePluginUninstall();
  const installFromLocal = usePluginInstallFromLocal();
  const installFromGit = usePluginInstallFromGit();
  const trustFingerprint = usePluginTrustFingerprint();
  const update = usePluginUpdate();
  const signing = usePluginSigning();
  const [signTarget, setSignTarget] = useState<PluginInfo | null>(null);
  // The plugin whose uninstall waits for the user's confirmation.
  const [uninstallTarget, setUninstallTarget] = useState<PluginInfo | null>(null);
  const [uninstallError, setUninstallError] = useState<string | null>(null);

  const [permissionsTarget, setPermissionsTarget] = useState<PluginInfo | null>(null);
  // The plugin whose settings form is open: picked on its row, or named by the surface.
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const linkedSettingsId = useShellStore((s) =>
    s.mainSurface.kind === "settings" ? (s.mainSurface.plugin ?? null) : null,
  );
  const setMainSurface = useShellStore((s) => s.setMainSurface);
  const settingsTarget =
    plugins?.find(
      (p) => p.plugin_id === (settingsId ?? linkedSettingsId) && hasSettings(p.settings_schema),
    ) ?? null;
  const closeSettings = useCallback(() => {
    setSettingsId(null);
    if (linkedSettingsId !== null) setMainSurface({ kind: "settings", tab: "plugins" });
  }, [linkedSettingsId, setMainSurface]);
  // A plugin just installed: its permission prompt opens once it is in the list,
  // so the user reads what it does and what it asks for before turning it on.
  const [installedId, setInstalledId] = useState<string | null>(null);
  const installedPlugin = installedId
    ? (plugins?.find((p) => p.plugin_id === installedId) ?? null)
    : null;
  // A plugin whose update asks for new permissions: its prompt opens on the reloaded entry.
  const [updatedId, setUpdatedId] = useState<string | null>(null);
  const updatedPlugin = updatedId
    ? (plugins?.find((p) => p.plugin_id === updatedId) ?? null)
    : null;
  const promptTarget = permissionsTarget ?? installedPlugin ?? updatedPlugin;
  // The outcome of the last update of each plugin, shown on its row.
  const [updateStatus, setUpdateStatus] = useState<Record<string, RowNote>>({});
  // Set when plugin_update stopped before running npm/pip steps.
  const [updateConsent, setUpdateConsent] = useState<{
    pluginId: string;
    request: PostInstallConsentRequest;
  } | null>(null);
  const [gitUrl, setGitUrl] = useState("");
  const [gitUrlOpen, setGitUrlOpen] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  // Set when plugin_install_from_git stopped before running npm/pip steps.
  const [consentRequest, setConsentRequest] = useState<{
    url: string;
    request: PostInstallConsentRequest;
  } | null>(null);

  // Hidden file input for folder picker — see module docblock for why.
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFolderPick = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

  const handleFolderSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      // In Tauri the webview injects a `path` property on File objects that
      // exposes the absolute filesystem path.  The directory comes from the
      // first file's path.
      const firstFile = files[0] as File & { path?: string };
      if (firstFile.path) {
        // Derive the folder path by stripping the filename.
        const parts = firstFile.path.split(/[/\\]/);
        parts.pop(); // remove filename
        const folderPath = parts.join("/");
        setInstallError(null);
        installFromLocal.mutate(folderPath, {
          onSuccess: (result) => setInstalledId(result?.plugin_id ?? null),
          onError: (err) => {
            setInstallError("message" in err ? err.message : "Install failed");
          },
        });
      } else {
        setInstallError("Could not read folder path. This feature requires the desktop app.");
      }
      // Reset so the same folder can be re-selected after an error.
      e.target.value = "";
    },
    [installFromLocal],
  );

  const runGitInstall = useCallback(
    (url: string, allowPostInstall: boolean) => {
      setInstallError(null);
      installFromGit.mutate(
        { url, allowPostInstall },
        {
          onSuccess: (result) => {
            setInstalledId(result?.plugin_id ?? null);
            setConsentRequest(null);
            setGitUrl("");
            setGitUrlOpen(false);
          },
          onError: (err) => {
            const request = allowPostInstall ? null : parsePostInstallConsent(err);
            if (request) {
              // Nothing was installed yet — ask before running author code.
              setConsentRequest({ url, request });
              return;
            }
            setConsentRequest(null);
            setInstallError("message" in err ? err.message : "Install failed");
          },
        },
      );
    },
    [installFromGit],
  );

  const runUpdate = useCallback(
    (pluginId: string, allowPostInstall: boolean) => {
      const note = (status: RowNote | null) =>
        setUpdateStatus((prev) => {
          const next = { ...prev };
          if (status) next[pluginId] = status;
          else delete next[pluginId];
          return next;
        });
      note(null);
      update.mutate(
        { pluginId, allowPostInstall },
        {
          onSuccess: (result) => {
            setUpdateConsent(null);
            note(updateNote(result));
            if (result.added_capabilities.length > 0) setUpdatedId(result.plugin_id);
          },
          onError: (err) => {
            const request = allowPostInstall ? null : parsePostInstallConsent(err);
            if (request) {
              // Nothing changed yet: ask before running author code.
              setUpdateConsent({ pluginId, request });
              return;
            }
            setUpdateConsent(null);
            note({ tone: "danger", text: "message" in err ? err.message : "Update failed" });
          },
        },
      );
    },
    [update],
  );

  const handleGitInstall = useCallback(() => {
    const trimmed = gitUrl.trim();
    if (!trimmed) return;
    runGitInstall(trimmed, false);
  }, [gitUrl, runGitInstall]);

  if (!capabilities.pluginHost && !capabilities.webPlugins) {
    return <PluginDesktopOnlyCard />;
  }
  // Only the desktop runs plugins as local processes.
  const desktop = capabilities.pluginHost;

  if (isLoading) {
    return <p className="text-sm text-rim-text-muted">Loading plugins...</p>;
  }

  function handleToggle(plugin: PluginInfo) {
    if (!desktop && runtimeKind(plugin) !== "WebSandboxed") return;
    if (plugin.enabled) {
      // Turning a plugin off is allowed whatever its files hold.
      disable.mutate(plugin.plugin_id);
    } else if (plugin.fingerprint_changed) {
      // Enabling waits until the user trusts the new version.
      return;
    } else {
      enable.mutate(plugin.plugin_id, {
        onError: (err) => {
          // FingerprintChanged errors bubble from plugin_enable — refresh the list
          // so the UI shows the updated fingerprint_changed flag.
          if ("message" in err && err.message?.includes("fingerprint")) {
            // TanStack Query will not invalidate automatically on error, so nothing happens
            // here — the plugin list will show the updated flag on next list refresh.
          }
        },
      });
    }
  }

  function handleUninstall(plugin: PluginInfo) {
    setUninstallError(null);
    setUninstallTarget(plugin);
  }

  function confirmUninstall(pluginId: string) {
    setUninstallError(null);
    uninstall.mutate(pluginId, {
      onSuccess: () => setUninstallTarget(null),
      onError: (err) => {
        setUninstallError("message" in err ? err.message : "Uninstall failed");
      },
    });
  }

  function handleTrustFingerprint(pluginId: string) {
    trustFingerprint.mutate(pluginId);
  }

  const isInstalling = installFromLocal.isPending || installFromGit.isPending;

  return (
    <div className="space-y-4">
      {/* Install affordances */}
      <div className="flex flex-wrap items-center gap-2">
        {desktop && (
          <>
            {/* Hidden folder picker — see module docblock */}
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is not in the standard TS types but works in all Tauri-supported browsers
              webkitdirectory=""
              className="hidden"
              onChange={handleFolderSelected}
              aria-hidden
            />
            <Button
              className="inline-flex items-center"
              variant="secondary"
              size="sm"
              onClick={handleFolderPick}
              disabled={isInstalling}
            >
              <FolderOpen className="mr-1.5 h-4 w-4" />
              Install from local folder
            </Button>

            <Button
              className="inline-flex items-center"
              variant="secondary"
              size="sm"
              onClick={() => setGitUrlOpen((v) => !v)}
              disabled={isInstalling}
            >
              <GitBranch className="mr-1.5 h-4 w-4" />
              Install from git URL
            </Button>
          </>
        )}

        <InstallFromLink
          installed={plugins ?? []}
          disabled={isInstalling}
          onInstalled={(pluginId) => setInstalledId(pluginId)}
        />
      </div>

      {desktop && gitUrlOpen && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            placeholder="https://github.com/user/my-rim-plugin"
            className="flex-1 rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-sm text-rim-text placeholder:text-rim-text-faint focus:border-rim-accent focus:outline-none"
            aria-label="Git repository URL"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleGitInstall();
            }}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleGitInstall}
            disabled={!gitUrl.trim() || isInstalling}
          >
            {installFromGit.isPending ? "Installing..." : "Install"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setGitUrlOpen(false);
              setGitUrl("");
              setInstallError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {installError && (
        <p className="flex items-center gap-1.5 text-xs text-rim-danger" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {installError}
        </p>
      )}

      <RegistryNotes />

      {/* Plugin list or empty state */}
      {!plugins || plugins.length === 0 ? (
        <PluginEmptyState desktop={desktop} />
      ) : (
        <>
          <h2 className="text-sm font-medium text-rim-text">Installed Plugins</h2>
          <div className="space-y-2">
            {plugins.map((plugin) => (
              <PluginRow
                key={plugin.plugin_id}
                plugin={plugin}
                needsDesktop={!desktop && runtimeKind(plugin) !== "WebSandboxed"}
                onToggle={handleToggle}
                onUninstall={handleUninstall}
                onPermissions={setPermissionsTarget}
                onSettings={
                  hasSettings(plugin.settings_schema)
                    ? () => setSettingsId(plugin.plugin_id)
                    : undefined
                }
                onTrustFingerprint={handleTrustFingerprint}
                onDisable={(pluginId) => disable.mutate(pluginId)}
                onSign={desktop && signing.canSign ? setSignTarget : undefined}
                onUpdate={
                  desktop && plugin.source?.kind === "git"
                    ? () => runUpdate(plugin.plugin_id, false)
                    : undefined
                }
                updatePending={update.isPending && update.variables?.pluginId === plugin.plugin_id}
                updateStatus={updateStatus[plugin.plugin_id] ?? linkNote(plugin)}
                trustPending={
                  trustFingerprint.isPending && trustFingerprint.variables === plugin.plugin_id
                }
              />
            ))}
          </div>
        </>
      )}

      {consentRequest && (
        <PostInstallConsentDialog
          request={consentRequest.request}
          isPending={installFromGit.isPending}
          onConfirm={() => runGitInstall(consentRequest.url, true)}
          onCancel={() => setConsentRequest(null)}
        />
      )}

      {updateConsent && (
        <PostInstallConsentDialog
          request={updateConsent.request}
          isPending={update.isPending}
          onConfirm={() => runUpdate(updateConsent.pluginId, true)}
          onCancel={() => setUpdateConsent(null)}
        />
      )}

      {uninstallTarget && (
        <UninstallPluginDialog
          plugin={uninstallTarget}
          web={platform === "web"}
          isPending={uninstall.isPending}
          error={uninstallError}
          onConfirm={() => confirmUninstall(uninstallTarget.plugin_id)}
          onCancel={() => setUninstallTarget(null)}
        />
      )}

      {signTarget && signing.identity && (
        <SignAndPublishDialog
          plugin={signTarget}
          identity={signing.identity}
          onClose={() => setSignTarget(null)}
        />
      )}

      {settingsTarget && (
        <PluginSettingsDialog
          key={settingsTarget.plugin_id}
          plugin={settingsTarget}
          onClose={closeSettings}
        />
      )}

      {promptTarget && (
        <PluginCapabilityPrompt
          key={`${promptTarget.plugin_id}@${promptTarget.version}`}
          open={true}
          onClose={() => {
            setPermissionsTarget(null);
            setInstalledId(null);
            setUpdatedId(null);
          }}
          plugin={promptTarget}
        />
      )}
    </div>
  );
}

// ─── Update notes ─────────────────────────────────────────────────────────────

/** A line under a plugin's name: the outcome of its update, or how it is updated. */
interface RowNote {
  tone: "success" | "muted" | "danger";
  text: string;
}

/**
 * The row note for a finished update.
 *
 * @param result - What `plugin_update` returned.
 * @returns "Updated to v…", or "Already up to date" when the checkout did not move.
 */
function updateNote(result: PluginUpdateResult): RowNote {
  if (!result.updated) {
    return { tone: "muted", text: `Already up to date (v${result.new_version})` };
  }
  const text =
    result.new_version === result.old_version
      ? `Updated to the latest commit (v${result.new_version})`
      : `Updated to v${result.new_version}`;
  return { tone: "success", text };
}

/**
 * The standing note of a plugin installed from a link, which is pinned to one
 * bundle by its hash and so cannot change in place.
 *
 * @param plugin - The plugin of the row.
 * @returns The note, or `undefined` for any other source.
 */
function linkNote(plugin: PluginInfo): RowNote | undefined {
  if (plugin.source?.kind !== "link") return undefined;
  return {
    tone: "muted",
    text: "Installed from a link pinned to one bundle: install the new version's link to update it.",
  };
}

const noteTone: Record<RowNote["tone"], string> = {
  success: "text-rim-success",
  muted: "text-rim-text-muted",
  danger: "text-rim-danger",
};

// ─── PluginRow ────────────────────────────────────────────────────────────────

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
}

/**
 * Single row in the installed-plugins list.
 *
 * Shows: name, the first two lines of the description, version, author,
 * health indicator, enable/disable toggle, update button for a plugin
 * installed from git, details button, settings button for a plugin that
 * declares settings, permissions button, uninstall button, and a line for the
 * outcome of the last update.
 *
 * When `plugin.fingerprint_changed` is true, a `FingerprintChanged` warning
 * banner is shown with "Trust new version" and "Dismiss" actions. Dismiss stops
 * a running plugin and hides the banner on this device until the fingerprint
 * changes again; the "Bundle changed" badge then shows it again. The switch
 * still turns an enabled plugin off, but cannot turn it on until the user
 * trusts the new version.
 */
function PluginRow({
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
}: PluginRowProps) {
  const healthState = plugin.health ? healthDisplay[plugin.health] : null;
  // A changed bundle blocks only enabling; turning the plugin off stays possible.
  const blocked = needsDesktop || (plugin.fingerprint_changed && !plugin.enabled);
  const [activityOpen, setActivityOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const name = plugin.display_name || plugin.plugin_id;
  const fingerprint = plugin.current_fingerprint ?? "";
  const warningDismissed = usePluginFingerprintDismissStore(
    (s) => s.dismissed[plugin.plugin_id] === fingerprint,
  );
  const dismissWarning = usePluginFingerprintDismissStore((s) => s.dismiss);
  const restoreWarning = usePluginFingerprintDismissStore((s) => s.restore);

  function handleDismissWarning() {
    // A changed bundle must not keep running once the warning is out of sight.
    if (plugin.enabled) onDisable(plugin.plugin_id);
    dismissWarning(plugin.plugin_id, fingerprint);
  }

  function closeMenu() {
    setMenuPosition(null);
  }

  const menuItems: DropdownMenuItem[] = [
    {
      id: "permissions",
      label: "Permissions",
      icon: <Shield className="h-3.5 w-3.5" />,
      onSelect: () => {
        closeMenu();
        onPermissions(plugin);
      },
    },
    {
      id: "activity",
      label: activityOpen ? "Hide activity" : "Activity",
      icon: <Activity className="h-3.5 w-3.5" />,
      onSelect: () => {
        closeMenu();
        setActivityOpen((open) => !open);
      },
    },
    ...(onSign
      ? [
          {
            id: "sign",
            label: "Sign and publish…",
            icon: <PenLine className="h-3.5 w-3.5" />,
            onSelect: () => {
              closeMenu();
              onSign(plugin);
            },
          },
        ]
      : []),
    {
      id: "uninstall",
      label: "Uninstall…",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      separatorBefore: true,
      onSelect: () => {
        closeMenu();
        onUninstall(plugin);
      },
    },
  ];

  return (
    <div className="rounded-xl border border-rim-line bg-rim-panel">
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rim-accent/10">
          <Puzzle className="h-[18px] w-[18px] text-rim-accent" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-rim-text">{plugin.display_name}</span>
            <span className="text-[11px] text-rim-text-faint">
              v{plugin.version}
              {plugin.author ? ` · ${plugin.author}` : ""}
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
          {plugin.description && (
            <p className="line-clamp-2 text-xs leading-relaxed text-rim-text-muted">
              {plugin.description}
            </p>
          )}
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            aria-label={`View details for ${name}`}
            className="self-start text-xs text-rim-accent hover:underline"
          >
            View details
          </button>
          <div className="flex flex-wrap gap-1.5">
            {trustChips(plugin).map((chip) => (
              <span
                key={chip.text}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
                  chip.warn
                    ? "bg-rim-warm/10 text-rim-warm"
                    : "bg-rim-panel-soft text-rim-text-muted",
                )}
              >
                {chip.icon}
                {chip.text}
              </span>
            ))}
          </div>
          {updateStatus && (
            <p className={cn("text-[11px]", noteTone[updateStatus.tone])} role="status">
              {updateStatus.text}
            </p>
          )}
          {plugin.enabled && plugin.last_error && (
            <p className="text-[11px] text-rim-danger" role="status">
              {plugin.last_error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
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

          <button
            type="button"
            onClick={() => onToggle(plugin)}
            disabled={blocked}
            className={cn(
              "relative ml-1.5 inline-flex h-5 w-9 items-center rounded-full transition",
              blocked && "cursor-not-allowed opacity-40",
            )}
            style={{
              backgroundColor: plugin.enabled ? "var(--color-rim-accent)" : "var(--color-rim-line)",
            }}
            title={toggleLabel(plugin, needsDesktop)}
            aria-label={toggleLabel(plugin, needsDesktop)}
          >
            <span
              className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
              style={{ transform: plugin.enabled ? "translateX(18px)" : "translateX(3px)" }}
            />
          </button>

          <button
            ref={moreRef}
            type="button"
            aria-label={`More actions for ${name}`}
            aria-haspopup="menu"
            aria-expanded={menuPosition !== null}
            onClick={() => {
              if (menuPosition) {
                closeMenu();
                return;
              }
              const rect = moreRef.current?.getBoundingClientRect();
              if (rect) setMenuPosition({ x: rect.right - 200, y: rect.bottom + 4 });
            }}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg text-rim-text-muted transition-colors hover:bg-white/5 hover:text-rim-text",
              menuPosition && "bg-white/5 text-rim-text",
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuPosition && (
            <DropdownMenu
              items={menuItems}
              position={menuPosition}
              onClose={closeMenu}
              label={`More actions for ${name}`}
              anchorRef={moreRef}
            />
          )}
        </div>
      </div>

      {activityOpen && <PluginAuditPanel plugin={plugin} />}

      {detailsOpen && <PluginDetailsDialog plugin={plugin} onClose={() => setDetailsOpen(false)} />}

      {/* Fingerprint-changed warning banner */}
      {plugin.fingerprint_changed && !warningDismissed && (
        <div className="border-t border-rim-warm/20 bg-rim-warm/5 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rim-warm" />
            <div className="flex-1">
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
    </div>
  );
}

/**
 * The switch's label and tooltip: why it is off-limits, or what clicking it does.
 *
 * @param plugin - The plugin the switch belongs to.
 * @param needsDesktop - Whether the plugin runs only in the desktop app.
 * @returns The text for the switch's `title` and `aria-label`.
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

// ─── Empty state ──────────────────────────────────────────────────────────────

/**
 * Empty state shown when no plugins are installed.
 *
 * Points the user to the install affordances above; on the desktop the copy
 * also says a marketplace is coming soon.
 */
function PluginEmptyState({ desktop }: { desktop: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <Puzzle className="h-8 w-8 text-rim-text-muted" />
      <p className="text-sm font-medium text-rim-text">No plugins installed</p>
      <p className="max-w-xs text-xs text-rim-text-muted">
        {desktop
          ? "Install from a local folder or git URL to get started. Marketplace coming soon."
          : "Install a web plugin from a link to get started. Plugins that run programs on your computer need the desktop app."}
      </p>
    </div>
  );
}

// ─── Desktop-only card ────────────────────────────────────────────────────────

/**
 * Placeholder card shown where no kind of plugin can run (`pluginHost` and
 * `webPlugins` both false, as on mobile). It points the user to the desktop
 * download.
 *
 * Detection goes through the runtime capability abstraction (`useRuntime`) rather
 * than branching on `import.meta.env.TAURI` directly, preserving the capability
 * layer as the single authoritative source of truth.
 */
export function PluginDesktopOnlyCard() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-rim-line bg-rim-panel p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rim-accent/10">
        <Monitor className="h-6 w-6 text-rim-accent" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-rim-text">Plugins require the desktop app</h3>
        <p className="max-w-xs text-xs text-rim-text-muted">
          This device cannot run plugins yet. Install the RIM desktop app, or use the web app on a
          computer for plugins that run sandboxed in the browser.
        </p>
      </div>
      <a
        href="https://rim.dev/download"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg border border-rim-accent/40 bg-rim-accent/10 px-3 py-1.5 text-xs font-medium text-rim-accent transition hover:bg-rim-accent/20"
      >
        Get the desktop app
      </a>
    </div>
  );
}
