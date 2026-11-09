import { ServerMemberRoleGql } from "../../core/graphql/generated/schema-types";
import type { WorkspaceInviteRow } from "./api/useWorkspaceInvites";

/** What an invite's role is called. */
export const ROLE_LABEL: Record<ServerMemberRoleGql, string> = {
  [ServerMemberRoleGql.OWNER]: "Owner",
  [ServerMemberRoleGql.MODERATOR]: "Moderator",
  [ServerMemberRoleGql.MEMBER]: "Member",
  [ServerMemberRoleGql.GUEST]: "Guest",
};

/** What the confirmation of revoking `invite` says: that nobody joins with it any more, and what happens to those who did. */
export function revokeInviteDescription(invite: WorkspaceInviteRow): string {
  const joined =
    invite.useCount === 1
      ? "The person who already joined with it stays."
      : invite.useCount > 1
        ? `The ${invite.useCount} people who already joined with it stay.`
        : "Nobody has joined with it yet.";
  return `Nobody can join with this ${ROLE_LABEL[invite.role].toLowerCase()} invite link any more. ${joined}`;
}
