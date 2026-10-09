/**
 * The change feed in the web app: which encrypted conversations this browser follows (`sync`),
 * the requests for their changes, and the client loop that stores each answer.
 *
 * For each encrypted entry, in feed (epoch) order: if its epoch is past the group's, the fetched
 * Commits up to it are applied first; then the entry is decrypted once and its plaintext row
 * staged, in the same unit of work that advanced the ratchet. When the feed is drained, the
 * remaining Commits are applied. An entry this browser cannot read (sent before it joined, in an
 * older incarnation, or too many epochs back) becomes a placeholder; one that decrypts but
 * breaks a rule is stored as "could not be verified", without its content, and so is one whose
 * row names no author principal or a sender other than the MLS sender. When a Commit or a
 * Welcome is missing the conversation stops where it is and the note says why.
 */

import type {
  ConversationChangesStatus,
  MessageChangesInput,
} from "../../../core/graphql/generated/schema-types";
import { logger } from "../../../core/logger";
import type {
  CacheSyncStep,
  FeedConversationChanges,
  MlsStopReason,
  MlsSyncInput,
  MlsSyncNote,
} from "../../messages/api/messageCache";
import {
  applyCommit,
  forget,
  groupStatus,
  loadState,
  pin,
  saveState,
  type GroupState,
} from "./groupState";
import {
  contentPayload,
  readRow,
  rowKey,
  storedPayload,
  timestampUs,
  upsertPlaintext,
  writeRow,
  type ContentView,
  type E2eeState,
  type MessageRow,
} from "./messageRows";
import { mlsCode, mlsEpoch, type MlsEngine } from "./mlsModule";
import type { Work } from "./store";

/** The server accepts at most 100 conversations per request. */
const MAX_CONVERSATIONS_PER_REQUEST = 100;
/** Changes asked for per conversation; the server lowers it to stay within its budget. */
const PER_CONVERSATION_LIMIT = 200;
/** A sync of "everything" covers this many of the most recently viewed conversations. */
const RECENT_CONVERSATIONS = 50;
/** Application messages more than this many epochs behind the group cannot be decrypted. */
const MAX_PAST_EPOCHS = 2;
/** A device id as the server spells it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether and how far this browser follows a conversation's feed (`sync`). */
interface SyncRecord {
  endpoint: string;
  principalId: string;
  workspaceId: string;
  conversationId: string;
  cursor: string | null;
  pending: boolean;
  /** The whole history was read once: the timeline may be served from the store. */
  complete: boolean;
  lastViewedAt: number;
}

function syncKey(work: Work, workspaceId: string, conversationId: string): IDBValidKey {
  return [work.account.endpoint, work.account.principalId, workspaceId, conversationId];
}

/** Follow a conversation from now on, or note that it was viewed again. */
export async function track(work: Work, workspaceId: string, conversationId: string) {
  const record = await work.get<SyncRecord>("sync", syncKey(work, workspaceId, conversationId));
  work.put("sync", {
    endpoint: work.account.endpoint,
    principalId: work.account.principalId,
    workspaceId,
    conversationId,
    cursor: record?.cursor ?? null,
    pending: record?.pending ?? false,
    complete: record?.complete ?? false,
    lastViewedAt: Date.now(),
  } satisfies SyncRecord);
}

/** Whether the conversation's history was read once (the timeline may come from the store). */
export async function isComplete(work: Work, workspaceId: string, conversationId: string) {
  const record = await work.get<SyncRecord>("sync", syncKey(work, workspaceId, conversationId));
  return record?.complete === true;
}

async function followed(work: Work, workspaceId: string): Promise<SyncRecord[]> {
  const records = await work.all<SyncRecord>("sync", (r) => r.workspaceId === workspaceId);
  return records
    .filter((r) => r.workspaceId === workspaceId)
    .sort(
      (a, b) => b.lastViewedAt - a.lastViewedAt || a.conversationId.localeCompare(b.conversationId),
    );
}

/**
 * Mark conversations for syncing and return the first request: those of `conversationIds` this
 * browser follows, or the most recently viewed ones without a list.
 */
