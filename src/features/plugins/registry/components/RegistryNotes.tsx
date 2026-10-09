import { WorkspacePluginStatus } from "../../../../core/graphql/generated/schema-types";
import { Button } from "../../../../shared/ui/Button";
import { useWorkspaceStore } from "../../../workspaces/state/useWorkspaceStore";
import { useRegistryItems } from "../hooks";
import { statusWord } from "../model";
import { useRegistryStore } from "../state";
import { PUBLISHER_RECOVERED_TEXT } from "../verify";

/**
 * What Settings > Plugins says about the open workspace's registry: required plugins this
 * device has not installed, and installed ones whose publisher recovered their key.
 */
export function RegistryNotes() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const { items, workspaceName } = useRegistryItems(workspaceId);
  const notes = items.filter(
    (item) =>
      (item.check.entry.status === WorkspacePluginStatus.REQUIRED &&
        item.state.kind !== "installed") ||
      (item.state.kind === "installed" && item.check.ok && item.check.validity.status !== "valid"),
  );
  if (notes.length === 0) return null;
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-rim-text">{workspaceName}&apos;s plugins</h2>
      {notes.map((item) => {
        const entry = item.check.entry;
        const recovered = item.state.kind === "installed";
        return (
          <div
            key={entry.pluginId}
            className="flex items-center gap-3 rounded-lg border border-rim-line bg-rim-void px-4 py-2 text-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-rim-text">{entry.displayName}</p>
              <p className={recovered ? "text-rim-warm" : "text-rim-text-muted"}>
                {recovered
                  ? PUBLISHER_RECOVERED_TEXT
                  : `${statusWord(entry.status)} by ${workspaceName}, not installed`}
              </p>
            </div>
            {!recovered && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  useRegistryStore.getState().openInstall(entry.serverId, entry.pluginId)
                }
              >
                Review
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
