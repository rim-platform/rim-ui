import { useEffect, useState } from "react";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  WorkspacePluginStatus,
  type SignedStatementInput,
} from "../../../../core/graphql/generated/schema-types";
import { graphqlErrorMessage } from "../../../../core/graphql/errors";
import { queryKeys } from "../../../../core/query/keys";
import { reportFeatureDisabled } from "../../../../core/query/queryClient";
import { toast } from "../../../../shared/toast";
import { Button } from "../../../../shared/ui/Button";
import { Dialog } from "../../../../shared/ui/Dialog";
import { signPluginManifest, verifyPluginManifest } from "../../../key-identity/api/keyBackend";
import { logStatements, type MyKeyIdentity } from "../../../key-identity/api/keyIdentity";
import type { PluginManifestStatement } from "../../../key-identity/browser/pluginManifest";
import { useCurrentUser } from "../../../workspaces/api/useCurrentUser";
import { useCanModerate } from "../../../workspaces/api/useMyServerRole";
import { useWorkspace } from "../../../workspaces/api/useWorkspace";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { useServerFeature } from "../../../updater/hooks/useServerFeature";
import type { PluginInfo } from "../../types";
import { useWorkspacePlugins } from "../api";
import { messageOf } from "../installer";
import { formatSize, statusWord } from "../model";
import { publishStatement } from "../publish";
import { signatureFileStem, writeSignatureFile } from "../signatureFile";
import {
  bundleBytes,
  exportSignature,
  pickSigningBundle,
  profileCardName,
  signingSourceOf,
  type SigningSource,
} from "../signing";

interface SignAndPublishDialogProps {
  plugin: PluginInfo;
  identity: MyKeyIdentity;
  onClose: () => void;
}

/** The source as a publisher compares it with what `rim-plugin-bundle` printed. */
function SourceSummary({ source }: { source: SigningSource }) {
  const signed = source.source;
  const kind = source.runtimeKind === "WebSandboxed" ? "Sandboxed" : "Runs on this computer";
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-rim-line bg-rim-void p-3 text-[11px]">
      <dt>Plugin</dt>
      <dd className="font-mono text-rim-text">{source.pluginId}</dd>
      <dt>Version</dt>
      <dd className="text-rim-text">{source.version}</dd>
      <dt>Kind</dt>
      <dd className="text-rim-text">{kind}</dd>
      {signed.kind === "bundle" ? (
        <>
          <dt>SHA-256</dt>
          <dd className="break-all font-mono text-rim-text">{signed.sha256}</dd>
          <dt>Size</dt>
          <dd className="text-rim-text">
            {signed.size} bytes ({formatSize(signed.size)})
          </dd>
        </>
      ) : (
        <>
          <dt>Repository</dt>
          <dd className="break-all text-rim-text">{signed.url}</dd>
          <dt>Commit</dt>
          <dd className="break-all font-mono text-rim-text">{signed.commit}</dd>
          <dt>Tree SHA-256</dt>
          <dd className="break-all font-mono text-rim-text">{signed.treeSha256}</dd>
        </>
      )}
    </dl>
  );
}

/**
 * "Sign and publish…": sign an installed plugin with this device's identity key, then publish
 * it to the current workspace (Owners and Moderators) or export a signature file for one.
 */
