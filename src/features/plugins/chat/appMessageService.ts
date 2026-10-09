// The message service wired to the app: the desktop's local cache through its
// plugin commands, or in the web app the browser's encrypted store; conversations
// from the query cache, the person's own send path, and each plugin's audit in the
// store that keeps its approvals.

import { graphqlClient } from "../../../core/graphql/client";
import { queryClient } from "../../../core/query/queryClient";
import { detectPlatform } from "../../../core/runtime/runtime";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { fetchConversation, findCachedConversation } from "../../conversations/api/useConversation";
import { fetchThreadRoot } from "../../e2ee/api/e2eeApi";
import { workspaceMembers } from "../../e2ee/runtime/members";
import { sendEncrypted } from "../../e2ee/runtime/send";
import type * as PluginViewModule from "../../e2ee/web/pluginView";
import { webStoreAccount, type WebAccount } from "../../e2ee/web/webAccount";
import { currentCacheAccount, trackConversation } from "../../messages/api/messageCache";
import { SEND_MESSAGE_MUTATION } from "../../messages/api/useMessages";
import { requestCacheSync } from "../../messages/runtime/messageCacheSync";
import { REPLY_TO_MESSAGE_MUTATION } from "../../threads/api/useReplyToMessage";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { browserPluginStore } from "../web/browserPluginStore";
import { provisionalPrincipalId } from "../web/principal";
import { ErrorCode, RpcError } from "../web/rpc";
import { mentionsForSend } from "./chatMentions";
import type { PluginChatMessage, PluginMessagePage } from "./chatTypes";
import { createMessageService, type ChatCache, type ChatPost } from "./messageService";

type PluginView = typeof PluginViewModule;

async function invokeOrThrow<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const result = await safeInvoke<T>(command, args);
  if (!result.ok) throw result.error;
  return result.value;
}

function account() {
  const current = currentCacheAccount();
  if (!current) {
    throw new RpcError(ErrorCode.INTERNAL_ERROR, "the local message cache is not open", {
      reason: "noCache",
    });
  }
  return current;
}

/** The desktop's cache, through the commands that return the plugin shape. */
export const desktopChatCache: ChatCache = {
  list: (workspaceId, conversationId, before, limit, scope) =>
    invokeOrThrow<PluginMessagePage | null>("message_cache_plugin_messages", {
      account: account(),
      workspaceId,
      conversationId,
      before,
      limit,
      scope,
    }),
  get: (workspaceId, messageId, scope) =>
    invokeOrThrow<PluginChatMessage | null>("message_cache_plugin_message", {
      account: account(),
      workspaceId,
      messageId,
      scope,
    }),
  search: (workspaceId, query, conversationId, limit, scope) =>
    invokeOrThrow<PluginChatMessage[]>("message_cache_plugin_search", {
      account: account(),
      workspaceId,
      query,
      conversationId,
      limit,
      scope,
    }),
  async follow(workspaceId, conversationId) {
    await trackConversation(account(), workspaceId, conversationId);
    requestCacheSync(workspaceId, [conversationId]);
  },
};

/**
 * The web app's encrypted store, once this browser is set up for encrypted conversations. It
 * keeps the conversations it follows (those opened, and those a plugin asks for), and answers
 * in the desktop cache's plugin shape; search is a substring match over the stored rows.
 */
export function webChatCache(account: WebAccount): ChatCache {
  const read = async <T>(task: (db: IDBDatabase, view: PluginView) => Promise<T>) => {
    const [{ openStore }, view] = await Promise.all([
      import("../../e2ee/web/webCommands"),
      import("../../e2ee/web/pluginView"),
    ]);
    const store = await openStore(account);
    return store.read((db) => task(db, view));
  };
  return {
    list: (workspaceId, conversationId, before, limit, scope) =>
      read((db, view) =>
        view.pluginMessages(db, account, workspaceId, conversationId, before, limit, scope),
      ),
    get: (workspaceId, messageId, scope) =>
      read((db, view) => view.pluginMessage(db, account, workspaceId, messageId, scope)),
    search: (workspaceId, query, conversationId, limit, scope) =>
      read((db, view) =>
        view.pluginSearch(db, account, workspaceId, query, conversationId, limit, scope),
      ),
    async follow(workspaceId, conversationId) {
      await trackConversation(account, workspaceId, conversationId);
      requestCacheSync(workspaceId, [conversationId]);
    },
  };
}

