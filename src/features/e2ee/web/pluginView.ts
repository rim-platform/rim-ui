/**
 * The web app's encrypted store as plugins read it through the client message service
 * (`rim.chat.*`), in the shape the desktop's cache gives them: each message as the person
 * reads it and nothing else. No franking keys, attachment secrets or blob hashes, no MLS facts,
 * no raw user ids (authors and `<@user>` mentions become principal ids). Placeholders, rows that
 * could not be verified, tombstones and unacknowledged sends are left out.
 *
 * Encrypted conversations are readable only with `encryptedAllowed`: a conversation is encrypted
 * when the caller says so, when this browser holds group state for it, or when any of its stored
 * rows is an encrypted message.
 */

import type {
  PluginChatMessage,
  PluginMessagePage,
  PluginReadScope,
} from "../../plugins/chat/chatTypes";
import { isKeyPrincipalId, provisionalPrincipalId } from "../../plugins/web/principal";
import { ErrorCode, RpcError } from "../../plugins/web/rpc";
import { BY_ACCOUNT, BY_TIME, done } from "./db";
import type { MessageRow } from "./messageRows";
import type { WebAccount } from "./webAccount";

/** Messages a list or search answers when the plugin names no limit. */
const DEFAULT_LIMIT = 50;
/** Most messages one list or search answers. */
const MAX_LIMIT = 100;

const UUID_HYPHENATED = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** The spellings of a UUID a `<@…>` mention of an account may use. */
const UUID = new RegExp(
  `^(?:${UUID_HYPHENATED}|[0-9a-f]{32}|\\{${UUID_HYPHENATED}\\}|urn:uuid:${UUID_HYPHENATED})$`,
  "i",
);
const MENTION = /<@([^>]*)>/g;

function clampLimit(limit: number | null): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}

function readable(row: MessageRow): boolean {
  return (
    !row.isDeleted && row.text !== null && (row.e2eeState === null || row.e2eeState === "decrypted")
  );
}

function deniedEncrypted(): RpcError {
  return new RpcError(ErrorCode.CAPABILITY_DENIED, "capability denied: chat.read.encrypted");
}

/** `text` with every `<@user-id>` mention as `<@principal-id>`; other tokens stay as written. */
export async function principalMentions(text: string): Promise<string> {
  const ids = [...text.matchAll(MENTION)].map((m) => m[1]).filter((id) => UUID.test(id));
  const principals = new Map<string, string>();
  for (const id of ids) principals.set(id, await provisionalPrincipalId(id));
  return text.replace(MENTION, (token, id: string) => {
    const principal = principals.get(id);
    return principal ? `<@${principal}>` : token;
  });
}

