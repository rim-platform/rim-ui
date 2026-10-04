import { ServerMemberRoleGql } from "../../../core/graphql/generated/schema-types";
import { useWorkspace } from "./useWorkspace";

/**
 * The current viewer's effective role in a server (`Server.viewerRole`), read off the
 * already-cached `server(serverId)` query — no extra round-trip.
 *
 * **Display/affordance gate only — never an authorization boundary.** Every mutation the
 * role gates (schedule/policy editing, ingest-token management, emoji deletion, …)
 * independently re-checks the role server-side; this hook only lets the client avoid
 * rendering controls the viewer can't use. See `docs/oncall-ui.md`.
 *
 * Returns `undefined` while the server query is loading/disabled.
 */
export function useMyServerRole(serverId?: string): ServerMemberRoleGql | undefined {
  const { data } = useWorkspace(serverId);
  return data?.viewerRole;
}

/** `true` when the viewer is Owner or Moderator — the gate for schedule/policy/override editing. */
export function useCanManageOnCall(serverId?: string): boolean {
  const role = useMyServerRole(serverId);
  return role === ServerMemberRoleGql.OWNER || role === ServerMemberRoleGql.MODERATOR;
}

/** `true` when the viewer is Owner — the gate for owner-only affordances (ingest tokens, B2). */
export function useIsOwner(serverId?: string): boolean {
  return useMyServerRole(serverId) === ServerMemberRoleGql.OWNER;
}
