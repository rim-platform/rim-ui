/**
 * What the cache needs, besides a feed page, to decrypt the page's encrypted conversations:
 * their Commits from the group's local epoch on, and the root message of every thread a reply
 * belongs to. Fetched before the page is handed to the cache, so a page rarely stops.
 */

import type { MessageItem } from "../../../core/types/messages";
import type {
  CacheAccount,
  FeedConversationChanges,
  MlsSyncInput,
} from "../../messages/api/messageCache";
import { fetchCommits, fetchThreadRoot } from "../api/e2eeApi";
import { e2eeCommands } from "../api/e2eeCommands";

/** Thread id to root message id; a thread's root never changes. */
const threadRoots = new Map<string, string>();

/** Conversations whose server group this device is known not to be in, by incarnation. */
const absent = new Map<string, number>();

/** Note that the server's group of `incarnation` does not hold this device. */
export function noteAbsentFromGroup(conversationId: string, incarnation: number) {
  absent.set(conversationId, incarnation);
}

export function forgetAbsence(conversationId: string) {
  absent.delete(conversationId);
}

function isEncrypted(message: MessageItem): boolean {
  return Boolean(message.encryption);
}

export async function mlsInputsFor(
  account: CacheAccount,
  workspaceId: string,
  changes: FeedConversationChanges[],
): Promise<MlsSyncInput[]> {
  const ids = changes.map((c) => c.conversationId);
  if (ids.length === 0) return [];
  const groups = await e2eeCommands.status(account, workspaceId, ids).catch(() => []);
  const byId = new Map(groups.map((g) => [g.conversationId, g]));

  const inputs: MlsSyncInput[] = [];
  for (const conversation of changes) {
    const encrypted = conversation.changes.filter((c) => isEncrypted(c.message));
    const group = byId.get(conversation.conversationId);
    const holdsGroup = Boolean(group?.hasGroup && group.incarnation > 0);
    if (encrypted.length === 0 && !holdsGroup) continue;

    const input: MlsSyncInput = {
      conversationId: conversation.conversationId,
      commits: [],
      threadRoots: {},
    };
    const missingIncarnation = absent.get(conversation.conversationId);
    if (missingIncarnation !== undefined) {
      input.inGroup = false;
      input.serverIncarnation = missingIncarnation;
    }
    if (group && holdsGroup && group.epoch !== null) {
      const commits = await fetchCommits(
        workspaceId,
        conversation.conversationId,
        group.incarnation,
        group.epoch,
      );
      input.commits = commits.map(({ incarnation, epoch, message }) => ({
        incarnation,
        epoch,
        message,
      }));
    }
    for (const change of encrypted) {
      const threadId = change.message.threadId;
      if (!threadId) continue;
      let root = threadRoots.get(threadId);
      if (!root) {
        root =
          (await fetchThreadRoot(workspaceId, conversation.conversationId, threadId).catch(
            () => null,
          )) ?? undefined;
        if (root) threadRoots.set(threadId, root);
      }
      if (root) input.threadRoots[threadId] = root;
    }
    inputs.push(input);
  }
  return inputs;
}
