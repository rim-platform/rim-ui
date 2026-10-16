/**
 * Creates the conversation of a draft direct message, as its first message is sent. The server
 * hands back the direct message with that person when there already is one.
 *
 * In a workspace, a new DM is encrypted whenever this device is ready; the other person joins
 * once they set up a device. An existing plaintext DM is upgraded only by a desktop, with both
 * people ready. In a relay's direct space the relay's rules apply. Either way the group exists
 * before this returns, so the first message can go out encrypted.
 */

import { queryClient } from "../../../core/query/queryClient";
import { queryKeys } from "../../../core/query/keys";
import type { DirectDraft } from "../../../shell/state/useShellStore";
import { allMembersReady, createGroup } from "../../e2ee/runtime/groups";
import { e2eeSession } from "../../e2ee/runtime/session";
import { isWebAccount } from "../../e2ee/web/webAccount";
import { startDirectConversation } from "../../relay/conversations/startDirect";
import { createConversation } from "./useCreateConversation";

/** The conversation a draft became. */
export interface StartedDirectMessage {
  /** The workspace or direct space it lives in. */
  workspaceId: string;
  conversationId: string;
  /** Whether its messages go through the encrypted path. */
  encrypted: boolean;
}

export async function startDirectMessage(draft: DirectDraft): Promise<StartedDirectMessage> {
  if ("spaceId" in draft) {
    const started = await startDirectConversation([draft.member]);
    if (started.group) await started.group;
    return {
      workspaceId: started.spaceId,
      conversationId: started.conversationId,
      encrypted: started.encrypted,
    };
  }

  const { workspaceId, otherUserId } = draft;
  const session = await e2eeSession();
  const base = { serverId: workspaceId, otherUserId };
  const created = await createConversation(session ? { ...base, encrypted: true } : base);
  let encrypted = Boolean(created.encryptedAt);
  if (session) {
    if (encrypted) {
      await createGroup(session, workspaceId, created.id);
    } else if (
      !isWebAccount(session.account) &&
      (await allMembersReady(session, workspaceId, [otherUserId]))
    ) {
      await createGroup(session, workspaceId, created.id);
      encrypted = true;
    }
  }
  await queryClient.invalidateQueries({ queryKey: queryKeys.conversations(workspaceId) });
  return { workspaceId, conversationId: created.id, encrypted };
}
