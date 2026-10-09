// The client message service: what a plugin reads and writes through
// `rim.chat.*`, the same for a web plugin (the web host calls it in this page)
// and a local process (the Rust broker relays its calls here). Reads come from
// the local message cache only; writes go through the person's own send path,
// encrypted where the conversation is. An encrypted conversation needs the
// encrypted grant on top of the plain one, and every encrypted message a plugin
// reads is counted in its audit.

import { ErrorCode, RpcError } from "../web/rpc";
import {
  CHAT_READ,
  CHAT_READ_ENCRYPTED,
  CHAT_WRITE,
  CHAT_WRITE_ENCRYPTED,
  ChatMethod,
  type PluginChatMessage,
  type PluginMessagePage,
  type PluginReadScope,
} from "./chatTypes";

/** Most messages one list or search answers. */
export const MAX_CHAT_LIMIT = 100;
/** Longest message a plugin may post, in Unicode scalar values. */
export const MAX_BODY_LENGTH = 10_000;
/** Longest search query, in characters. */
export const MAX_QUERY_LENGTH = 500;

/** The local cache as the service reads it; on the desktop, the cache's plugin commands. */
export interface ChatCache {
  /** `null` while the conversation's history is not fully cached on this device. */
  list(
    workspaceId: string,
    conversationId: string,
    before: string | null,
    limit: number | null,
    scope: PluginReadScope,
  ): Promise<PluginMessagePage | null>;
  get(
    workspaceId: string,
    messageId: string,
    scope: PluginReadScope,
  ): Promise<PluginChatMessage | null>;
  search(
    workspaceId: string,
    query: string,
    conversationId: string | null,
    limit: number | null,
    scope: PluginReadScope,
  ): Promise<PluginChatMessage[]>;
  /** Start caching a conversation, so a later list finds it. */
  follow(workspaceId: string, conversationId: string): Promise<void>;
}

/** A message a plugin posts, after the service checked its grants. */
export interface ChatPost {
  workspaceId: string;
  conversationId: string;
  body: string;
  threadId: string | null;
  encrypted: boolean;
}

/** What the service needs from the app. */
export interface ChatDeps {
  /** The workspace open in the app, which every call reads and writes in. */
  workspaceId(): string | null;
  /** Whether a conversation is end-to-end encrypted; `null` when the person cannot see it. */
  encrypted(workspaceId: string, conversationId: string): Promise<boolean | null>;
  /** The local cache; `null` where the app keeps none (a browser not set up as a linked device). */
  cache(): ChatCache | null;
  /** Send through the person's own send path; the new message's id. */
  post(post: ChatPost): Promise<string>;
  /** Count encrypted messages handed to the plugin today. */
  recordEncryptedReads(pluginId: string, count: number): Promise<void>;
}

export interface MessageService {
  /** Answer one `rim.chat.*` call: its result, or an {@link RpcError}. */
  call(
    pluginId: string,
    method: string,
    params: unknown,
    granted: readonly string[],
  ): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): RpcError {
  return new RpcError(ErrorCode.INVALID_PARAMS, message);
}

function denied(capability: string): RpcError {
  return new RpcError(ErrorCode.CAPABILITY_DENIED, `capability denied: ${capability}`);
}

function requiredString(p: Record<string, unknown>, name: string): string {
  const value = p[name];
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`missing required param: ${name}`);
  }
  return value;
}

function optionalString(p: Record<string, unknown>, name: string): string | null {
  const value = p[name];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalLimit(p: Record<string, unknown>): number | null {
  const value = p.limit;
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_CHAT_LIMIT
  ) {
    throw invalid(`limit must be an integer from 1 to ${MAX_CHAT_LIMIT}`);
  }
  return value;
}

/** A cache command's failure as the error the plugin gets. */
function cacheError(error: unknown): RpcError {
  if (error instanceof RpcError) return error;
  const record = isRecord(error) ? error : {};
  const message = typeof record.message === "string" ? record.message : String(error);
  if (record.code === "CAPABILITY_DENIED") return denied(CHAT_READ_ENCRYPTED);
  if (record.kind === "invalid_args") return invalid(message);
  return new RpcError(ErrorCode.INTERNAL_ERROR, message);
}

const NO_CACHE = new RpcError(
  ErrorCode.INTERNAL_ERROR,
  "messages are not stored in this app; plugins read them in the desktop app, or in a browser set up as a linked device",
  { reason: "noCache" },
);

