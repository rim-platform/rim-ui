import { useId, useState } from "react";

import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { Button } from "../../../shared/ui/Button";
import { useAccountDeletionStatus } from "../../account-deletion/api/accountDeletion";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useIsOwner } from "../../workspaces/api/useMyServerRole";
import { useServerMembers, type ServerMember } from "../../workspaces/api/useServerMembers";
import { useWorkspace } from "../../workspaces/api/useWorkspace";
import {
  useDeleteWorkspaceMutation,
  useTransferOwnershipMutation,
} from "../../workspaces/api/useWorkspaceOwnership";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";

interface WorkspaceOwnerSettingsProps {
  serverId: string | null;
}

/**
 * Settings → Workspace, owner only: hand the workspace to another member, and delete it. Hidden
 * in the direct space, which can be neither, and on a server without these actions.
 */
export function WorkspaceOwnerSettings({ serverId }: WorkspaceOwnerSettingsProps) {
  const isOwner = useIsOwner(serverId ?? undefined);
  const { supported } = useAccountDeletionStatus();
  const inDirectSpace = useIsDirectSpace(serverId);
  const { data: workspace } = useWorkspace(serverId ?? undefined);
  if (!serverId || !workspace || !isOwner || !supported || inDirectSpace) return null;

  return (
    <section className="space-y-6" aria-labelledby="owner-heading">
      <div>
        <h2 id="owner-heading" className="text-base font-semibold text-rim-text">
          Ownership
        </h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          You own this workspace. Only the owner sees these actions.
        </p>
      </div>
      <TransferOwnership serverId={serverId} workspaceName={workspace.name} />
      <DeleteWorkspace serverId={serverId} workspaceName={workspace.name} />
    </section>
  );
}

function memberName(member: ServerMember): string {
  return member.displayName || member.username;
}

function TransferOwnership({
  serverId,
  workspaceName,
}: {
  serverId: string;
  workspaceName: string;
}) {
  const myId = useAuthStore((s) => s.session?.userId);
  const { data: members } = useServerMembers(serverId);
  const transfer = useTransferOwnershipMutation();
  const selectId = useId();
  const [pickedId, setPickedId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const candidates = (members ?? []).filter(
    (m) =>
      m.userId !== myId &&
      m.memberRole !== ServerMemberRoleGql.GUEST &&
      m.memberRole !== ServerMemberRoleGql.OWNER,
  );
  const picked = candidates.find((m) => m.userId === pickedId);

  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
      <h3 className="text-sm font-medium text-rim-text">Transfer ownership</h3>
      <p className="mt-1 text-xs text-rim-text-muted">
        The member you pick becomes the owner and you become a moderator. Guests cannot own a
        workspace.
      </p>
      {members && candidates.length === 0 ? (
        <p className="mt-2 text-sm text-rim-text-muted">
          No member can take over yet: only members and moderators can.
        </p>
      ) : (
        <div className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-rim-text">
              New owner
            </label>
            <select
              id={selectId}
              value={pickedId}
              onChange={(e) => setPickedId(e.target.value)}
              className="w-full rounded-md border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none focus:border-rim-accent"
            >
              <option value="">Pick a member</option>
              {candidates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {memberName(m)} (@{m.username})
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!picked}
            onClick={() => setConfirming(true)}
          >
            Transfer ownership
          </Button>
        </div>
      )}
      {confirming && picked && (
        <ModerationDialog
          title={`Make ${memberName(picked)} the owner?`}
          description={`${memberName(picked)} becomes the owner of ${workspaceName} and you become a moderator. Only the new owner can hand it back.`}
          tone="warm"
          chips={["OWNER"]}
          confirmLabel="Transfer"
          errorFallback="Could not transfer ownership"
          onConfirm={() => transfer.mutateAsync({ serverId, userId: picked.userId })}
          onDone={() => {
            setConfirming(false);
            setPickedId("");
            toast.success(`${memberName(picked)} now owns ${workspaceName}`);
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

function DeleteWorkspace({ serverId, workspaceName }: { serverId: string; workspaceName: string }) {
  const deleteWorkspace = useDeleteWorkspaceMutation();
  const inputId = useId();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === workspaceName;

  function close() {
    setConfirming(false);
    setTyped("");
  }

  return (
    <div className="rounded-lg border border-rim-danger/30 bg-rim-danger/5 p-4">
      <h3 className="text-sm font-medium text-rim-danger">Delete workspace</h3>
      <p className="mt-1 text-xs text-rim-text-muted">
        Deletes {workspaceName} for every member, with everything in it. This cannot be undone.
      </p>
      <div className="mt-3">
        <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
          Delete workspace
        </Button>
      </div>
      {confirming && (
        <ModerationDialog
          title={`Delete ${workspaceName}?`}
          description="Every member loses the workspace: its channels and conversations with their messages and files, invites, pins, workspace state, keybinds, pipelines, macros, plugins and custom emoji are deleted. This cannot be undone."
          tone="danger"
          chips={["DANGEROUS", "OWNER"]}
          confirmLabel="Delete workspace"
          confirmDisabled={!matches}
          errorFallback="Could not delete the workspace"
          onConfirm={() => deleteWorkspace.mutateAsync({ serverId, confirmName: typed.trim() })}
          onDone={() => {
            close();
            toast.success(`Deleted ${workspaceName}`);
          }}
          onClose={close}
        >
          <div>
            <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-rim-text">
              Type the workspace name, <span className="font-mono">{workspaceName}</span>, to
              confirm
            </label>
            <input
              id={inputId}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-danger"
            />
          </div>
        </ModerationDialog>
      )}
    </div>
  );
}
