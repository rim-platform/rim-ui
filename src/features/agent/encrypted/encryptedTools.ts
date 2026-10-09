// The agent's chat tools where a conversation is end-to-end encrypted. The
// server has no text there: it answers `chat.get_recent_messages` with empty
// messages, never returns encrypted rows from `chat.search_messages`, and
// refuses `chat.post_message`. So in an encrypted conversation the agent reads
// the local cache and posts through the encrypted send path, and only in one
// the person turned the agent on for; elsewhere the tools go to the server as
// before. A group the agent creates is plaintext on the server and is upgraded
// from this desktop like any other.

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { PluginChatMessage, PluginMessagePage } from "../../plugins/chat/chatTypes";
import type { ChatPost } from "../../plugins/chat/messageService";
import { useConfirmationModalStore } from "../state/confirmationModalStore";
import { USER_CANCELLED_MESSAGE } from "../runtime/confirmationGate";
import type { AiToolHandler } from "../tools/types";

export const ENCRYPTED_ROUTED_COMMANDS = [
  "chat.get_recent_messages",
  "chat.search_messages",
  "chat.post_message",
  "chat.create_group",
] as const;

/** What the agent is told when it reaches for an encrypted conversation it may not use. */
export const AGENT_OFF_MESSAGE =
  "This conversation is end-to-end encrypted and the agent is off in it. The user can turn the agent on from the conversation's menu.";

const NOT_CACHED_MESSAGE =
  "This encrypted conversation is not stored on this device yet. Ask the user to open it first.";

/** How long the confirmation of an encrypted post stays open. */
const CONFIRM_WINDOW_MS = 5 * 60_000;

export interface EncryptedToolDeps {
  workspaceId(): string | null;
  /** Whether the conversation is encrypted; `null` when it cannot be looked up. */
  encrypted(workspaceId: string, conversationId: string): Promise<boolean | null>;
  /** Whether the person turned the agent on in this encrypted conversation. */
  allowed(conversationId: string): boolean;
  list(
    workspaceId: string,
    conversationId: string,
    limit: number,
  ): Promise<PluginMessagePage | null>;
  search(
    workspaceId: string,
    query: string,
    conversationId: string | null,
    limit: number,
  ): Promise<PluginChatMessage[]>;
  post(post: ChatPost): Promise<string>;
  /** Ask the person to confirm an encrypted post; true when they did. */
  confirmPost(args: Record<string, unknown>): Promise<boolean>;
  /** Upgrade a conversation the agent just created, when every member is ready. */
  upgrade(workspaceId: string, conversationId: string): Promise<void>;
}

function stringArg(input: Record<string, unknown>, name: string): string | null {
  const value = input[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function limitArg(input: Record<string, unknown>, fallback: number, max: number): number {
  const raw = input.limit;
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function asSearchResult(m: PluginChatMessage) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    author: m.author.displayName,
    text: m.text,
    sentAt: m.sentAt,
    source: "this device",
  };
}

/**
 * `backend` (the server's handler for `commandId`) with the encrypted conversations routed
 * to this device. Commands other than {@link ENCRYPTED_ROUTED_COMMANDS} are returned as they
 * are.
 */
export function routeEncrypted(
  commandId: string,
  backend: AiToolHandler,
  deps: EncryptedToolDeps,
): AiToolHandler {
  /** The workspace and the conversation's encryption, or null when the server should answer. */
  async function encryptedTarget(input: Record<string, unknown>) {
    const conversationId = stringArg(input, "conversation_id");
    const workspaceId = stringArg(input, "server_id") ?? deps.workspaceId();
    if (!conversationId || !workspaceId) return null;
    if ((await deps.encrypted(workspaceId, conversationId)) !== true) return null;
    if (!deps.allowed(conversationId)) throw new Error(AGENT_OFF_MESSAGE);
    return { workspaceId, conversationId };
  }

  switch (commandId) {
    case "chat.get_recent_messages":
      return async (input) => {
        const target = await encryptedTarget(input);
        if (!target) return backend(input);
        const page = await deps.list(
          target.workspaceId,
          target.conversationId,
          limitArg(input, 30, 100),
        );
        if (!page) throw new Error(NOT_CACHED_MESSAGE);
        return JSON.stringify({
          messages: page.messages.map((m) => ({
            author: m.author.displayName,
            text: m.text,
            sentAt: m.sentAt,
          })),
        });
      };

    case "chat.search_messages":
      return async (input) => {
        const query = stringArg(input, "query") ?? "";
        const limit = limitArg(input, 10, 50);
        const target = await encryptedTarget(input);
        if (target) {
          const hits = await deps.search(target.workspaceId, query, target.conversationId, limit);
          return JSON.stringify({ results: hits.map(asSearchResult) });
        }
        const server = await backend(input);
        const workspaceId = stringArg(input, "server_id") ?? deps.workspaceId();
        if (stringArg(input, "conversation_id") || !workspaceId) return server;
        // Across conversations: the server's hits, then this device's hits in the encrypted
        // conversations the agent is on in.
        const local = (await deps.search(workspaceId, query, null, limit).catch(() => [])).filter(
          (m) => m.encrypted && deps.allowed(m.conversationId),
        );
        if (local.length === 0) return server;
        let parsed: { results?: unknown[] };
        try {
          parsed = JSON.parse(server) as { results?: unknown[] };
        } catch {
          return server;
        }
        return JSON.stringify({
          ...parsed,
          results: [...(parsed.results ?? []), ...local.map(asSearchResult)],
        });
      };

    case "chat.post_message":
      return async (input) => {
        const target = await encryptedTarget(input);
        if (!target) return backend(input);
        const text = stringArg(input, "text");
        if (!text) throw new Error("text is required");
        if (!(await deps.confirmPost(input))) return USER_CANCELLED_MESSAGE;
        const id = await deps.post({
          workspaceId: target.workspaceId,
          conversationId: target.conversationId,
          body: text,
          threadId: null,
          encrypted: true,
        });
        return JSON.stringify({ message_id: id, conversation_id: target.conversationId });
      };

    case "chat.create_group":
      return async (input) => {
        const result = await backend(input);
        const workspaceId = stringArg(input, "server_id") ?? deps.workspaceId();
        try {
          const created = JSON.parse(result) as { conversation_id?: unknown };
          if (workspaceId && typeof created.conversation_id === "string") {
            await deps.upgrade(workspaceId, created.conversation_id).catch(() => {});
          }
        } catch {
          // A result without the new conversation's id leaves the upgrade to opening it.
        }
        return result;
      };

    default:
      return backend;
  }
}

/** Ask through the agent's confirmation modal, as for any command the server confirms. */
export function confirmEncryptedPost(args: Record<string, unknown>): Promise<boolean> {
  return useConfirmationModalStore
    .getState()
    .open({
      commandId: "chat.post_message",
      toolName: "chat.post_message",
      args,
      token: `local-${crypto.randomUUID()}`,
      argsHash: "",
      expiresAt: new Date(Date.now() + CONFIRM_WINDOW_MS).toISOString(),
      sensitivity: CommandSensitivity.MUTATING,
      description: "Send this message, encrypted, in an end-to-end encrypted conversation.",
      serverMessage: "The agent wants to post in an encrypted conversation.",
    })
    .then((decision) => decision.approved);
}