/** A stored row as a plugin sees it. */
export async function project(row: MessageRow): Promise<PluginChatMessage> {
  const author = (row.payload.author ?? null) as Record<string, unknown> | null;
  const field = (name: string) => {
    const value = author?.[name];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const keyId = field("principalId");
  const attachments = Array.isArray(row.payload.attachments)
    ? (row.payload.attachments as Record<string, unknown>[])
    : [];
  return {
    id: row.id,
    conversationId: row.conversationId,
    threadId: row.threadId,
    author: {
      principalId:
        keyId && isKeyPrincipalId(keyId) ? keyId : await provisionalPrincipalId(row.authorId),
      displayName: field("displayName") ?? field("username") ?? "Someone",
    },
    text: await principalMentions(row.text ?? ""),
    sentAt: typeof row.payload.sentAt === "string" ? row.payload.sentAt : "",
    editedAt: row.editedAt,
    encrypted: row.e2eeState !== null,
    attachments: attachments.map((a) => ({
      name: typeof a.filename === "string" ? a.filename : "",
      mime: typeof a.contentType === "string" ? a.contentType : "",
      size:
        Number.isSafeInteger(a.sizeBytes) && (a.sizeBytes as number) >= 0
          ? (a.sizeBytes as number)
          : 0,
    })),
  };
}

/** A conversation's stored rows, oldest first. */
async function conversationRows(
  db: IDBDatabase,
  account: WebAccount,
  workspaceId: string,
  conversationId: string,
): Promise<MessageRow[]> {
  const prefix = [account.endpoint, account.principalId, workspaceId, conversationId];
  const tx = db.transaction("messages", "readonly");
  const index = tx.objectStore("messages").index(BY_TIME);
  return (await done(index.getAll(IDBKeyRange.bound(prefix, [...prefix, []])))) as MessageRow[];
}

/** Whether `conversationId` is end-to-end encrypted, as far as this browser knows. */
export async function conversationEncrypted(
  db: IDBDatabase,
  account: WebAccount,
  workspaceId: string,
  conversationId: string,
  scope: PluginReadScope,
): Promise<boolean> {
  if (scope.knownEncrypted.includes(conversationId)) return true;
  const tx = db.transaction("groups", "readonly");
  const key = [account.endpoint, account.principalId, workspaceId, conversationId];
  if (await done(tx.objectStore("groups").get(key))) return true;
  const rows = await conversationRows(db, account, workspaceId, conversationId);
  return rows.some((r) => r.e2eeState !== null);
}

async function checkReadable(
  db: IDBDatabase,
  account: WebAccount,
  workspaceId: string,
  conversationId: string,
  scope: PluginReadScope,
) {
  if (
    !scope.encryptedAllowed &&
    (await conversationEncrypted(db, account, workspaceId, conversationId, scope))
  ) {
    throw deniedEncrypted();
  }
}

/**
 * The newest `limit` messages of a conversation older than the message `before`, oldest first,
 * thread replies included. `null` while the conversation's history is not fully stored here.
 */
export async function pluginMessages(
  db: IDBDatabase,
  account: WebAccount,
  workspaceId: string,
  conversationId: string,
  before: string | null,
  limit: number | null,
  scope: PluginReadScope,
): Promise<PluginMessagePage | null> {
  await checkReadable(db, account, workspaceId, conversationId, scope);
  const tx = db.transaction("sync", "readonly");
  const sync = (await done(
    tx
      .objectStore("sync")
      .get([account.endpoint, account.principalId, workspaceId, conversationId]),
  )) as { complete?: boolean } | undefined;
  if (sync?.complete !== true) return null;

  let rows = await conversationRows(db, account, workspaceId, conversationId);
  if (before !== null) {
    const at = rows.findIndex((r) => r.id === before);
    if (at < 0) {
      throw new RpcError(
        ErrorCode.INVALID_PARAMS,
        `before names no message of the conversation: ${before}`,
      );
    }
    rows = rows.slice(0, at);
  }
  const visible = rows.filter(readable);
  const want = clampLimit(limit);
  const page = visible.slice(Math.max(visible.length - want, 0));
  return {
    messages: await Promise.all(page.map(project)),
    hasOlder: visible.length > want,
  };
}

/** One message, or `null` when it is not stored or not one a plugin may see. */
export async function pluginMessage(
  db: IDBDatabase,
  account: WebAccount,
  workspaceId: string,
  messageId: string,
  scope: PluginReadScope,
): Promise<PluginChatMessage | null> {
  const tx = db.transaction("messages", "readonly");
  const row = (await done(
    tx.objectStore("messages").get([account.endpoint, account.principalId, messageId]),
  )) as MessageRow | undefined;
  if (!row || row.workspaceId !== workspaceId || !readable(row)) return null;
  await checkReadable(db, account, workspaceId, row.conversationId, scope);
  return project(row);
}

/**
 * Messages whose text contains `query` (any case), newest first. Hits in encrypted conversations
 * are left out without `encryptedAllowed`; naming an encrypted conversation without it is refused.
 */
export async function pluginSearch(
  db: IDBDatabase,
  account: WebAccount,
  workspaceId: string,
  query: string,
  conversationId: string | null,
  limit: number | null,
  scope: PluginReadScope,
): Promise<PluginChatMessage[]> {
  if (conversationId !== null) {
    await checkReadable(db, account, workspaceId, conversationId, scope);
  }
  const rows =
    conversationId !== null
      ? await conversationRows(db, account, workspaceId, conversationId)
      : (
          (await done(
            db
              .transaction("messages", "readonly")
              .objectStore("messages")
              .index(BY_ACCOUNT)
              .getAll(IDBKeyRange.only([account.endpoint, account.principalId])),
          )) as MessageRow[]
        ).filter((r) => r.workspaceId === workspaceId);
  const needle = query.toLowerCase();
  const hits = rows
    .filter((r) => readable(r) && (r.text ?? "").toLowerCase().includes(needle))
    .sort((a, b) => b.sentAtUs - a.sentAtUs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const want = clampLimit(limit);
  const hidden = new Map<string, boolean>();
  const found: PluginChatMessage[] = [];
  for (const row of hits) {
    if (!scope.encryptedAllowed) {
      let encrypted = hidden.get(row.conversationId);
      if (encrypted === undefined) {
        encrypted = await conversationEncrypted(
          db,
          account,
          workspaceId,
          row.conversationId,
          scope,
        );
        hidden.set(row.conversationId, encrypted);
      }
      if (encrypted) continue;
    }
    found.push(await project(row));
    if (found.length === want) break;
  }
  return found;
}