export async function begin(
  work: Work,
  workspaceId: string,
  conversationIds: string[] | undefined,
): Promise<MessageChangesInput | null> {
  const records = await followed(work, workspaceId);
  const chosen = conversationIds
    ? records.filter((r) => conversationIds.includes(r.conversationId))
    : records.slice(0, RECENT_CONVERSATIONS);
  for (const record of chosen) work.put("sync", { ...record, pending: true });
  const marked = new Set(chosen.map((r) => r.conversationId));
  return request(
    workspaceId,
    records.map((r) => (marked.has(r.conversationId) ? { ...r, pending: true } : r)),
  );
}

function request(workspaceId: string, records: SyncRecord[]): MessageChangesInput | null {
  const pending = records.filter((r) => r.pending).slice(0, MAX_CONVERSATIONS_PER_REQUEST);
  if (pending.length === 0) return null;
  return {
    serverId: workspaceId,
    conversations: pending.map((r) => ({ conversationId: r.conversationId, after: r.cursor })),
    limit: PER_CONVERSATION_LIMIT,
  };
}

// ─── The client loop ────────────────────────────────────────────────────────

interface EncryptionWire {
  incarnation: number;
  epoch: number;
  senderDeviceId: string;
  ciphertext?: string | null;
  frankingReceipt: string;
  frankingKeyId: number;
  sentAtUs: string;
}

interface EntryWire {
  id: string;
  conversationId: string;
  threadId: string | null;
  authorId: string;
  author: { principalId?: string | null } | null;
  isDeleted: boolean;
  sentAt: string;
  encryption?: EncryptionWire | null;
}

type Change = FeedConversationChanges["changes"][number];
type Json = Record<string, unknown>;

type Handled = "plaintext" | "done" | "stop";

interface Decrypted {
  kind: "message";
  sender: { principalId: string; deviceId: string };
  epoch: number;
  content: string;
  frankingKey: string;
  commitment: string;
}

type DecryptOutcome =
  Decrypted | { kind: "invalid"; sender: unknown; reason: string } | { kind: "own" };

interface ParsedContent extends ContentView {
  body: string;
}

/** One encrypted entry, and how its rows are written. */
class EntryRow {
  constructor(
    private readonly work: Work,
    private readonly workspaceId: string,
    private readonly conversationId: string,
    private readonly change: Change,
    private readonly entry: EntryWire,
    private readonly encryption: EncryptionWire,
    private readonly version: number,
  ) {}

  private async write(text: string | null, payload: Json, state: E2eeState): Promise<boolean> {
    const sentAtUs = timestampUs(this.entry.sentAt);
    if (sentAtUs === null) return false;
    return writeRow(this.work, {
      endpoint: this.work.account.endpoint,
      principalId: this.work.account.principalId,
      id: this.entry.id,
      workspaceId: this.workspaceId,
      conversationId: this.conversationId,
      threadId: this.entry.threadId,
      authorId: this.entry.authorId,
      version: this.version,
      sentAtUs,
      editedAt: this.change.editedAt,
      isDeleted: false,
      text,
      payload,
      e2eeState: state,
    });
  }

  /** The server's fields of the entry, without content. */
  base(): Json {
    return {
      ...storedPayload(this.change.message as unknown as Json, false),
      attachments: [],
      linkPreviews: [],
      hasAttachments: false,
    };
  }

  facts(status: string): Json {
    return {
      status,
      incarnation: this.encryption.incarnation,
      epoch: this.encryption.epoch,
      senderDeviceId: this.encryption.senderDeviceId,
      receipt: this.encryption.frankingReceipt,
      receiptKeyId: this.encryption.frankingKeyId,
      sentAtUs: this.encryption.sentAtUs,
    };
  }

  async placeholder(): Promise<Handled> {
    await this.write(null, { ...this.base(), e2ee: this.facts("undecryptable") }, "placeholder");
    return "done";
  }

  async invalid(reason: string): Promise<Handled> {
    const e2ee = { ...this.facts("invalid"), reason };
    await this.write(null, { ...this.base(), e2ee }, "invalid");
    return "done";
  }

