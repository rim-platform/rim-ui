import { useRelayStore } from "../../relay/state/useRelayStore";
import { useMyServers } from "../api/useMyServers";
import { useWorkspaceActionStore } from "../state/useWorkspaceActionStore";
import { LeaveWorkspaceDialog } from "./LeaveWorkspaceDialog";
import { RenameWorkspaceDialog } from "./RenameWorkspaceDialog";

/**
 * The leave or rename dialog `useWorkspaceActionStore` has open, for the rail's menu, Settings
 * and the palette alike. Mounted once in the app shell.
 */
export function WorkspaceActionDialogs() {
  const action = useWorkspaceActionStore((s) => s.action);
  const close = useWorkspaceActionStore((s) => s.close);
  if (!action) return null;
  return <OpenAction kind={action.kind} workspaceId={action.workspaceId} onClose={close} />;
}

function OpenAction({
  kind,
  workspaceId,
  onClose,
}: {
  kind: "leave" | "rename";
  workspaceId: string;
  onClose: () => void;
}) {
  const { data: servers } = useMyServers(false);
  const remoteName = useRelayStore((s) => s.spaces[workspaceId]?.name);
  const name = servers?.find((s) => s.id === workspaceId)?.name ?? remoteName ?? "this workspace";
  const props = { workspaceId, name, onClose };
  return kind === "leave" ? (
    <LeaveWorkspaceDialog {...props} />
  ) : (
    <RenameWorkspaceDialog {...props} />
  );
}
