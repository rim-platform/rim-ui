import { useState, useCallback, useEffect } from "react";
import { Puzzle, Monitor, FolderOpen, GitBranch, AlertTriangle } from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import {
  useSettingsIntentStore,
  type PluginInstallSource,
} from "../../commands/state/useSettingsIntentStore";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useShellStore } from "../../../shell/state/useShellStore";
import { agentAvailable } from "../../agent/agentAvailability";
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
import { ExternalLink } from "../../auth/components/ExternalLink";
import { PluginCapabilityPrompt } from "./PluginCapabilityPrompt";
import { PluginRow, type RowNote } from "./PluginRow";
import { PluginSettingsDialog } from "./PluginSettingsDialog";
import { PostInstallConsentDialog } from "./PostInstallConsentDialog";
import { UninstallPluginDialog } from "./UninstallPluginDialog";
import { RegistryNotes } from "../registry/components/RegistryNotes";
import { SignAndPublishDialog } from "../registry/components/SignAndPublishDialog";
import { usePluginSigning } from "../registry/signing";
import { hasSettings } from "../pluginSettings";
import {
  missingCapabilities,
  parsePostInstallConsent,
  runtimeKind,
  type PluginInfo,
  type PluginUpdateResult,
  type PostInstallConsentRequest,
} from "../types";

/**
 * The plugin settings page. The desktop lists both kinds of plugin; the web,
 * which runs only WebSandboxed plugins, lists those and shows any local-process
 * entry as needing the desktop app.
 *
 * Surfaces:
 * - Install from local folder button (the desktop shell's folder dialog), desktop only
 * - Install from git URL button + text input, desktop only
 * - Install from link (a `.rimbundle` link pinned by its SHA-256), desktop and web
 * - List of installed plugins with enable/disable/uninstall + fingerprint trust action
 * - Settings on the row of a plugin that declares settings, opening its settings form; a
 *   `{ kind: "settings", tab: "plugins", plugin }` surface opens that plugin's form
 * - Update on the row of a plugin installed from a git URL, desktop only
 * - Empty state with onboarding copy when no plugins are installed
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
  // A plugin whose update asks for new permissions or new commands: its prompt opens on the
  // reloaded entry.
  const [updatedId, setUpdatedId] = useState<string | null>(null);
  const updatedPlugin = updatedId
    ? (plugins?.find((p) => p.plugin_id === updatedId) ?? null)
    : null;
  // A plugin turned on with its switch while some of its permissions are not granted.
  const [enablingId, setEnablingId] = useState<string | null>(null);
  const enablingPlugin = enablingId
    ? (plugins?.find((p) => p.plugin_id === enablingId) ?? null)
    : null;
  const promptTarget = permissionsTarget ?? installedPlugin ?? enablingPlugin ?? updatedPlugin;
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

  // Asks the desktop shell for a folder and installs the plugin in it; a cancelled dialog does nothing.
  const handleFolderPick = useCallback(async () => {
    const picked = await safeInvoke<string | null>("plugin_pick_folder");
    if (!picked.ok) {
      setInstallError(
        picked.error.kind === "ipc_unavailable"
          ? "Installing from a folder requires the desktop app."
          : picked.error.message,
      );
      return;
    }
    if (picked.value === null) return;
    setInstallError(null);
    installFromLocal.mutate(picked.value, {
      onSuccess: (result) => setInstalledId(result?.plugin_id ?? null),
      onError: (err) => {
        setInstallError("message" in err ? err.message : "Install failed");
      },
    });
  }, [installFromLocal]);

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
            // New permissions or new commands to run wait for the person in the prompt.
            if (result.added_capabilities.length > 0 || (result.added_commands ?? []).length > 0) {
              setUpdatedId(result.plugin_id);
            }
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
    } else if (missingCapabilities(plugin).length > 0) {
      // Turning it on asks first for the permissions it has not been granted.
      setEnablingId(plugin.plugin_id);
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

  const sandboxed = (plugins ?? []).filter((p) => runtimeKind(p) === "WebSandboxed");
  const localProcess = (plugins ?? []).filter((p) => runtimeKind(p) !== "WebSandboxed");
  const aiConsent = capabilities.pluginHost && capabilities.agent;

  function renderRow(plugin: PluginInfo) {
    return (
      <PluginRow
        key={plugin.plugin_id}
        plugin={plugin}
        needsDesktop={!desktop && runtimeKind(plugin) !== "WebSandboxed"}
        onToggle={handleToggle}
        onUninstall={handleUninstall}
        onPermissions={setPermissionsTarget}
        onSettings={
          hasSettings(plugin.settings_schema) ? () => setSettingsId(plugin.plugin_id) : undefined
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
        trustPending={trustFingerprint.isPending && trustFingerprint.variables === plugin.plugin_id}
        aiConsent={aiConsent}
        onOpenAgents={
          aiConsent && agentAvailable()
            ? () => setMainSurface({ kind: "settings", tab: "agents" })
            : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-rim-text">Plugins</h2>
        <p className="text-xs text-rim-text-muted">Your tools in the app.</p>
      </div>

      <PluginIntentRunner
        plugins={plugins ?? []}
        onToggle={handleToggle}
        onUninstall={handleUninstall}
        onUpdate={(pluginId) => runUpdate(pluginId, false)}
        onInstallFrom={(source) => {
          if (source === "folder") void handleFolderPick();
          else setGitUrlOpen(true);
        }}
        desktop={desktop}
      />

      <section aria-label="Add a plugin" className="space-y-3">
        <h3 className="text-sm font-medium text-rim-text">Add a plugin</h3>
        <div className="space-y-3 rounded-xl border border-rim-line bg-rim-panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            {desktop && (
              <>
                <Button
                  className="inline-flex items-center"
                  variant="secondary"
                  size="sm"
                  onClick={() => void runCommandFromClick("plugins.install", { source: "folder" })}
                  disabled={isInstalling}
                >
                  <FolderOpen className="mr-1.5 h-4 w-4" />
                  Install from local folder
                </Button>

                <Button
                  className="inline-flex items-center"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    gitUrlOpen
                      ? setGitUrlOpen(false)
                      : void runCommandFromClick("plugins.install", { source: "git" })
                  }
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
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                placeholder="https://github.com/user/my-rim-plugin"
                className="min-w-0 flex-1 rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-sm text-rim-text placeholder:text-rim-text-faint focus:border-rim-accent focus:outline-none"
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
        </div>
      </section>

      {/* Plugin groups or empty state */}
      {!plugins || plugins.length === 0 ? (
        <PluginEmptyState desktop={desktop} />
      ) : (
        <>
          {sandboxed.length > 0 && (
            <section aria-label="Sandboxed plugins" className="space-y-2">
              <div>
                <h3 className="text-sm font-medium text-rim-text">Sandboxed · desktop and web</h3>
                <p className="text-xs text-rim-text-muted">
                  Installing one gives it nothing until you grant it.
                </p>
              </div>
              <div className="space-y-2">{sandboxed.map(renderRow)}</div>
            </section>
          )}
          {localProcess.length > 0 && (
            <section aria-label="Local process plugins" className="space-y-2">
              <div>
                <h3 className="text-sm font-medium text-rim-text">Local process · this desktop</h3>
                <p className="text-xs text-rim-warm">
                  Runs as a program on this computer with your account&apos;s access, whatever you
                  approve below.
                </p>
              </div>
              <div className="space-y-2">{localProcess.map(renderRow)}</div>
            </section>
          )}
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
            setEnablingId(null);
            setUpdatedId(null);
          }}
          plugin={promptTarget}
          startOnApprove={
            permissionsTarget === null &&
            (promptTarget === installedPlugin || promptTarget === enablingPlugin)
          }
        />
      )}
    </div>
  );
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Carries out what a command asked of this page: starts installing from a folder or a git URL on
 * the desktop, else focuses the install choices, or runs the toggle, update or uninstall of a
 * chosen plugin as its row's own control does, with the same confirmation and permission prompts.
 */