  /** Store a decrypted message; returns whether it was written (a lower revision is not). */
  async decrypted(message: Decrypted, content: ParsedContent): Promise<boolean> {
    const stored = await readRow(this.work, this.entry.id);
    const storedRev = (stored?.payload.e2ee as { rev?: number } | undefined)?.rev;
    if (stored?.e2eeState === "decrypted" && storedRev !== undefined && storedRev > content.rev) {
      return false;
    }
    const e2ee = {
      ...this.facts("decrypted"),
      senderDeviceId: message.sender.deviceId,
      senderPrincipalId: message.sender.principalId,
      frankingKey: message.frankingKey,
      rev: content.rev,
      content: message.content,
    };
    const payload = contentPayload(
      this.base(),
      this.change.message as unknown as Json,
      content,
      e2ee,
    );
    return this.write(content.body, payload, "decrypted");
  }

  /** This browser's own message came back: it keeps its stored plaintext, takes the server's fields. */
  async own(envelope: string): Promise<Handled> {
    const stored = await readRow(this.work, this.entry.id);
    const readable =
      stored &&
      stored.conversationId === this.conversationId &&
      (stored.e2eeState === "outgoing" || stored.e2eeState === "decrypted");
    const facts = stored?.payload.e2ee as Json | undefined;
    const content = parseContent(typeof facts?.content === "string" ? facts.content : null);
    if (!readable || !facts || !content) return this.placeholder();
    const e2ee = { ...facts, ...this.facts("decrypted") };
    const payload = contentPayload(
      this.base(),
      this.change.message as unknown as Json,
      content,
      e2ee,
    );
    await this.write(stored.text, payload, "decrypted");
    const key = [this.work.account.endpoint, this.work.account.principalId, this.entry.id];
    const outgoing = await this.work.get<{ envelope: string }>("outgoing", key);
    if (outgoing?.envelope === envelope) this.work.delete("outgoing", key);
    return "done";
  }
}

/** Content JSON as the timeline needs it, or `null` when it does not read. */
export function parseContent(text: string | null): ParsedContent | null {
  if (!text) return null;
  try {
    const c = JSON.parse(text) as ParsedContent & { body: unknown };
    return typeof c.body === "string" && typeof c.id === "string" ? c : null;
  } catch {
    return null;
  }
}

/** Reads one feed answer into the store, conversation by conversation. */
export class FeedApplier {
  private readonly notes = new Map<string, MlsSyncNote>();
  private readonly inputs: Map<string, MlsSyncInput>;
  /** Conversations pinned as encrypted during this answer. */
  private readonly pinned = new Set<string>();

  constructor(
    private readonly work: Work,
    private readonly engine: MlsEngine,
    private readonly workspaceId: string,
    inputs: MlsSyncInput[],
  ) {
    this.inputs = new Map(inputs.map((i) => [i.conversationId, i]));
  }

  private note(conversationId: string): MlsSyncNote {
    let note = this.notes.get(conversationId);
    if (!note) {
      note = {
        conversationId,
        stopped: null,
        verify: false,
        removed: false,
        misbehaved: false,
        decrypted: [],
      };
      this.notes.set(conversationId, note);
    }
    return note;
  }

  private stop(conversationId: string, reason: MlsStopReason): Handled {
    this.note(conversationId).stopped = reason;
    return "stop";
  }

  private keep(conversationId: string, state: GroupState) {
    const note = this.note(conversationId);
    note.verify = state.verifyPending;
    note.removed = state.removed;
    note.misbehaved = state.misbehaved !== null;
  }

  /** Store the answer and return the next request with what it did in each conversation. */
  async apply(changes: FeedConversationChanges[]): Promise<CacheSyncStep> {
    for (const conversation of changes) await this.conversation(conversation);
    const records = await followed(this.work, this.workspaceId);
    return {
      next: request(this.workspaceId, records),
      e2ee: [...this.notes.values()],
    };
  }

