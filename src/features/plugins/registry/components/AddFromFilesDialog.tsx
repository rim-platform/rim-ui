import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  WorkspacePluginStatus,
  type SignedStatementInput,
} from "../../../../core/graphql/generated/schema-types";
import { queryKeys } from "../../../../core/query/keys";
import { toast } from "../../../../shared/toast";
import { Button } from "../../../../shared/ui/Button";
import { Dialog } from "../../../../shared/ui/Dialog";
import type { PluginManifestStatement } from "../../../key-identity/browser/pluginManifest";
import type { RegistryEntry } from "../api";
import { messageOf } from "../installer";
import { publisherOf, sourceLine, statusWord } from "../model";
import { publishStatement } from "../publish";
import { readSignatureFile } from "../signatureFile";
import {
  checkBundleBytes,
  publisherKeyLog,
  PUBLISHER_RECOVERED_TEXT,
  verifyStatement,
} from "../verify";
import { TrustBadge } from "./TrustBadge";

interface AddFromFilesDialogProps {
  serverId: string;
  workspaceName: string;
  entries: readonly RegistryEntry[];
  memberNames: ReadonlyMap<string, string>;
  /** The entry whose statement is replaced; any plugin id when absent. */
  replacing?: RegistryEntry;
  onClose: () => void;
}

interface Checked {
  statement: SignedStatementInput;
  signed: PluginManifestStatement;
  publisherKeyLog: SignedStatementInput[];
  bundle?: Uint8Array;
}

async function readFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * "Add from files": a `.rimsig.json` and, for a bundle source, its `.rimbundle`, verified on
 * this device as any client verifies an entry, then uploaded and added (or replacing an entry
 * of the same plugin id).
 */
export function AddFromFilesDialog({
  serverId,
  workspaceName,
  entries,
  memberNames,
  replacing,
  onClose,
}: AddFromFilesDialogProps) {
  const qc = useQueryClient();
  const [signature, setSignature] = useState<File | null>(null);
  const [bundle, setBundle] = useState<File | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [status, setStatus] = useState(replacing?.status ?? WorkspacePluginStatus.RECOMMENDED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    if (!signature) return;
    setBusy(true);
    setError(null);
    setChecked(null);
    try {
      const file = readSignatureFile(await signature.text());
      const principalId = (JSON.parse(file.statement.payload) as { principalId?: unknown })
        .principalId;
      if (typeof principalId !== "string") throw new Error("The statement names no publisher.");
      const log = await publisherKeyLog(principalId, file.publisherKeyLog);
      const verified = await verifyStatement(file.statement, log);
      if (verified.validity.status !== "valid") throw new Error(PUBLISHER_RECOVERED_TEXT);
      if (replacing && verified.statement.pluginId !== replacing.pluginId) {
        throw new Error(
          `This statement is for ${verified.statement.pluginId}, not ${replacing.pluginId}.`,
        );
      }
      let bytes: Uint8Array | undefined;
      if (verified.statement.source.kind === "bundle") {
        if (!bundle) throw new Error("Choose the plugin's .rimbundle too.");
        bytes = await readFile(bundle);
        await checkBundleBytes(verified.statement, bytes);
      }
      setChecked({
        statement: file.statement,
        signed: verified.statement,
        publisherKeyLog: file.publisherKeyLog,
        bundle: bytes,
      });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const existing = checked
    ? entries.find((e) => e.pluginId === checked.signed.pluginId)
    : undefined;

  async function publish() {
    if (!checked) return;
    setBusy(true);
    setError(null);
    try {
      await publishStatement({ serverId, status, existing, ...checked });
      await qc.invalidateQueries({ queryKey: queryKeys.workspacePlugins(serverId) });
      toast.success(`${existing ? "Updated" : "Added"} ${checked.signed.displayName}`);
      onClose();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const fileInput =
    "block w-full text-xs text-rim-text-muted file:mr-3 file:rounded file:border file:border-rim-line file:bg-rim-void file:px-2 file:py-1 file:text-rim-text";

  return (
    <Dialog
      open
      onClose={onClose}
      title={replacing ? `Update ${replacing.displayName}` : "Add a plugin from files"}
      maxWidth="max-w-md"
    >
      <div className="space-y-3 text-xs text-rim-text-muted">
        <label className="block space-y-1">
          <span>Signature (.rimsig.json)</span>
          <input
            type="file"
            accept=".json,application/json"
            className={fileInput}
            aria-label="Signature file"
            onChange={(e) => {
              setSignature(e.target.files?.[0] ?? null);
              setChecked(null);
            }}
          />
        </label>
        <label className="block space-y-1">
          <span>Bundle (.rimbundle), for a plugin that comes as one</span>
          <input
            type="file"
            accept=".rimbundle"
            className={fileInput}
            aria-label="Bundle file"
            onChange={(e) => {
              setBundle(e.target.files?.[0] ?? null);
              setChecked(null);
            }}
          />
        </label>
        {!checked && (
          <div className="flex justify-end">
            <Button size="sm" isLoading={busy} disabled={!signature} onClick={() => void verify()}>
              Verify
            </Button>
          </div>
        )}
        {checked && (
          <div className="space-y-2 rounded-md border border-rim-line bg-rim-void p-3">
            <p className="text-sm text-rim-text">
              {checked.signed.displayName} {checked.signed.version}
            </p>
            <TrustBadge
              publisher={publisherOf(
                checked.signed.principalId,
                checked.signed.publisherName,
                memberNames,
              )}
            />
            <p className="font-mono text-[11px]">{sourceLine(checked.signed.source)}</p>
            {existing && (
              <p>
                Replaces {existing.version} signed by {existing.publisherName}
              </p>
            )}
            <label className="flex items-center gap-2">
              <span>Status in {workspaceName}</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkspacePluginStatus)}
                className="rounded border border-rim-line bg-rim-panel px-2 py-1 text-rim-text"
                aria-label="Status"
              >
                {[WorkspacePluginStatus.RECOMMENDED, WorkspacePluginStatus.REQUIRED].map((s) => (
                  <option key={s} value={s}>
                    {statusWord(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {error && (
          <p className="text-rim-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {checked && (
            <Button size="sm" isLoading={busy} onClick={() => void publish()}>
              {existing ? "Update" : "Add"}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
