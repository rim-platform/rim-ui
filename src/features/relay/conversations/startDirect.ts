/**
 * New DMs and groups in this relay's direct space, with members named by principal id: a
 * contact on another relay, or someone on this one. The relay fetches each member's identity
 * from their relays, so the app passes the relays their verified card lists.
 *
 * A conversation with someone on another relay is created end-to-end encrypted, which needs
 * every member, and this device, set up for encryption; without that it is not created. With
 * members on this relay alone, today's rule holds: encrypted when everyone is ready.
 */

import { logger } from "../../../core/logger";
import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import type { CreateConversationInput } from "../../../core/graphql/generated/schema-types";
import { createConversation } from "../../conversations/api/useCreateConversation";
import { createGroup } from "../../e2ee/runtime/groups";
import { e2eeSession } from "../../e2ee/runtime/session";
import { isWebAccount } from "../../e2ee/web/webAccount";
import { resolveIdentity } from "../contacts/identity";
import { serverOrigin } from "../state/serverOrigin";
import { useRelayStore } from "../state/useRelayStore";

/** Someone to start a conversation with. */
export interface DirectMember {
  principalId: string;
  /** Where to ask for their identity, as a contact or a link names it. */
  relayUrls: readonly string[];
  /** How the person knows them, for messages. */
  name: string;
}

/** A member on another relay cannot receive encrypted messages yet, so nothing was created. */
export class NotReadyError extends Error {
  readonly names: string[];

  constructor(names: string[]) {
    super(
      `${names.join(", ")} cannot receive encrypted messages yet: they need a device set up for encryption.`,
    );
    this.name = "NotReadyError";
    this.names = names;
  }
}

/**
 * A picked person as the server is told about them, and whether they can receive encrypted
 * messages.
 */
export interface ResolvedDirectMember {
  member: DirectMember;
  /** Their card's relays and the picked ones, else this server's origin. */
  relayUrls: string[];
  ready: boolean;
}

/** One person's verified identity: their card's relays and the picked ones, and readiness. */
async function resolveMember(member: DirectMember): Promise<ResolvedDirectMember> {
  const { identity, card } = await resolveIdentity(member.principalId, member.relayUrls);
  const relayUrls = [...new Set([...(card?.relays ?? []), ...member.relayUrls])];
  const ready = identity.devices.some((d) => d.mlsActive && !d.revocation);
  return { member, relayUrls, ready };
}

/** What the person is asked to wait for: who is not ready, and whether this device is not. */
export function notReadyNames(
  resolved: readonly ResolvedDirectMember[],
  deviceReady: boolean,
): string[] {
  const names = resolved.filter((r) => !r.ready).map((r) => r.member.name);
  return deviceReady ? names : [...names, "this device"];
}

/** Whether `member` has a device that can receive encrypted messages. */
export async function directMemberReady(member: DirectMember): Promise<boolean> {
  return (await resolveMember(member)).ready;
}

/** Resolves picked people: their verified identity, relays and readiness. */
export async function resolveDirectMembers(
  members: readonly DirectMember[],
): Promise<ResolvedDirectMember[]> {
  const here = await serverOrigin();
  return (await Promise.all(members.map(resolveMember))).map((r) =>
    r.relayUrls.length > 0 ? r : { ...r, relayUrls: [here] },
  );
}

/** A conversation started in this relay's direct space. */
export interface StartedDirect {
  spaceId: string;
  conversationId: string;
  /** Whether it is end-to-end encrypted, or becomes so once `group` settles. */
  encrypted: boolean;
  /** This device creating the conversation's group, when it does; failures are logged. */
  group: Promise<boolean> | null;
}

/**
 * Start a DM (one member) or a group (several) in this relay's direct space. `predecessor`
 * makes it the successor of a conversation whose home is gone. Returns where it lives.
 */
export async function startDirectConversation(
  members: readonly DirectMember[],
  predecessor?: { hostServerId: string; conversationId: string },
): Promise<StartedDirect> {
  const info = useRelayStore.getState().info;
  if (!info) throw new Error("This server does not relay messages.");
  const here = await serverOrigin();
  const resolved = await resolveDirectMembers(members);
  const session = await e2eeSession();
  const elsewhere = resolved.some((r) => !r.relayUrls.includes(here));
  const missing = notReadyNames(resolved, Boolean(session));
  if (elsewhere && missing.length > 0) throw new NotReadyError(missing);
  const encrypted = missing.length === 0;
  const input: CreateConversationInput = {
    serverId: info.directSpaceId,
    remoteMembers: resolved.map((r) => ({
      principalId: r.member.principalId,
      relayUrls: r.relayUrls,
    })),
    ...(encrypted ? { encrypted: true } : {}),
    ...(predecessor ? { predecessor } : {}),
  };
  const created = await createConversation(input);
  let group: Promise<boolean> | null = null;
  if (session && encrypted && (created.encryptedAt || !isWebAccount(session.account))) {
    group = createGroup(session, info.directSpaceId, created.id);
    group.catch((err: unknown) => logger.warn("[RIM:relay] creating the group failed:", err));
  }
  await queryClient.invalidateQueries({ queryKey: queryKeys.conversations(info.directSpaceId) });
  return {
    spaceId: info.directSpaceId,
    conversationId: created.id,
    encrypted: Boolean(created.encryptedAt) || group !== null,
    group,
  };
}
