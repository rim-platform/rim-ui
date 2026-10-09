// The app behind the agent's encrypted-conversation tools: the local cache, the
// person's switch per conversation, the encrypted send path, and the upgrade of
// a conversation the agent created.

import { detectPlatform } from "../../../core/runtime/runtime";
import { upgradeNewConversation } from "../../e2ee/runtime/upgrade";
import { e2eeSession } from "../../e2ee/runtime/session";
import {
  conversationEncrypted,
  desktopChatCache,
  postAsUser,
} from "../../plugins/chat/appMessageService";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { agentAllowedIn } from "../state/useAgentEncryptedStore";
import { confirmEncryptedPost, type EncryptedToolDeps } from "./encryptedTools";

const desktop = () => detectPlatform() === "desktop";

export const agentEncryptedDeps: EncryptedToolDeps = {
  workspaceId: () => useWorkspaceStore.getState().workspaceId,
  encrypted: conversationEncrypted,
  allowed: agentAllowedIn,
  list: (workspaceId, conversationId, limit) =>
    desktop()
      ? desktopChatCache.list(workspaceId, conversationId, null, limit, {
          encryptedAllowed: true,
          knownEncrypted: [conversationId],
        })
      : Promise.resolve(null),
  search: (workspaceId, query, conversationId, limit) =>
    desktop()
      ? desktopChatCache.search(workspaceId, query, conversationId, limit, {
          encryptedAllowed: true,
          knownEncrypted: conversationId ? [conversationId] : [],
        })
      : Promise.resolve([]),
  post: postAsUser,
  confirmPost: confirmEncryptedPost,
  // Only a desktop upgrades a conversation; a browser leaves it plaintext for one to find.
  async upgrade(workspaceId, conversationId) {
    if (!desktop()) return;
    const session = await e2eeSession();
    if (session) await upgradeNewConversation(session, workspaceId, conversationId);
  },
};
