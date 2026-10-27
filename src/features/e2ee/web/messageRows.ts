/**
 * The messages of the web app's encrypted store (`messages`): rows as the timeline reads them,
 * the rule that decides between two copies of a message, and the reads of the timeline, a
 * thread and one message.
 *
 * A row keeps the server's message JSON without its text and envelope (`payload`) and the text
 * apart; the timeline gets the payload with the text put back.
 */

import type { MessageItem } from "../../../core/types/messages";
import { BY_THREAD, BY_TIME, readIndex, readRecord, unsealAll } from "./db";
import type { Work } from "./store";
import type { WebAccount } from "./webAccount";

/** How this browser holds an encrypted message; `null` for a plaintext row or a tombstone. */
export type E2eeState = "decrypted" | "invalid" | "placeholder" | "outgoing" | null;

export interface MessageRow {
  endpoint: string;
  principalId: string;
  id: string;
  workspaceId: string;
  conversationId: string;
  threadId: string | null;
  authorId: string;
  version: number;
  sentAtUs: number;
  editedAt: string | null;
  isDeleted: boolean;
  text: string | null;
  payload: Record<string, unknown>;
  e2eeState: E2eeState;
}

type Json = Record<string, unknown>;

/** RFC 3339 to microseconds since the epoch, the precision the server stores; `null` if unreadable. */
export function timestampUs(value: string): number | null {
  const match = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match) return null;
  const ms = Date.parse(`${match[1]}${match[3]}`);
  if (Number.isNaN(ms)) return null;
  const fraction = (match[2] ?? "").padEnd(6, "0").slice(0, 6);
  return ms * 1000 + Number(fraction);
}

export function rowKey(account: WebAccount, id: string): IDBValidKey {
  return [account.endpoint, account.principalId, id];
}

export function readRow(work: Work, id: string): Promise<MessageRow | undefined> {
  return work.get<MessageRow>("messages", rowKey(work.account, id));
}

/**
 * Insert a message, or replace the stored copy only if `row` has a higher version (a tie keeps
 * the stored copy). A row filed under another conversation is never moved. Encrypted rows add
 * two exceptions: a placeholder never replaces a row this browser could read, and a readable row
 * replaces a placeholder whatever their versions. Returns whether anything was written.
 */
export async function writeRow(work: Work, row: MessageRow): Promise<boolean> {
  const stored = await readRow(work, row.id);
  if (stored) {
    if (stored.workspaceId !== row.workspaceId || stored.conversationId !== row.conversationId) {
      return false;
    }
    const readable = ["decrypted", "invalid", "outgoing"];
    const newer =
      row.version > stored.version &&
      !(row.e2eeState === "placeholder" && readable.includes(stored.e2eeState ?? ""));
    const fills =
      stored.e2eeState === "placeholder" &&
      (row.e2eeState === "decrypted" || row.e2eeState === "invalid");
    if (!newer && !fills) return false;
  }
  work.put("messages", row);
  return true;
}

/** The message JSON to keep: no text (kept apart), no envelope, nothing of a tombstone's content. */
export function storedPayload(message: Json, deleted: boolean): Json {
  const payload: Json = { ...message };
  delete payload.text;
  // The envelope is never stored: a decrypted row keeps its plaintext instead.
  delete payload.encryption;
  if (deleted) {
    delete payload.e2ee;
    for (const field of ["attachments", "linkPreviews", "reactions", "mentionedUserIds"]) {
      payload[field] = [];
    }
    payload.forwardedFrom = null;
    payload.hasAttachments = false;
  }
  return payload;
}

interface ChangeWire {
  version: string;
  editedAt: string | null;
  message: Json;
}

/**
 * Store a plaintext entry (or a tombstone) of the feed. A change that does not parse is skipped
 * rather than failing the page.
 */
export async function upsertPlaintext(
  work: Work,
  workspaceId: string,
  conversationId: string,
  change: ChangeWire,
): Promise<void> {
  const m = change.message;
  if (m.conversationId !== conversationId || typeof m.id !== "string") return;
  const version = Number(change.version);
  const sentAtUs = typeof m.sentAt === "string" ? timestampUs(m.sentAt) : null;
  if (!Number.isSafeInteger(version) || sentAtUs === null) return;
  const deleted = m.isDeleted === true;
  // A tombstone keeps who and when, never what.
  const text = deleted ? null : typeof m.text === "string" ? m.text : null;
  await writeRow(work, {
    endpoint: work.account.endpoint,
    principalId: work.account.principalId,
    id: m.id,
    workspaceId,
    conversationId,
    threadId: typeof m.threadId === "string" ? m.threadId : null,
    authorId: String(m.authorId ?? ""),
    version,
    sentAtUs,
    editedAt: change.editedAt,
    isDeleted: deleted,
    text,
    payload: storedPayload(m, deleted),
    e2eeState: null,
  });
}

