import { useState } from "react";
import { FilePlus2, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { WorkspacePluginStatus } from "../../../../core/graphql/generated/schema-types";
import { graphqlErrorMessage } from "../../../../core/graphql/errors";
import { queryKeys } from "../../../../core/query/keys";
import { toast } from "../../../../shared/toast";
import { Button } from "../../../../shared/ui/Button";
import { Dialog } from "../../../../shared/ui/Dialog";
import { useCanModerate } from "../../../workspaces/api/useMyServerRole";
import { removeWorkspacePlugin, updateWorkspacePlugin, type RegistryEntry } from "../api";
import { useRegistryItems } from "../hooks";
import { sourceLine, statusWord } from "../model";
import { PUBLISHER_RECOVERED_TEXT } from "../verify";
import { AddFromFilesDialog } from "./AddFromFilesDialog";
import { TrustBadge } from "./TrustBadge";

/**
 * Workspace settings > Plugins, for Owners and Moderators: the registry with each entry's
 * verification on this device, its status, a new statement from files, and removal.
 */
export function WorkspacePluginSettings({ serverId }: { serverId: string | null }) {
  const qc = useQueryClient();
  const canManage = useCanModerate(serverId ?? undefined);
  const { items, members, workspaceName } = useRegistryItems(serverId);
  const entries = items.map((i) => i.check.entry);
  const [adding, setAdding] = useState<{ replacing?: RegistryEntry } | null>(null);
  const [removing, setRemoving] = useState<RegistryEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!serverId || !canManage) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.workspacePlugins(serverId) });

  async function setStatus(entry: RegistryEntry, status: WorkspacePluginStatus) {
    setBusy(entry.pluginId);
    try {
      await updateWorkspacePlugin({ serverId: entry.serverId, pluginId: entry.pluginId, status });
      await refresh();
    } catch (err) {
      toast.error(graphqlErrorMessage(err, "The status was not changed"));
    } finally {
      setBusy(null);
    }
  }

  async function remove(entry: RegistryEntry) {
    setBusy(entry.pluginId);
    try {
      await removeWorkspacePlugin(entry.serverId, entry.pluginId);
      await refresh();
      setRemoving(null);
    } catch (err) {
      toast.error(graphqlErrorMessage(err, "The plugin was not removed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-rim-text">Plugins</h2>
          <p className="text-xs text-rim-text-muted">
            Plugins {workspaceName} recommends or requires. Members are offered them with their
            publisher&apos;s signature; nothing installs without their consent.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setAdding({})}>
          <FilePlus2 className="mr-1.5 h-4 w-4" />
          Add from files
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-rim-text-muted">
          No plugins yet. Publish one from Settings &gt; Plugins on a desktop that holds your
          identity key, or add a signature file someone sent you.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const entry = item.check.entry;
            const recovered = item.check.ok && item.check.validity.status !== "valid";
            return (
              <li
                key={entry.pluginId}
                className="rounded-lg border border-rim-line bg-rim-void p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1 text-xs text-rim-text-muted">
                    <p className="text-sm text-rim-text">
                      {entry.displayName} {entry.version}
                      <span className="ml-2 font-mono text-[11px] text-rim-text-faint">
                        {entry.pluginId}
                      </span>
                    </p>
                    <TrustBadge publisher={item.publisher} />
                    {item.check.ok && (
                      <p className="font-mono text-[11px]">
                        {sourceLine(item.check.statement.source)}
                      </p>
                    )}
                    {!item.check.ok && (
                      <p className="text-rim-danger" role="alert">
                        Signature does not verify: {item.check.reason}
                      </p>
                    )}
                    {recovered && <p className="text-rim-warm">{PUBLISHER_RECOVERED_TEXT}</p>}
                    {entry.approvedBy && (
                      <p className="text-[11px] text-rim-text-faint">
                        Approved by {entry.approvedBy.displayName || entry.approvedBy.username}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={entry.status}
                      disabled={busy === entry.pluginId}
                      onChange={(e) =>
                        void setStatus(entry, e.target.value as WorkspacePluginStatus)
                      }
                      className="rounded border border-rim-line bg-rim-panel px-2 py-1 text-xs text-rim-text"
                      aria-label={`Status of ${entry.displayName}`}
                    >
                      {[WorkspacePluginStatus.RECOMMENDED, WorkspacePluginStatus.REQUIRED].map(
                        (s) => (
                          <option key={s} value={s}>
                            {statusWord(s)}
                          </option>
                        ),
                      )}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAdding({ replacing: entry })}
                    >
                      Update statement
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoving(entry)}
                      aria-label={`Remove ${entry.displayName}`}
                    >
                      <Trash2 className="h-4 w-4 text-rim-danger" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <AddFromFilesDialog
          serverId={serverId}
          workspaceName={workspaceName}
          entries={entries}
          members={members}
          replacing={adding.replacing}
          onClose={() => setAdding(null)}
        />
      )}
      {removing && (
        <Dialog open onClose={() => setRemoving(null)} title={`Remove ${removing.displayName}?`}>
          <div className="space-y-3 text-xs text-rim-text-muted">
            <p>
              Members who installed it have it stopped and are asked whether to remove it from their
              devices.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                isLoading={busy === removing.pluginId}
                onClick={() => void remove(removing)}
              >
                Remove
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
