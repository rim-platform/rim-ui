import { useQuery } from "@tanstack/react-query";
import { gql } from "graphql-request";

import { graphqlClient } from "../../../core/graphql/client";
import { queryKeys } from "../../../core/query/keys";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { MEMBER_TIMEOUT_CHANGED, serverHasCapability } from "../../updater/api/serverCapabilities";

const MY_TIMEOUT_REASON = gql`
  query MyTimeoutReason($serverId: ID!) {
    serverMembers(serverId: $serverId) {
      userId
      timeoutReason
    }
  }
`;

/**
 * The reason a moderator gave for the viewer's timeout ending at `until` in `workspaceId`, read
 * while there is one; null without a reason, without a timeout, or from a server without
 * `member_timeout_changed`. A `MemberTimeoutChanged` event fills it without a request.
 */
export function useMyTimeoutReason(
  workspaceId: string | null | undefined,
  until: string | null,
): string | null {
  const ws = workspaceId ?? undefined;
  const userId = useAuthStore((s) => s.session?.userId);
  const { data } = useQuery({
    queryKey: queryKeys.myTimeoutReason(ws, until),
    enabled: Boolean(ws && until && userId),
    staleTime: Infinity,
    queryFn: async () => {
      if (!(await serverHasCapability(MEMBER_TIMEOUT_CHANGED))) return null;
      const res = await graphqlClient.request<{
        serverMembers: { userId: string; timeoutReason: string | null }[];
      }>(MY_TIMEOUT_REASON, { serverId: ws });
      return res.serverMembers.find((m) => m.userId === userId)?.timeoutReason ?? null;
    },
  });
  return data ?? null;
}
