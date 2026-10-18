import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../../core/query/keys";
import { Button } from "../../../../shared/ui/Button";
import { Dialog } from "../../../../shared/ui/Dialog";
import { reloadCommands } from "../../../commands/api/useCommands";
import { useMyServers } from "../../../workspaces/api/useMyServers";
import { KIND_CONSENT_TEXT } from "../../components/consentText";
import { PostInstallConsentDialog } from "../../components/PostInstallConsentDialog";
import { parsePostInstallConsent, type PostInstallConsentRequest } from "../../types";
import { refusalOf, usePluginPlatform, type RegistryItem } from "../hooks";
import { installEntry, messageOf } from "../installer";
import { sourceLine, statusWord } from "../model";
import { fetchEntryBundle, isInstallable } from "../verify";
import { TrustBadge } from "./TrustBadge";

interface RegistryInstallDialogProps {
  item: RegistryItem;
  workspaceName: string;
  onClose: () => void;
  /** Called with the plugin id once it is installed, so its permissions can be asked for. */
  onInstalled: (pluginId: string) => void;
}

/**
 * The install dialog of a registry entry: the trust badge, the workspace's status, the source,
 * what kind of plugin it is, and what this device already has. Its bundle is fetched and
 * checked before the person can install; the permission prompt follows the install, and a git
 * source's post-install steps ask for consent as for any git install.
 */
export function RegistryInstallDialog({
  item,
  workspaceName,
  onClose,
  onInstalled,
}: RegistryInstallDialogProps) {
  const qc = useQueryClient();
  const { platform } = usePluginPlatform();
  const { data: servers } = useMyServers();
  const check = item.check;
  const refusal = refusalOf(item);
  const [bundle, setBundle] = useState<{ bytes?: Uint8Array; error?: string } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<PostInstallConsentRequest | null>(null);

  const bundleSource = check.ok && check.statement.source.kind === "bundle";
  useEffect(() => {
    if (refusal !== null || !isInstallable(check) || !bundleSource) return;
    let live = true;
    fetchEntryBundle(check, platform).then(
      (bytes) => live && setBundle({ bytes }),
      (err: unknown) => live && setBundle({ error: messageOf(err) }),
    );
    return () => {
      live = false;
    };
  }, [check, refusal, bundleSource, platform]);

  const state = item.state;
  const replace = state.kind !== "notInstalled";
  const ready = refusal === null && (!bundleSource || bundle?.bytes !== undefined);

  async function install(allowPostInstall: boolean) {
    if (!isInstallable(check)) return;
    setInstalling(true);
    setError(null);
    try {
      const result = await installEntry(platform, check, {
        replace,
        allowPostInstall,
        bytes: bundle?.bytes,
      });
      await qc.invalidateQueries({ queryKey: queryKeys.plugins() });
      reloadCommands();
      onInstalled(result.plugin_id);
    } catch (err) {
      const request = allowPostInstall ? null : parsePostInstallConsent(err);
      if (request) setConsent(request);
      else setError(messageOf(err));
    } finally {
      setInstalling(false);
    }
  }

  const otherWorkspace =
    state.kind === "otherWorkspace"
      ? (servers?.find((s) => s.id === state.serverId)?.name ?? "another workspace")
      : null;
  const title =
    state.kind === "local"
      ? `Replace with ${workspaceName}'s signed version`
      : state.kind === "otherStatement"
        ? `Update ${check.entry.displayName}`
        : state.kind === "otherWorkspace"
          ? `Switch ${check.entry.displayName} to ${workspaceName}'s version`
          : `Install ${check.entry.displayName}`;
  const publisherChanged =
    (state.kind === "otherStatement" || state.kind === "otherWorkspace") && state.publisherChanged;

  return (
    <>
      <Dialog open onClose={onClose} title={title} maxWidth="max-w-md">
        <div className="space-y-3 text-xs text-rim-text-muted">
          <p className="text-sm text-rim-text">
            {check.entry.displayName} {check.entry.version}
          </p>
          <TrustBadge publisher={item.publisher} />
          <p>
            {statusWord(check.entry.status)} by {workspaceName}
          </p>
          {check.ok && (
            <p className="font-mono text-[11px]">{sourceLine(check.statement.source)}</p>
          )}
          {check.ok && (
            <p className="rounded-md border border-rim-line bg-rim-void px-3 py-2">
              {KIND_CONSENT_TEXT[check.manifest.runtime_kind]}
            </p>
          )}
          {state.kind === "installed" && <p>Installed.</p>}
          {otherWorkspace && <p>Installed from {otherWorkspace}. Switching verifies it again.</p>}
          {state.kind === "local" && (
            <p>An unsigned copy of this plugin is installed. It is replaced by the signed one.</p>
          )}
          {publisherChanged && (
            <p className="flex items-center gap-1.5 text-rim-warm" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Another publisher signed this version than the one installed.
            </p>
          )}
          {refusal !== null && (
            <p className="text-rim-danger" role="alert">
              {refusal}
            </p>
          )}
          {refusal === null && bundleSource && (
            <p className="flex items-center gap-1.5">
              {bundle === null ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching and checking the bundle…
                </>
              ) : bundle.error ? (
                <span className="text-rim-danger" role="alert">
                  {bundle.error}
                </span>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-rim-success" /> The bundle matches its
                  signature.
                </>
              )}
            </p>
          )}
          {error && (
            <p className="text-rim-danger" role="alert">
              {error}
            </p>
          )}
          <p className="text-[11px] text-rim-text-faint">
            You choose its permissions after it is installed.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {state.kind !== "installed" && (
              <Button
                size="sm"
                isLoading={installing}
                disabled={!ready}
                onClick={() => void install(false)}
              >
                {replace ? "Replace" : "Install"}
              </Button>
            )}
          </div>
        </div>
      </Dialog>
      {consent && (
        <PostInstallConsentDialog
          request={consent}
          isPending={installing}
          onConfirm={() => {
            setConsent(null);
            void install(true);
          }}
          onCancel={() => setConsent(null)}
        />
      )}
    </>
  );
}
