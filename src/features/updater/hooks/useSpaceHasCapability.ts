import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../core/query/keys";
import { spaceHasCapability } from "../api/serverCapabilities";

/**
 * Whether the server that hosts `spaceId` lists `capability`, for a control that is offered only
 * there; false while it is unknown.
 *
 * @param spaceId - The workspace, or nothing while none is open.
 * @param capability - The capability's name.
 * @returns Whether the workspace's host lists it.
 */
export function useSpaceHasCapability(
  spaceId: string | null | undefined,
  capability: string,
): boolean {
  const { data } = useQuery({
    queryKey: queryKeys.spaceCapability(spaceId ?? undefined, capability),
    enabled: Boolean(spaceId),
    staleTime: 5 * 60 * 1000,
    queryFn: () => spaceHasCapability(spaceId!, capability),
  });
  return data ?? false;
}