  private async conversation(entry: FeedConversationChanges) {
    const { conversationId } = entry;
    const key = syncKey(this.work, this.workspaceId, conversationId);
    const record = await this.work.get<SyncRecord>("sync", key);
    if (!record) {
      logger.warn("[RIM:e2ee] ignoring changes for an unfollowed conversation");
      return;
    }
    const status = entry.status as ConversationChangesStatus | string;
    if (status === "NO_ACCESS") {
      await this.dropMessages(conversationId, false);
      await forget(this.work, this.engine, this.workspaceId, conversationId);
      this.work.delete("sync", key);
      return;
    }
    if (status !== "OK" && status !== "RESET") {
      logger.warn("[RIM:e2ee] unknown change-feed status; leaving the conversation as is");
      this.work.put("sync", { ...record, pending: false });
      return;
    }
    if (status === "RESET") {
      // Decrypted rows cannot be fetched again: they stay, and the feed is read over them.
      await this.dropMessages(conversationId, true);
      record.complete = false;
    }

    const state = await loadState(this.work, this.workspaceId, conversationId);
    for (const change of entry.changes) {
      const handled = await this.change(conversationId, change, state);
      if (handled === "plaintext") {
        await upsertPlaintext(this.work, this.workspaceId, conversationId, {
          version: change.version,
          editedAt: change.editedAt,
          message: change.message as unknown as Json,
        });
      } else if (handled === "stop") {
        // Not pending: this run would only stop at the same entry again. The note says why,
        // and the next sync of the conversation resumes from the cursor.
        await saveState(this.work, this.workspaceId, conversationId, state);
        this.keep(conversationId, state);
        this.work.put("sync", { ...record, pending: false });
        return;
      }
    }
    this.work.put("sync", {
      ...record,
      cursor: entry.cursor,
      pending: entry.hasMore,
      complete: record.complete || !entry.hasMore,
    });
    if (!entry.hasMore) this.drainCommits(conversationId, state);
    await saveState(this.work, this.workspaceId, conversationId, state);
    this.keep(conversationId, state);
  }

  /** Delete a conversation's rows; with `keepReadable`, all but those only this browser can read. */
  private async dropMessages(conversationId: string, keepReadable: boolean) {
    const rows = await this.work.all<MessageRow>(
      "messages",
      (r) => r.workspaceId === this.workspaceId && r.conversationId === conversationId,
    );
    for (const row of rows) {
      if (row.workspaceId !== this.workspaceId || row.conversationId !== conversationId) continue;
      if (keepReadable && row.e2eeState !== null && row.e2eeState !== "placeholder") continue;
      this.work.delete("messages", rowKey(this.work.account, row.id));
    }
  }

  private async change(
    conversationId: string,
    change: Change,
    state: GroupState,
  ): Promise<Handled> {
    const entry = change.message as unknown as EntryWire;
    const encryption = entry.encryption;
    if (!encryption || entry.conversationId !== conversationId) return "plaintext";
    if (!this.pinned.has(conversationId)) {
      this.pinned.add(conversationId);
      await pin(this.work, this.workspaceId, conversationId);
    }
    const version = Number(change.version);
    if (!Number.isSafeInteger(version)) return "plaintext";
    const stored = await readRow(this.work, entry.id);
    if (stored && stored.version >= version && stored.e2eeState !== "outgoing") return "done";
    if (entry.isDeleted) {
      this.work.delete("outgoing", [
        this.work.account.endpoint,
        this.work.account.principalId,
        entry.id,
      ]);
      return "plaintext";
    }
    const input = this.inputs.get(conversationId) ?? {
      conversationId,
      commits: [],
      threadRoots: {},
    };
    const row = new EntryRow(
      this.work,
      this.workspaceId,
      conversationId,
      change,
      entry,
      encryption,
      version,
    );
    return this.entry(conversationId, entry, encryption, row, state, input);
  }

