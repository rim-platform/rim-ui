import { ServerMemberRoleGql } from "../../core/graphql/generated/schema-types";

/**
 * The workspace role ladder: Owner > Moderator > Member > Guest.
 *
 * These helpers only decide what the client renders. The server re-checks every rule and
 * answers `FORBIDDEN` (or `VALIDATION` for self-targeting) when the UI is out of date.
 */
export { ServerMemberRoleGql };

type MaybeRole = ServerMemberRoleGql | null | undefined;

export function isOwner(role: MaybeRole): boolean {
  return role === ServerMemberRoleGql.OWNER;
}

/** Owner and Moderator moderate the workspace. */
export function canModerate(role: MaybeRole): boolean {
  return role === ServerMemberRoleGql.OWNER || role === ServerMemberRoleGql.MODERATOR;
}

export function isGuest(role: MaybeRole): boolean {
  return role === ServerMemberRoleGql.GUEST;
}

/**
 * Whether `actorRole` may kick, ban or time out a member holding `targetRole`, mirroring the
 * server: only Owner and Moderator act; nobody targets the Owner; a Moderator cannot target
 * another Moderator. Targeting yourself is refused too, but that needs ids: see
 * {@link canTargetMember}.
 */
export function canTarget(actorRole: MaybeRole, targetRole: MaybeRole): boolean {
  if (!canModerate(actorRole) || !targetRole) return false;
  if (targetRole === ServerMemberRoleGql.OWNER) return false;
  if (actorRole === ServerMemberRoleGql.MODERATOR && targetRole === ServerMemberRoleGql.MODERATOR) {
    return false;
  }
  return true;
}

/** {@link canTarget}, plus never on yourself. */
export function canTargetMember(
  actor: { userId: string | null | undefined; role?: MaybeRole },
  target: { userId: string; role?: MaybeRole },
): boolean {
  if (!actor.userId || actor.userId === target.userId) return false;
  return canTarget(actor.role, target.role);
}

/**
 * The roles `actorRole` may give a member who holds `targetRole`, excluding the one they
 * already have. Owner: Moderator, Member or Guest (never Owner). Moderator: Member <-> Guest.
 */
export function assignableRoles(
  actorRole: MaybeRole,
  targetRole: MaybeRole,
): ServerMemberRoleGql[] {
  if (!canTarget(actorRole, targetRole)) return [];
  const ladder =
    actorRole === ServerMemberRoleGql.OWNER
      ? [ServerMemberRoleGql.MODERATOR, ServerMemberRoleGql.MEMBER, ServerMemberRoleGql.GUEST]
      : [ServerMemberRoleGql.MEMBER, ServerMemberRoleGql.GUEST];
  if (!ladder.includes(targetRole as ServerMemberRoleGql)) return [];
  return ladder.filter((role) => role !== targetRole);
}

const LABELS: Record<ServerMemberRoleGql, string> = {
  [ServerMemberRoleGql.OWNER]: "Owner",
  [ServerMemberRoleGql.MODERATOR]: "Moderator",
  [ServerMemberRoleGql.MEMBER]: "Member",
  [ServerMemberRoleGql.GUEST]: "Guest",
};

export function roleLabel(role: ServerMemberRoleGql): string {
  return LABELS[role];
}

/**
 * Parses the lowercase role name carried by the `MemberRoleChanged` event (`owner`,
 * `moderator`, `member`, `guest`). Unknown names give `undefined`.
 */
export function parseEventRole(name: string): ServerMemberRoleGql | undefined {
  const upper = name.toUpperCase();
  return (Object.values(ServerMemberRoleGql) as string[]).includes(upper)
    ? (upper as ServerMemberRoleGql)
    : undefined;
}
