import { useState } from "react";

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
  const known = servers?.find((s) => s.id === workspaceId)?.name ?? remoteName;
  // Keeps the last known name while a leave drops the workspace from the lists.
  const [name, setName] = useState(known);
  if (known && known !== name) setName(known);
  const props = { workspaceId, name: name ?? "this workspace", onClose };
  return kind === "leave" ? (
    <LeaveWorkspaceDialog {...props} />
  ) : (
    <RenameWorkspaceDialog {...props} />
  );
}
