import { ServerFeatureState } from "../../core/graphql/generated/schema-types";
import { queryKeys } from "../../core/query/keys";
import { queryClient } from "../../core/query/queryClient";
import { isDirectSpace, useIsDirectSpace } from "../relay/state/useRelayStore";
import { INCOMING_WEBHOOKS, hasCapability } from "../updater/api/serverCapabilities";
import type { KnownServerInfo } from "../updater/api/serverInfoApi";
import { useServerInfo } from "../updater/hooks/useServerInfo";
import { useCanModerate } from "../workspaces/api/useMyServerRole";
import type { ServerDetail } from "../workspaces/api/useWorkspace";
import { canModerate } from "../workspaces/role";
import type { ServerMemberRoleGql } from "../../core/graphql/generated/schema-types";

/** What decides whether Settings > Bots is offered. */
export interface BotsAvailabilityFacts {
  /** The viewer's role in the workspace; undefined while it loads. */
  role: ServerMemberRoleGql | null | undefined;
  inDirectSpace: boolean;
  /** The connected server's server info; undefined while unknown. */
  info: KnownServerInfo | undefined;
}

/** Whether the server lists the `bots` feature, and as enabled; a server that does not list it has no bots. */
export function botsFeatureEnabled(info: KnownServerInfo | undefined): boolean {
  return (
    info?.features?.find((feature) => feature.key === "bots")?.state === ServerFeatureState.ENABLED
  );
}

/** Whether the server has incoming webhooks. */
export function webhooksAvailable(info: KnownServerInfo | undefined): boolean {
  return botsFeatureEnabled(info) && hasCapability(info, INCOMING_WEBHOOKS);
}

/** Owners and Moderators of a workspace on a server that lists `bots` as enabled. */
export function canManageBots({ role, inDirectSpace, info }: BotsAvailabilityFacts): boolean {
  return canModerate(role) && !inDirectSpace && botsFeatureEnabled(info);
}

/** {@link canManageBots} for the open workspace, as the hooks of a settings page read it. */
export function useCanManageBots(workspaceId: string | null | undefined): boolean {
  const { info } = useServerInfo();
  const inDirectSpace = useIsDirectSpace(workspaceId ?? null);
  const moderates = useCanModerate(workspaceId ?? undefined);
  return moderates && !inDirectSpace && botsFeatureEnabled(info);
}

/** {@link canManageBots} for `workspaceId`, read from the cached role and server info. */
export function botsOfferedFor(workspaceId: string | null): boolean {
  if (!workspaceId) return false;
  return canManageBots({
    role: queryClient.getQueryData<ServerDetail>(queryKeys.server(workspaceId))?.viewerRole,
    inDirectSpace: isDirectSpace(workspaceId),
    info: queryClient.getQueryData<KnownServerInfo>(queryKeys.serverInfo),
  });
}
