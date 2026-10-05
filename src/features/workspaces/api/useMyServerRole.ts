import type { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { canModerate, isGuest, isOwner } from "../role";
import { useWorkspace } from "./useWorkspace";

/**
 * The current viewer's effective role in a server (`Server.viewerRole`), read off the
 * already-cached `server(serverId)` query — no extra round-trip.
 *
 * **Display/affordance gate only — never an authorization boundary.** Every mutation the
 * role gates (schedule/policy editing, ingest-token management, emoji deletion, moderation…)
 * independently re-checks the role server-side; this hook only lets the client avoid
 * rendering controls the viewer can't use. See `docs/oncall-ui.md`.
 *
 * Returns `undefined` while the server query is loading/disabled.
 */
export function useMyServerRole(serverId?: string): ServerMemberRoleGql | undefined {
  const { data } = useWorkspace(serverId);
  return data?.viewerRole;
}

/** `true` for the roles that moderate a workspace: Owner and Moderator. */
export function isModeratorRole(role: ServerMemberRoleGql | undefined): boolean {
  return canModerate(role);
}

/**
 * `true` when the viewer is Owner or Moderator — the gate for moderation affordances such as
 * archiving channels and removing other members from a conversation.
 */
export function useCanModerate(serverId?: string): boolean {
  return canModerate(useMyServerRole(serverId));
}

/** `true` when the viewer is Owner or Moderator — the gate for schedule/policy/override editing. */
export function useCanManageOnCall(serverId?: string): boolean {
  return useCanModerate(serverId);
}

/** `true` when the viewer is Owner — the gate for owner-only affordances (ingest tokens, B2). */
export function useIsOwner(serverId?: string): boolean {
  return isOwner(useMyServerRole(serverId));
}

/**
 * `true` once the viewer is known to be a Guest — the gate that hides browsing, channel
 * creation, invites and the member directory. `false` while the role is loading, so nothing
 * flickers away for ordinary members.
 */
export function useIsGuest(serverId?: string): boolean {
  return isGuest(useMyServerRole(serverId));
}