/** The store the service reads: the desktop's cache, or a set-up browser's encrypted store. */
function chatCache(): ChatCache | null {
  if (detectPlatform() === "desktop") return desktopChatCache;
  const account = webStoreAccount();
  return account ? webChatCache(account) : null;
}

/** Whether the person's conversation is encrypted, from the server or, offline, the lists. */
export async function conversationEncrypted(
  workspaceId: string,
  conversationId: string,
): Promise<boolean | null> {
  try {
    const conversation = await fetchConversation(queryClient, workspaceId, conversationId);
    return Boolean(conversation.encryptedAt);
  } catch {
    const listed = findCachedConversation(queryClient, workspaceId, conversationId);
    return listed ? Boolean(listed.encryptedAt) : null;
  }
}

/** Post as the person: the encrypted send path in an encrypted conversation, else the server. */
export async function postAsUser({
  workspaceId,
  conversationId,
  body,
  threadId,
  encrypted,
}: ChatPost): Promise<string> {
  const userId = useAuthStore.getState().session?.userId;
  if (!userId) throw new RpcError(ErrorCode.INVALID_PARAMS, "nobody is signed in");
  const members = await workspaceMembers(workspaceId);
  const mentionable = await Promise.all(
    members.map(async (m) => ({
      userId: m.userId,
      principalId: m.principalId ?? null,
      provisionalId: await provisionalPrincipalId(m.userId),
    })),
  );
  const text = mentionsForSend(body, mentionable, encrypted);
  const rootMessageId = threadId
    ? await fetchThreadRoot(workspaceId, conversationId, threadId)
    : null;
  if (threadId && !rootMessageId) {
    throw new RpcError(ErrorCode.INVALID_PARAMS, `unknown thread: ${threadId}`);
  }

  if (encrypted) {
    if (detectPlatform() !== "desktop") {
      throw new RpcError(
        ErrorCode.INTERNAL_ERROR,
        "encrypted conversations can be written only from the desktop app",
        { reason: "noEncryption" },
      );
    }
    const me = members.find((m) => m.userId === userId);
    return sendEncrypted(workspaceId, conversationId, {
      body: text,
      threadRootId: rootMessageId,
      threadId,
      author: {
        id: userId,
        username: me?.username ?? "",
        displayName: me?.displayName ?? null,
        avatarUrl: me?.avatarUrl ?? null,
        principalId: me?.principalId ?? null,
      },
    });
  }

  if (rootMessageId) {
    const res = await graphqlClient.request<{ replyToMessage: { id: string } }>(
      REPLY_TO_MESSAGE_MUTATION,
      { input: { serverId: workspaceId, conversationId, rootMessageId, text } },
    );
    return res.replyToMessage.id;
  }
  const res = await graphqlClient.request<{ sendMessage: { id: string } }>(SEND_MESSAGE_MUTATION, {
    input: { serverId: workspaceId, conversationId, text },
  });
  return res.sendMessage.id;
}

async function recordEncryptedReads(pluginId: string, count: number): Promise<void> {
  if (detectPlatform() === "desktop") {
    await invokeOrThrow<null>("plugin_record_encrypted_reads", { pluginId, count });
  } else {
    await browserPluginStore.recordEncryptedReads(pluginId, count);
  }
}

/** The message service both plugin hosts in this app call. */
export const appMessageService = createMessageService({
  workspaceId: () => useWorkspaceStore.getState().workspaceId,
  encrypted: conversationEncrypted,
  cache: chatCache,
  post: postAsUser,
  recordEncryptedReads,
});
