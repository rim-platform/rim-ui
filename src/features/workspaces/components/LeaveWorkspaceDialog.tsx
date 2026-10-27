import { toast } from "../../../shared/toast";
import { useLeaveWorkspaceMutation } from "../api/useWorkspaceMembership";
import { ModerationDialog } from "./ModerationDialog";

interface LeaveWorkspaceDialogProps {
  workspaceId: string;
  name: string;
  onClose: () => void;
}

/** Confirms leaving a workspace; the server's refusal shows in the dialog. */
export function LeaveWorkspaceDialog({ workspaceId, name, onClose }: LeaveWorkspaceDialogProps) {
  const leave = useLeaveWorkspaceMutation();
  return (
    <ModerationDialog
      title={`Leave ${name}?`}
      description="You leave its channels and conversations and stop getting its messages. What you wrote stays. To come back you need a new invite."
      tone="danger"
      confirmLabel="Leave workspace"
      errorFallback="Could not leave the workspace"
      onConfirm={() => leave.mutateAsync({ serverId: workspaceId })}
      onDone={() => {
        onClose();
        toast.success(`You left ${name}`);
      }}
      onClose={onClose}
    />
  );
}
