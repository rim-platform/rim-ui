import { graphqlErrorMessage, isSchemaRefusal } from "../../../core/graphql/errors";
import { DmMembers, DmOutsideFloor } from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useIsOwner } from "../../workspaces/api/useMyServerRole";
import { useSetWorkspaceDmPolicy, useWorkspaceDmPolicy } from "../api/dmPolicy";
import { FLOOR_CHOICES, MEMBER_DEFAULT_CHOICES } from "../labels";
import { ChoiceGroup } from "./ChoiceGroup";

interface WorkspaceDmPolicySettingsProps {
  serverId: string | null;
}

/**
 * Settings → Workspace → Direct messages: the workspace's floor for DMs to its members from
 * people outside their workspaces, and its default for DMs between members. The Owner sets
 * them; anyone else sees them read-only. Hidden in a direct space, which has neither.
 */
export function WorkspaceDmPolicySettings({ serverId }: WorkspaceDmPolicySettingsProps) {
  const inDirectSpace = useIsDirectSpace(serverId);
  const isOwner = useIsOwner(serverId ?? undefined);
  const policy = useWorkspaceDmPolicy(inDirectSpace ? null : serverId);
  const save = useSetWorkspaceDmPolicy();
  if (!serverId || inDirectSpace) return null;
  // A server without the policy refuses the query: nothing to show.
  if (policy.isError && isSchemaRefusal(policy.error)) return null;
  const outsideFloor = policy.data?.outsideFloor ?? DmOutsideFloor.NONE;
  const memberDefault = policy.data?.memberDefault ?? DmMembers.DIRECT;

  function update(next: { outsideFloor: DmOutsideFloor; memberDefault: DmMembers }) {
    save.mutate(
      { workspaceId: serverId!, ...next },
      {
        onError: (err) =>
          toast.error(graphqlErrorMessage(err, "Could not save the workspace's DM policy")),
      },
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="workspace-dm-heading">
      <div>
        <h2 id="workspace-dm-heading" className="text-base font-semibold text-rim-text">
          Direct messages
        </h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          How DMs reach this workspace&apos;s members.{" "}
          {isOwner ? "Only you, the owner, change these." : "Only the owner changes these."}
        </p>
      </div>
      {policy.isPending && <p className="text-sm text-rim-text-muted">Loading…</p>}
      {policy.isError && (
        <p role="alert" className="text-sm text-rim-danger">
          {graphqlErrorMessage(policy.error, "Could not load the workspace's DM policy.")}
        </p>
      )}
      {policy.data && (
        <div className="space-y-6 rounded-lg border border-rim-line bg-rim-panel p-4">
          <ChoiceGroup
            legend="From outside the workspace"
            hint="DMs to members from people who share no workspace with them. Binds every member."
            choices={FLOOR_CHOICES}
            value={outsideFloor}
            disabled={!isOwner || save.isPending}
            onChange={(value) => update({ outsideFloor: value, memberDefault })}
          />
          <ChoiceGroup
            legend="Between members"
            hint="Applies to members who made no choice of their own. Owners and moderators always reach members directly."
            choices={MEMBER_DEFAULT_CHOICES}
            value={memberDefault}
            disabled={!isOwner || save.isPending}
            onChange={(value) => update({ outsideFloor, memberDefault: value })}
          />
        </div>
      )}
    </section>
  );
}