export function createMessageService(deps: ChatDeps): MessageService {
  function workspace(): string {
    const id = deps.workspaceId();
    if (!id) throw invalid("no workspace is open");
    return id;
  }

  function cache(): ChatCache {
    const store = deps.cache();
    if (!store) throw NO_CACHE;
    return store;
  }

  /** Whether `conversationId` is encrypted; refused when the person cannot see it. */
  async function encrypted(workspaceId: string, conversationId: string): Promise<boolean> {
    const known = await deps.encrypted(workspaceId, conversationId).catch(() => null);
    if (known === null) throw invalid(`unknown conversation: ${conversationId}`);
    return known;
  }

  /** Refuse an encrypted conversation without the encrypted read grant. */
  async function readable(
    workspaceId: string,
    conversationId: string,
    granted: readonly string[],
  ): Promise<PluginReadScope> {
    const isEncrypted = await encrypted(workspaceId, conversationId);
    const encryptedAllowed = granted.includes(CHAT_READ_ENCRYPTED);
    if (isEncrypted && !encryptedAllowed) throw denied(CHAT_READ_ENCRYPTED);
    return { encryptedAllowed, knownEncrypted: isEncrypted ? [conversationId] : [] };
  }

  /**
   * Without the encrypted grant, drop messages whose conversation the server says is
   * encrypted (old plaintext of an upgraded conversation, which the cache may not mark).
   */
  async function visible(
    workspaceId: string,
    messages: PluginChatMessage[],
    granted: readonly string[],
  ): Promise<PluginChatMessage[]> {
    if (granted.includes(CHAT_READ_ENCRYPTED)) return messages;
    const conversations = [...new Set(messages.map((m) => m.conversationId))];
    const verdicts = await Promise.all(
      conversations.map((id) => deps.encrypted(workspaceId, id).catch(() => null)),
    );
    const allowed = new Set(conversations.filter((_, i) => verdicts[i] === false));
    return messages.filter((m) => allowed.has(m.conversationId));
  }

  async function audited<T>(
    pluginId: string,
    messages: PluginChatMessage[],
    result: T,
  ): Promise<T> {
    const count = messages.filter((m) => m.encrypted).length;
    if (count > 0) await deps.recordEncryptedReads(pluginId, count).catch(() => {});
    return result;
  }

  async function listMessages(
    pluginId: string,
    p: Record<string, unknown>,
    granted: readonly string[],
  ) {
    const conversationId = requiredString(p, "conversationId");
    const before = optionalString(p, "before");
    const limit = optionalLimit(p);
    const workspaceId = workspace();
    const store = cache();
    const scope = await readable(workspaceId, conversationId, granted);
    const page = await store
      .list(workspaceId, conversationId, before, limit, scope)
      .catch((error: unknown) => {
        throw cacheError(error);
      });
    if (!page) {
      await store.follow(workspaceId, conversationId).catch(() => {});
      throw new RpcError(
        ErrorCode.INTERNAL_ERROR,
        "this conversation is not stored on this device yet; try again shortly",
        { reason: "notCached" },
      );
    }
    return audited(pluginId, page.messages, page);
  }

  async function getMessage(
    pluginId: string,
    p: Record<string, unknown>,
    granted: readonly string[],
  ) {
    const messageId = requiredString(p, "messageId");
    const workspaceId = workspace();
    const scope: PluginReadScope = {
      encryptedAllowed: granted.includes(CHAT_READ_ENCRYPTED),
      knownEncrypted: [],
    };
    const message = await cache()
      .get(workspaceId, messageId, scope)
      .catch((error: unknown) => {
        throw cacheError(error);
      });
    if (!message) return { message: null };
    if (!scope.encryptedAllowed) {
      const verdict = await deps.encrypted(workspaceId, message.conversationId).catch(() => null);
      if (verdict === null) return { message: null };
      if (verdict) throw denied(CHAT_READ_ENCRYPTED);
    }
    return audited(pluginId, [message], { message });
  }

  async function searchMessages(
    pluginId: string,
    p: Record<string, unknown>,
    granted: readonly string[],
  ) {
    const query = requiredString(p, "query");
    if (query.length > MAX_QUERY_LENGTH) {
      throw invalid(`query must be at most ${MAX_QUERY_LENGTH} characters`);
    }
    const conversationId = optionalString(p, "conversationId");
    const limit = optionalLimit(p);
    const workspaceId = workspace();
    const store = cache();
    const scope = conversationId
      ? await readable(workspaceId, conversationId, granted)
      : { encryptedAllowed: granted.includes(CHAT_READ_ENCRYPTED), knownEncrypted: [] };
    const hits = await store
      .search(workspaceId, query, conversationId, limit, scope)
      .catch((error: unknown) => {
        throw cacheError(error);
      });
    const messages = conversationId ? hits : await visible(workspaceId, hits, granted);
    return audited(pluginId, messages, { messages });
  }

  async function postMessage(p: Record<string, unknown>, granted: readonly string[]) {
    const conversationId = requiredString(p, "conversationId");
    const body = p.body;
    if (typeof body !== "string" || body.trim().length === 0) {
      throw invalid("missing required param: body");
    }
    if ([...body].length > MAX_BODY_LENGTH) {
      throw invalid(`body must be at most ${MAX_BODY_LENGTH} characters`);
    }
    const threadId = optionalString(p, "threadId");
    const workspaceId = workspace();
    const isEncrypted = await encrypted(workspaceId, conversationId);
    if (isEncrypted && !granted.includes(CHAT_WRITE_ENCRYPTED)) throw denied(CHAT_WRITE_ENCRYPTED);
    const id = await deps.post({
      workspaceId,
      conversationId,
      body,
      threadId,
      encrypted: isEncrypted,
    });
    return { id };
  }

  return {
    async call(pluginId, method, params, granted) {
      const p = params === undefined || params === null ? {} : params;
      if (!isRecord(p)) throw invalid("params must be an object");
      switch (method) {
        case ChatMethod.listMessages:
          if (!granted.includes(CHAT_READ)) throw denied(CHAT_READ);
          return listMessages(pluginId, p, granted);
        case ChatMethod.getMessage:
          if (!granted.includes(CHAT_READ)) throw denied(CHAT_READ);
          return getMessage(pluginId, p, granted);
        case ChatMethod.searchMessages:
          if (!granted.includes(CHAT_READ)) throw denied(CHAT_READ);
          return searchMessages(pluginId, p, granted);
        case ChatMethod.postMessage:
          if (!granted.includes(CHAT_WRITE)) throw denied(CHAT_WRITE);
          return postMessage(p, granted);
        default:
          throw new RpcError(ErrorCode.METHOD_NOT_FOUND, `method not found: ${method}`);
      }
    },
  };
}
