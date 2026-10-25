/**
 * The spaces this account uses on other servers, each bound to its host. A space id is bound
 * to one host for good: an id this relay uses for a space of its own, or that another host
 * already holds, is refused, so every entity keyed by space id stays unambiguous.
 */

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import { allRecords, putRecord, type SpaceRecord } from "./relayDb";
import { useRelayStore } from "./useRelayStore";

/** The key of this account's records: its relay endpoint and principal. */
export function accountKey(): string | null {
  const account = useRelayStore.getState().account;
  return account ? `${account.endpoint}|${account.principalId}` : null;
}

/** The spaces stored for `account`. */
export async function loadSpaces(account: string): Promise<SpaceRecord[]> {
  return (await allRecords<SpaceRecord>("spaces")).filter((s) => s.account === account);
}

function localSpaceIds(): Set<string> {
  const ids = new Set<string>();
  const info = useRelayStore.getState().info;
  if (info) ids.add(info.directSpaceId);
  const servers = queryClient.getQueryData<{ id: string }[]>(queryKeys.myServers()) ?? [];
  for (const server of servers) ids.add(server.id);
  return ids;
}

/**
 * This relay's server id when `spaceId` is one of its own spaces: its direct space or a
 * workspace of the signed-in account. `null` for any other space, or before the relay started.
 */
export function localSpaceHost(spaceId: string): string | null {
  const serverId = useRelayStore.getState().info?.serverId;
  return serverId && localSpaceIds().has(spaceId) ? serverId : null;
}

/**
 * Record that `spaceId` is hosted by `hostServerId`. Returns whether the space is (now) bound
 * to that host; `false` when the id belongs to this relay or another host.
 */
export async function registerSpace(
  spaceId: string,
  hostServerId: string,
  kind: SpaceRecord["kind"],
): Promise<boolean> {
  const state = useRelayStore.getState();
  const account = accountKey();
  if (!account || hostServerId === state.info?.serverId) return false;
  const known = state.spaces[spaceId];
  if (known) return known.hostServerId === hostServerId;
  if (localSpaceIds().has(spaceId)) return false;
  const space: SpaceRecord = { account, spaceId, hostServerId, kind };
  state.addSpace(space);
  await putRecord("spaces", space);
  return true;
}

/** The direct spaces this account uses: this relay's first, then those on other relays. */
export function directSpaceIds(): string[] {
  const { info, spaces } = useRelayStore.getState();
  const remote = Object.values(spaces)
    .filter((s) => s.kind === "direct")
    .map((s) => s.spaceId)
    .sort();
  return info ? [info.directSpaceId, ...remote] : remote;
}

/** The hosts of the spaces this account uses on other servers. */
export function remoteHosts(): string[] {
  const { spaces, forked } = useRelayStore.getState();
  return [...new Set(Object.values(spaces).map((s) => s.hostServerId))].filter(
    (host) => !forked.includes(host),
  );
}

/** Remember a workspace's name or owner, as its host answered them. */
export async function setSpaceDetails(
  spaceId: string,
  details: Partial<Pick<SpaceRecord, "name" | "ownerName">>,
): Promise<void> {
  const state = useRelayStore.getState();
  const known = state.spaces[spaceId];
  if (!known) return;
  const space = { ...known, ...details };
  if (space.name === known.name && space.ownerName === known.ownerName) return;
  state.addSpace(space);
  await putRecord("spaces", space);
}

/** The workspaces this account uses on other servers. */
export function remoteWorkspaces(): { workspaceId: string; host: string }[] {
  const { spaces, forked } = useRelayStore.getState();
  return Object.values(spaces)
    .filter((s) => s.kind === "workspace" && !forked.includes(s.hostServerId))
    .map((s) => ({ workspaceId: s.spaceId, host: s.hostServerId }));
}