function PluginIntentRunner({
  plugins,
  onToggle,
  onUninstall,
  onUpdate,
  onInstallFrom,
  desktop,
}: {
  plugins: PluginInfo[];
  onToggle: (plugin: PluginInfo) => void;
  onUninstall: (plugin: PluginInfo) => void;
  onUpdate: (pluginId: string) => void;
  onInstallFrom: (source: PluginInstallSource) => void;
  /** Whether this app runs local-process plugins: installs from folders and git, and updates. */
  desktop: boolean;
}) {
  const intent = useSettingsIntentStore((s) => s.intent);
  const clear = useSettingsIntentStore((s) => s.clear);
  useEffect(() => {
    if (intent?.kind !== "plugin") return;
    clear();
    if (intent.action === "install" && intent.source && desktop) {
      onInstallFrom(intent.source);
      return;
    }
    if (intent.action === "install") {
      document
        .querySelector<HTMLElement>(
          'section[aria-label="Add a plugin"] button, section[aria-label="Add a plugin"] input',
        )
        ?.focus();
      return;
    }
    const plugin = plugins.find((p) => p.plugin_id === intent.pluginId);
    if (!plugin) return;
    if (intent.action === "toggle") onToggle(plugin);
    else if (intent.action === "uninstall") onUninstall(plugin);
    else if (desktop && plugin.source?.kind === "git") onUpdate(plugin.plugin_id);
  }, [intent, clear, plugins, onToggle, onUninstall, onUpdate, onInstallFrom, desktop]);
  return null;
}

// ─── Update notes ─────────────────────────────────────────────────────────────

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

// ─── Empty state ──────────────────────────────────────────────────────────────

/**
 * Empty state shown when no plugins are installed.
 *
 * Points the user to the install affordances above; on the desktop the copy
 * also says a marketplace is coming soon.
 */
const OFFICIAL_PLUGINS_URL =
  "https://rim-platform.org/docs/client/plugins.html#the-official-plugins";

function PluginEmptyState({ desktop }: { desktop: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <Puzzle className="h-8 w-8 text-rim-text-muted" />
      <p className="text-sm font-medium text-rim-text">No plugins installed</p>
      <p className="max-w-xs text-xs text-rim-text-muted">
        {desktop
          ? "Install from a local folder or git URL to get started, or from a link or your workspace's registry."
          : "Install a web plugin from its link. Each plugin's release page lists one under Install from link. The official plugins are listed in "}
        {!desktop && (
          <>
            <ExternalLink
              href={OFFICIAL_PLUGINS_URL}
              className="text-rim-accent underline underline-offset-2"
            >
              the RIM guide
            </ExternalLink>
            . Plugins that run programs on your computer need the desktop app.
          </>
        )}
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
