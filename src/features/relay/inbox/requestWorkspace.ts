/**
 * Which workspace a DM request's conversation belongs to. The request names its host
 * (`hostServerId`, the server that sent its invite) and its held items carry the space of the
 * conversation; a space counts as a workspace only when this account knows it as one on that
 * same host, so a host cannot file a stranger's DM under a workspace it does not hold.
 */

import type { DmRequestView } from "../api/relayApi";
import type { SpaceRecord } from "../state/relayDb";

/** What the account knows about its spaces, to place a request. */
export interface KnownSpaces {
  /** This relay's server id; its own workspaces are hosted under it. */
  ownServerId: string | null;
  /** The workspaces this relay hosts that the account is in (its direct space left out). */
  localWorkspaceIds: ReadonlySet<string>;
  /** The spaces on other servers, each bound to its host. */
  spaces: Readonly<Record<string, Pick<SpaceRecord, "hostServerId" | "kind">>>;
}

/** The workspace of `request`'s conversation, or `null` for a DM from outside every workspace. */
export function requestWorkspaceId(request: DmRequestView, known: KnownSpaces): string | null {
  for (const item of request.heldItems) {
    if (item.hostServerId !== request.hostServerId) continue;
    const spaceId = item.workspaceId;
    if (request.hostServerId === known.ownServerId) {
      if (known.localWorkspaceIds.has(spaceId)) return spaceId;
      continue;
    }
    const space = known.spaces[spaceId];
    if (space?.kind === "workspace" && space.hostServerId === request.hostServerId) {
      return spaceId;
    }
  }
  return null;
}
