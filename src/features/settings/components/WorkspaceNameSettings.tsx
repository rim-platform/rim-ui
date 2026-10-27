import { Button } from "../../../shared/ui/Button";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useServerInfo } from "../../updater/hooks/useServerInfo";
import { useMyServerRole } from "../../workspaces/api/useMyServerRole";
import { useWorkspace } from "../../workspaces/api/useWorkspace";
import { useWorkspaceActionStore } from "../../workspaces/state/useWorkspaceActionStore";
import { canRenameWorkspace } from "../../workspaces/workspaceActions";

interface WorkspaceNameSettingsProps {
  serverId: string | null;
}

/**
 * Settings → Workspace, owner only: the workspace's name and a button for the rename dialog.
 * Hidden in the direct space and on a server without renaming.
 */
export function WorkspaceNameSettings({ serverId }: WorkspaceNameSettingsProps) {
  const role = useMyServerRole(serverId ?? undefined);
  const inDirectSpace = useIsDirectSpace(serverId);
  const { info } = useServerInfo();
  const { data: workspace } = useWorkspace(serverId ?? undefined);
  const offered = canRenameWorkspace({
    role,
    inDirectSpace,
    isDefault: false,
    capabilities: info?.capabilities,
  });
  if (!serverId || !workspace || !offered) return null;

  return (
    <section className="space-y-3" aria-labelledby="workspace-name-heading">
      <h2 id="workspace-name-heading" className="text-base font-semibold text-rim-text">
        Name
      </h2>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-rim-line bg-rim-panel p-4">
        <p className="min-w-0 truncate text-sm text-rim-text">{workspace.name}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => useWorkspaceActionStore.getState().open("rename", serverId)}
        >
          Rename…
        </Button>
      </div>
    </section>
  );
}