export function SignAndPublishDialog({ plugin, identity, onClose }: SignAndPublishDialogProps) {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  // Publishing needs the workspace registry on the server; a signature file does not.
  const registryOn = useServerFeature("workspace_plugins").enabled;
  const canPublish = useCanModerate(workspaceId ?? undefined) && registryOn;
  const { data: workspace } = useWorkspace(workspaceId ?? undefined);
  const { data: entries } = useWorkspacePlugins(workspaceId, canPublish);
  const { data: me } = useCurrentUser();
  const [source, setSource] = useState<SigningSource | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [publisherName, setPublisherName] = useState(
    () => profileCardName(identity) ?? me?.displayName ?? me?.username ?? "",
  );
  const [signed, setSigned] = useState<{
    statement: SignedStatementInput;
    verified: PluginManifestStatement;
  } | null>(null);
  const [status, setStatus] = useState(WorkspacePluginStatus.RECOMMENDED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    signingSourceOf(plugin.plugin_id).then(
      (built) => live && setSource(built),
      (err: unknown) => live && setSourceError(messageOf(err)),
    );
    return () => {
      live = false;
    };
  }, [plugin.plugin_id]);

  const keyLog = logStatements(identity.keyLog);
  const existing = entries?.find((e) => e.pluginId === source?.pluginId);

  async function pick() {
    setError(null);
    try {
      const picked = await pickSigningBundle();
      if (picked) {
        setSource(picked);
        setSourceError(null);
        setSigned(null);
      }
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function sign() {
    if (!source || !identity.principalId) return;
    setBusy(true);
    setError(null);
    try {
      const statement = await signPluginManifest(identity.principalId, keyLog, {
        publisherName,
        manifest: source.manifest,
        source: source.source,
      });
      const verified = await verifyPluginManifest(statement, keyLog);
      setSigned({ statement, verified: verified.statement });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!signed || !source || !workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      await publishStatement({
        serverId: workspaceId,
        statement: signed.statement,
        signed: signed.verified,
        status,
        publisherKeyLog: keyLog,
        bundle: bundleBytes(source),
        existing,
      });
      await qc.invalidateQueries({ queryKey: queryKeys.workspacePlugins(workspaceId) });
      toast.success(`Published ${source.displayName} ${source.version} to ${workspace?.name}`);
      onClose();
    } catch (err) {
      reportFeatureDisabled(err, qc);
      setError(graphqlErrorMessage(err, messageOf(err)));
    } finally {
      setBusy(false);
    }
  }

  async function exportFile() {
    if (!signed || !source) return;
    setBusy(true);
    setError(null);
    try {
      const path = await exportSignature(
        signatureFileStem(source.pluginId, source.version),
        writeSignatureFile({ statement: signed.statement, publisherKeyLog: keyLog }),
        source.bundlePath === null ? source.bundle : null,
        source.bundlePath,
      );
      if (path) {
        toast.success("Signature saved", { description: path });
        onClose();
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Sign ${plugin.display_name}`} maxWidth="max-w-lg">
      <div className="space-y-3 text-xs text-rim-text-muted">
        {source ? (
          <SourceSummary source={source} />
        ) : sourceError ? (
          <p className="text-rim-danger" role="alert">
            {sourceError}
          </p>
        ) : (
          <p className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing the plugin…
          </p>
        )}
        <Button variant="ghost" size="sm" onClick={() => void pick()} disabled={busy}>
          <FileUp className="mr-1.5 h-3.5 w-3.5" />
          Sign another .rimbundle…
        </Button>

        <label className="block space-y-1">
          <span>Publisher name, shown with your key&apos;s id</span>
          <input
            type="text"
            value={publisherName}
            maxLength={80}
            onChange={(e) => {
              setPublisherName(e.target.value);
              setSigned(null);
            }}
            className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-1.5 text-sm text-rim-text focus:border-rim-accent focus:outline-none"
            aria-label="Publisher name"
          />
        </label>

        {signed ? (
          <p className="flex items-center gap-1.5 text-rim-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Signed with your identity key and verified.
          </p>
        ) : (
          <div className="flex justify-end">
            <Button
              size="sm"
              isLoading={busy}
              disabled={!source || !publisherName.trim()}
              onClick={() => void sign()}
            >
              Sign
            </Button>
          </div>
        )}

        {signed && canPublish && workspaceId && (
          <div className="space-y-2 border-t border-rim-line pt-3">
            {existing && (
              <p>
                Replaces {existing.version} signed by {existing.publisherName}
              </p>
            )}
            <label className="flex items-center gap-2">
              <span>Status in {workspace?.name ?? "this workspace"}</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkspacePluginStatus)}
                className="rounded border border-rim-line bg-rim-void px-2 py-1 text-rim-text"
                aria-label="Status"
              >
                {[WorkspacePluginStatus.RECOMMENDED, WorkspacePluginStatus.REQUIRED].map((s) => (
                  <option key={s} value={s}>
                    {statusWord(s)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void exportFile()}
                disabled={busy}
              >
                Export…
              </Button>
              <Button size="sm" isLoading={busy} onClick={() => void publish()}>
                Publish
              </Button>
            </div>
          </div>
        )}
        {signed && !canPublish && (
          <div className="space-y-2 border-t border-rim-line pt-3">
            <p>
              Only a workspace&apos;s Owners and Moderators publish plugins. Export the signature
              and send it, with the bundle, to one of them.
            </p>
            <div className="flex justify-end">
              <Button size="sm" isLoading={busy} onClick={() => void exportFile()}>
                Export…
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p className="text-rim-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
