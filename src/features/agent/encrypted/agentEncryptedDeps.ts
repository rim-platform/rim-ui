// The app behind the agent's encrypted-conversation tools: the device's local
// messages (the desktop's cache, or a set-up browser's encrypted store), the
// person's switch per conversation, the encrypted send path, and the upgrade of
// a conversation the agent created.

import { detectPlatform } from "../../../core/runtime/runtime";
import { upgradeNewConversation } from "../../e2ee/runtime/upgrade";
import { e2eeSession } from "../../e2ee/runtime/session";
import { chatCache, conversationEncrypted, postAsUser } from "../../plugins/chat/appMessageService";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { agentAllowedIn } from "../state/useAgentEncryptedStore";
import { confirmEncryptedPost, type EncryptedToolDeps } from "./encryptedTools";

const desktop = () => detectPlatform() === "desktop";

export const agentEncryptedDeps: EncryptedToolDeps = {
  workspaceId: () => useWorkspaceStore.getState().workspaceId,
  encrypted: conversationEncrypted,
  allowed: agentAllowedIn,
  list: async (workspaceId, conversationId, limit) =>
    (await chatCache()?.list(workspaceId, conversationId, null, limit, {
      encryptedAllowed: true,
      knownEncrypted: [conversationId],
    })) ?? null,
  search: async (workspaceId, query, conversationId, limit) =>
    (await chatCache()?.search(workspaceId, query, conversationId, limit, {
      encryptedAllowed: true,
      knownEncrypted: conversationId ? [conversationId] : [],
    })) ?? [],
  post: postAsUser,
  confirmPost: confirmEncryptedPost,
  // Only a desktop upgrades a conversation; a browser leaves it plaintext for one to find.
  async upgrade(workspaceId, conversationId) {
    if (!desktop()) return;
    const session = await e2eeSession();
    if (session) await upgradeNewConversation(session, workspaceId, conversationId);
  },
};
