/** What an agent's read grants cover. Pure: the channel is looked up by the caller. */

/** One agent's grants, by workspace. */
export interface AgentGrants {
  [workspaceId: string]: { all: boolean; channelIds: string[] };
}

/** What a grant needs to know about a conversation. */
export interface GrantChannel {
  id: string;
  /** Whether it is a channel, as opposed to a direct message or a group. */
  isChannel: boolean;
  encrypted: boolean;
}

function grantIn(grants: AgentGrants, workspaceId: string) {
  return Object.prototype.hasOwnProperty.call(grants, workspaceId) ? grants[workspaceId] : null;
}

/** @returns Whether the agent has any grant in the workspace. */
export function hasGrantIn(grants: AgentGrants, workspaceId: string): boolean {
  const grant = grantIn(grants, workspaceId);
  return grant !== null && (grant.all || grant.channelIds.length > 0);
}

/**
 * Whether a grant could cover this id, before anything is known about the conversation.
 *
 * @returns `false` when no lookup is needed to refuse it.
 */
export function grantMayCover(
  grants: AgentGrants,
  workspaceId: string,
  channelId: string,
): boolean {
  const grant = grantIn(grants, workspaceId);
  return grant !== null && (grant.all || grant.channelIds.includes(channelId));
}

/**
 * Whether a grant covers this conversation. A direct message, a group and anything encrypted are
 * never covered, even by `all` or by being listed.
 *
 * @param channel - The conversation, or `null` when it could not be looked up.
 */
export function grantCovers(
  grants: AgentGrants,
  workspaceId: string,
  channel: GrantChannel | null,
): boolean {
  if (channel === null || !channel.isChannel || channel.encrypted) return false;
  return grantMayCover(grants, workspaceId, channel.id);
}