/** The parts of decrypted content a row shows. */
export interface ContentView {
  id: string;
  rev: number;
  replyTo: { messageId: string } | null;
  attachments: { blobSha256: string; name: string; mime: string; size: number }[];
  linkPreviews: {
    url: string | null;
    title: string | null;
    description: string | null;
    siteName: string | null;
  }[];
}

/**
 * A row's payload with what the content says: attachments (matched to the server's uploads by
 * their blob hash), the sender's link previews, the reply target, and the `e2ee` facts.
 */
export function contentPayload(
  base: Json,
  serverMessage: Json,
  content: ContentView,
  e2ee: Json,
): Json {
  const uploads = Array.isArray(serverMessage.attachments)
    ? (serverMessage.attachments as Json[])
    : [];
  const attachments = content.attachments.map((entry) => {
    const upload = uploads.find((u) => u.blobSha256 === entry.blobSha256);
    return {
      id: upload?.id ?? `pending:${entry.blobSha256}`,
      filename: entry.name,
      contentType: entry.mime,
      sizeBytes: entry.size,
      status: upload?.status ?? "PENDING_UPLOAD",
      blobSha256: entry.blobSha256,
    };
  });
  const previews = content.linkPreviews.map((p, i) => ({
    id: `${content.id}:${i}`,
    url: p.url ?? "",
    title: p.title,
    description: p.description,
    imageUrl: null,
    siteName: p.siteName,
  }));
  return {
    ...base,
    hasAttachments: attachments.length > 0,
    attachments,
    linkPreviews: previews,
    parentMessageId: content.replyTo?.messageId ?? null,
    e2ee,
  };
}

/** The stored payload with its text and edit time put back, as the UI's `MessageItem`. */
export function render(row: MessageRow): MessageItem {
  return { ...row.payload, text: row.text ?? "", editedAt: row.editedAt } as unknown as MessageItem;
}

/** A timeline page: the newest `limit` messages older than `before`, oldest first. */
export async function timeline(
  db: IDBDatabase,
  account: WebAccount,
  workspaceId: string,
  conversationId: string,
  before: { sentAtUs: number; id: string } | null,
  limit: number,
): Promise<{ items: MessageItem[]; hasOlder: boolean }> {
  const prefix = [account.endpoint, account.principalId, workspaceId, conversationId];
  let upper: IDBValidKey = before ? [...prefix, before.sentAtUs, before.id] : [...prefix, []];
  const want = Math.min(Math.max(limit, 1), 200);
  const items: MessageItem[] = [];
  for (;;) {
    const batch = await newestOutsideThreads(
      db,
      IDBKeyRange.bound(prefix, upper, false, true),
      want + 1,
    );
    for (const row of await unsealAll<MessageRow>("messages", batch.rows)) {
      if (row.isDeleted) continue;
      if (items.length === want) return { items: items.reverse(), hasOlder: true };
      items.push(render(row));
    }
    if (batch.last === null) return { items: items.reverse(), hasOlder: false };
    upper = batch.last;
  }
}

/**
 * Up to `count` stored rows outside threads within `range` of the timeline index, newest
 * first, still sealed, and the index key of the last row read; `null` once the range is read to
 * its start.
 */
function newestOutsideThreads(
  db: IDBDatabase,
  range: IDBKeyRange,
  count: number,
): Promise<{ rows: unknown[]; last: IDBValidKey | null }> {
  const index = db.transaction("messages", "readonly").objectStore("messages").index(BY_TIME);
  const rows: unknown[] = [];
  return new Promise((resolve, reject) => {
    const request = index.openCursor(range, "prev");
    request.onerror = () => reject(request.error ?? new Error("timeline read failed"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve({ rows, last: null });
      if ((cursor.value as { threadId: string | null }).threadId === null) rows.push(cursor.value);
      if (rows.length === count) return resolve({ rows, last: cursor.key });
      cursor.continue();
    };
  });
}

/** A thread's live replies (at most 500, oldest first), after its root message when given. */
export async function thread(
  db: IDBDatabase,
  account: WebAccount,
  workspaceId: string,
  conversationId: string,
  threadId: string,
  rootMessageId: string | null,
): Promise<MessageItem[]> {
  const items: MessageItem[] = [];
  if (rootMessageId) {
    const root = await message(db, account, rootMessageId);
    if (root) items.push(root);
  }
  const prefix = [account.endpoint, account.principalId, workspaceId, conversationId, threadId];
  const rows = await readIndex<MessageRow>(
    db,
    "messages",
    BY_THREAD,
    IDBKeyRange.bound(prefix, [...prefix, []]),
  );
  for (const row of rows.filter((r) => !r.isDeleted).slice(0, 500)) items.push(render(row));
  return items;
}

/** One stored message, or `null`. */
export async function message(
  db: IDBDatabase,
  account: WebAccount,
  id: string,
): Promise<MessageItem | null> {
  const row = await readRecord<MessageRow>(db, "messages", rowKey(account, id));
  return row ? render(row) : null;
}