  private async entry(
    conversationId: string,
    entry: EntryWire,
    encryption: EncryptionWire,
    row: EntryRow,
    state: GroupState,
    input: MlsSyncInput,
  ): Promise<Handled> {
    const { incarnation } = encryption;
    if (incarnation < state.incarnation || (incarnation === state.incarnation && state.removed)) {
      return row.placeholder();
    }
    const status =
      incarnation === state.incarnation
        ? groupStatus(this.engine, conversationId, incarnation)
        : null;
    if (!status) {
      if (state.readdRequestedAt !== null) {
        return this.stop(conversationId, { kind: "awaitingReadd", incarnation, epoch: null });
      }
      const absent =
        input.inGroup === false ||
        (input.serverIncarnation !== undefined &&
          input.serverIncarnation !== null &&
          input.serverIncarnation > incarnation);
      if (absent) return row.placeholder();
      return this.stop(conversationId, { kind: "noGroupState", incarnation });
    }
    if (status.awaitingReadd !== null) {
      return this.stop(conversationId, {
        kind: "awaitingReadd",
        incarnation,
        epoch: status.awaitingReadd,
      });
    }
    if (encryption.epoch < state.joinEpoch) return row.placeholder();

    let epoch = status.epoch;
    while (encryption.epoch > epoch) {
      const commit = input.commits.find((c) => c.incarnation === incarnation && c.epoch === epoch);
      if (!commit) return this.stop(conversationId, { kind: "needCommits", incarnation, epoch });
      const step = applyCommit(this.engine, state, conversationId, commit);
      if (step === "applied") epoch += 1;
      else if (step === "cannotProcess") {
        return this.stop(conversationId, { kind: "awaitingReadd", incarnation, epoch });
      } else {
        return this.stop(conversationId, { kind: "needCommits", incarnation, epoch });
      }
      if (state.removed) return row.placeholder();
    }
    if (epoch - encryption.epoch > MAX_PAST_EPOCHS) return row.placeholder();

    let threadRootId: string | null = null;
    if (entry.threadId) {
      const root = input.threadRoots[entry.threadId];
      if (!root) {
        return this.stop(conversationId, { kind: "needThreadRoot", threadId: entry.threadId });
      }
      threadRootId = root;
    }
    // The row must name the author's principal and the sending device: the MLS sender is
    // checked against both, and the timeline shows the MLS sender.
    const authorPrincipalId = entry.author?.principalId;
    if (!authorPrincipalId) {
      logger.warn("[RIM:e2ee] an encrypted entry whose author has no principal id");
      return row.invalid("the row names no author principal");
    }
    if (!UUID.test(encryption.senderDeviceId ?? "")) {
      logger.warn("[RIM:e2ee] an encrypted entry whose sender device is not a device id");
      return row.invalid("the row names no sender device");
    }
    if (!encryption.ciphertext) {
      logger.warn("[RIM:e2ee] an encrypted entry without a ciphertext");
      return "done";
    }
    const expected = JSON.stringify({
      messageId: entry.id,
      threadRootId,
      authorPrincipalId,
      senderDeviceId: encryption.senderDeviceId,
    });
    let outcome: DecryptOutcome;
    try {
      outcome = JSON.parse(
        this.engine.decrypt(conversationId, incarnation, encryption.ciphertext, expected),
      ) as DecryptOutcome;
    } catch (err) {
      const code = mlsCode(err);
      if (code === "E2EE_EPOCH_MISMATCH") return row.placeholder();
      if (code === "E2EE_AWAITING_READD") {
        return this.stop(conversationId, {
          kind: "awaitingReadd",
          incarnation,
          epoch: mlsEpoch(err),
        });
      }
      if (code === undefined || code === "E2EE_STORAGE") throw err;
      // A replay (the key is used up), or bytes that are not a message of this group.
      logger.warn("[RIM:e2ee] ignoring an entry that does not decrypt:", err);
      return "done";
    }
    if (outcome.kind === "own") return row.own(encryption.ciphertext);
    if (outcome.kind === "invalid") {
      logger.warn("[RIM:e2ee] a message could not be verified:", outcome.reason);
      return row.invalid(outcome.reason);
    }
    const content = parseContent(outcome.content);
    if (!content) return row.invalid("the content does not read");
    if (await row.decrypted(outcome, content)) {
      this.note(conversationId).decrypted.push({
        messageId: entry.id,
        authorId: entry.authorId,
        threadId: entry.threadId,
        sentAt: entry.sentAt,
        body: content.body,
      });
    }
    return "done";
  }

  /** Apply the Commits left once the feed is drained. */
  private drainCommits(conversationId: string, state: GroupState) {
    const input = this.inputs.get(conversationId);
    if (!input) return;
    const commits = input.commits
      .filter((c) => c.incarnation === state.incarnation)
      .sort((a, b) => a.epoch - b.epoch);
    for (const commit of commits) {
      const step = applyCommit(this.engine, state, conversationId, commit);
      if (step === "gap") break;
      if (step === "cannotProcess") {
        this.note(conversationId).stopped = {
          kind: "awaitingReadd",
          incarnation: state.incarnation,
          epoch: commit.epoch,
        };
        break;
      }
    }
  }
}
