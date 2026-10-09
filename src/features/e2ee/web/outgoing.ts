/**
 * Sending from the web app: a message (or an edit) is encrypted in the group's current epoch
 * and its plaintext row stored under the message id this browser chose, in one unit of work,
 * before the envelope is sent. The content and franking key stay in `outgoing` until the server
 * acknowledges it, so `STALE_EPOCH` sends the same content again in the newer epoch.
 */

import { uuidV7 } from "../../key-identity/browser/browserKeyBackend";
import type { DraftInput, OutgoingMessage } from "../api/e2eeCommands";
import type { AttachmentEntry } from "./attachments";
import { parseContent } from "./feed";
import { GroupError, loadState } from "./groupState";
import { contentPayload, readRow, rowKey, timestampUs, writeRow } from "./messageRows";
import type { MlsEngine, MlsModule } from "./mlsModule";
import type { Work } from "./store";

/** A message or an edit waiting for the server's answer (`outgoing`). */
interface OutgoingRecord {
  endpoint: string;
  principalId: string;
  messageId: string;
  workspaceId: string;
  conversationId: string;
  kind: "send" | "edit";
  incarnation: number;
  epoch: number;
  envelope: string;
  content: string;
  frankingKey: string;
  commitment: string;
  /** For an edit: the row's text and payload before it, put back if the server refuses it. */
  previous: { text: string | null; payload: Record<string, unknown> } | null;
  createdAt: number;
}

interface Encrypted {
  messageId: string;
  epoch: number;
  envelope: string;
  content: string;
  frankingKey: string;
  commitment: string;
}

/** Content as the message carries it. */
interface StoredContent {
  id: string;
  rev: number;
  threadRootId: string | null;
  replyTo: { messageId: string } | null;
  forwardedFrom: NonNullable<DraftInput["forwardedFrom"]> | null;
  attachments: AttachmentEntry[];
}

interface MlsKeyClaim {
  principalId: string;
  deviceId: string;
}

function outgoingKey(work: Work, messageId: string): IDBValidKey {
  return [work.account.endpoint, work.account.principalId, messageId];
}

function blocked(): GroupError {
  return new GroupError(
    "E2EE_UNVERIFIED_DEVICE",
    "a device RIM cannot verify is in this conversation",
  );
}

function noGroup(): GroupError {
  return new GroupError("E2EE_NO_GROUP", "no group for this conversation and incarnation");
}

/** This device as its `mls-key` statement names it. */
function thisDevice(engine: MlsEngine): MlsKeyClaim {
  const statement = engine.mlsKeyStatement();
  if (!statement) throw new GroupError("E2EE_NO_IDENTITY", "this device has no MLS identity yet");
  const { payload } = JSON.parse(statement) as { payload: string };
  return JSON.parse(payload) as MlsKeyClaim;
}

/** The `e2ee` facts of a row this browser sent. */
function facts(
  encrypted: Encrypted,
  incarnation: number,
  me: MlsKeyClaim,
  rev: number,
): Record<string, unknown> {
  return {
    status: "decrypted",
    incarnation,
    epoch: encrypted.epoch,
    senderDeviceId: me.deviceId,
    senderPrincipalId: me.principalId,
    frankingKey: encrypted.frankingKey,
    rev,
    content: encrypted.content,
  };
}

/**
 * Encrypt a draft and stage its plaintext row; the envelope is sent once the unit of work is
 * stored. `attachment` resolves a blob hash to the entry encrypted for it.
 */
export async function encrypt(
  work: Work,
  mls: MlsModule,
  engine: MlsEngine,
  workspaceId: string,
  conversationId: string,
  draft: DraftInput,
  attachment: (hash: string) => Promise<AttachmentEntry | null>,
): Promise<OutgoingMessage> {
  const state = await loadState(work, workspaceId, conversationId);
  if (state.incarnation === 0 || state.removed) throw noGroup();
  if (state.unverified.length > 0) throw blocked();
  const me = thisDevice(engine);

  let contentText: string;
  let previous: OutgoingRecord["previous"] = null;
  const linkPreviews = (draft.linkPreviews ?? []).map((p) => ({
    url: p.url,
    title: p.title,
    description: p.description,
    siteName: p.siteName,
  }));
  if (draft.editOf) {
    const row = await readRow(work, draft.editOf);
    const readable = row?.e2eeState === "decrypted" || row?.e2eeState === "outgoing";
    const stored = readable
      ? (row.payload.e2ee as { content?: string } | undefined)?.content
      : null;
    const original = stored && parseContent(stored) ? (JSON.parse(stored) as StoredContent) : null;
    if (!row || !original) {
      throw new GroupError("INVALID_ARGS", "only a message this device can read can be edited");
    }
    contentText = mls.buildContent(
      JSON.stringify({
        id: original.id,
        rev: original.rev + 1,
        threadRootId: original.threadRootId,
        body: draft.body,
        replyTo: original.replyTo?.messageId ?? null,
        forwardedFrom: original.forwardedFrom,
        attachments: original.attachments,
        linkPreviews,
      }),
    );
    previous = { text: row.text, payload: row.payload };
  } else {
    const attachments: AttachmentEntry[] = [];
    for (const hash of draft.attachments ?? []) {
      const entry = await attachment(hash);
      if (!entry) throw new GroupError("INVALID_ARGS", "an attachment was not encrypted here");
      attachments.push(entry);
    }
    contentText = mls.buildContent(
      JSON.stringify({
        id: uuidV7(),
        threadRootId: draft.threadRootId ?? null,
        body: draft.body,
        replyTo: draft.replyTo ?? null,
        forwardedFrom: draft.forwardedFrom ?? null,
        attachments,
        linkPreviews,
      }),
    );
  }
  const content = parseContent(contentText);
  if (!content) throw new GroupError("INVALID_ARGS", "the content does not read");

  const encrypted = JSON.parse(
    engine.encrypt(conversationId, state.incarnation, contentText),
  ) as Encrypted;
  const messageId = encrypted.messageId;
  const e2ee = facts(encrypted, state.incarnation, me, content.rev);
  const { endpoint, principalId } = work.account;
  if (previous) {
    const row = await readRow(work, messageId);
    if (!row) throw new GroupError("INVALID_ARGS", "the edited message is gone");
    work.put("messages", {
      ...row,
      text: content.body,
      payload: contentPayload(row.payload, {}, content, e2ee),
    });
  } else {
    const sentAt = new Date().toISOString();
    const base = {
      id: messageId,
      serverId: workspaceId,
      conversationId,
      threadId: draft.threadId ?? null,
      rootThreadId: null,
      authorId: draft.authorId,
      author: draft.author,
      isPinned: false,
      isDeleted: false,
      mentionedUserIds: [],
      forwardedFromMessageId: draft.forwardedFrom?.messageId ?? null,
      forwardedFrom: null,
      sentAt,
      reactions: [],
    };
    await writeRow(work, {
      endpoint,
      principalId,
      id: messageId,
      workspaceId,
      conversationId,
      threadId: draft.threadId ?? null,
      authorId: draft.authorId,
      version: 0,
      sentAtUs: timestampUs(sentAt) ?? Date.now() * 1000,
      editedAt: null,
      isDeleted: false,
      text: content.body,
      payload: contentPayload(base, {}, content, e2ee),
      e2eeState: "outgoing",
    });
  }
  const existing = await work.get<OutgoingRecord>("outgoing", outgoingKey(work, messageId));
  work.put("outgoing", {
    endpoint,
    principalId,
    messageId,
    workspaceId,
    conversationId,
    kind: previous ? "edit" : "send",
    incarnation: state.incarnation,
    epoch: encrypted.epoch,
    envelope: encrypted.envelope,
    content: encrypted.content,
    frankingKey: encrypted.frankingKey,
    commitment: encrypted.commitment,
    previous: existing?.previous ?? previous,
    createdAt: Date.now(),
  } satisfies OutgoingRecord);
  const parsed = JSON.parse(contentText) as {
    threadRootId: string | null;
    forwardedFrom: { messageId: string } | null;
  };
  return {
    messageId,
    incarnation: state.incarnation,
    epoch: encrypted.epoch,
    envelope: encrypted.envelope,
    threadRootMessageId: parsed.threadRootId,
    forwardedFromMessageId: parsed.forwardedFrom?.messageId ?? null,
  };
}

/**
 * Encrypt a message waiting for acknowledgement again, with the same content and franking key,
 * in the group's current epoch.
 */
export async function reencrypt(
  work: Work,
  engine: MlsEngine,
  messageId: string,
): Promise<OutgoingMessage> {
  const record = await work.get<OutgoingRecord>("outgoing", outgoingKey(work, messageId));
  if (!record) throw new GroupError("INVALID_ARGS", "no message of this id waits to be sent");
  const state = await loadState(work, record.workspaceId, record.conversationId);
  if (state.incarnation === 0 || state.removed) throw noGroup();
  if (state.unverified.length > 0) throw blocked();
  const encrypted = JSON.parse(
    engine.reencrypt(
      record.conversationId,
      state.incarnation,
      record.content,
      record.frankingKey,
      record.commitment,
    ),
  ) as Encrypted;
  work.put("outgoing", {
    ...record,
    incarnation: state.incarnation,
    epoch: encrypted.epoch,
    envelope: encrypted.envelope,
  } satisfies OutgoingRecord);
  const row = await readRow(work, messageId);
  if (row) {
    const e2ee = { ...(row.payload.e2ee as object), incarnation: state.incarnation };
    work.put("messages", {
      ...row,
      payload: { ...row.payload, e2ee: { ...e2ee, epoch: encrypted.epoch } },
    });
  }
  const content = JSON.parse(record.content) as {
    threadRootId: string | null;
    forwardedFrom: { messageId: string } | null;
  };
  return {
    messageId,
    incarnation: state.incarnation,
    epoch: encrypted.epoch,
    envelope: encrypted.envelope,
    threadRootMessageId: content.threadRootId,
    forwardedFromMessageId: content.forwardedFrom?.messageId ?? null,
  };
}

interface AcceptedMessage {
  sentAt?: string;
  encryption?: { frankingReceipt?: string; frankingKeyId?: number; sentAtUs?: string } | null;
}

/**
 * The server answered a message or an edit: `accepted` is the message it returned, `null` when
 * it refused it for good. A refusal removes a new message's row (its body goes back to the
 * composer) or puts an edited row back as it was.
 */
export async function settle(
  work: Work,
  messageId: string,
  accepted: unknown,
): Promise<{ unsentBody: string | null }> {
  const key = outgoingKey(work, messageId);
  const record = await work.get<OutgoingRecord>("outgoing", key);
  if (!record) return { unsentBody: null };
  work.delete("outgoing", key);
  const row = await readRow(work, messageId);
  const message = accepted as AcceptedMessage | null;
  if (message && record.kind === "send") {
    if (!row) return { unsentBody: null };
    const sentAtUs = message.sentAt ? timestampUs(message.sentAt) : null;
    const e2ee = {
      ...(row.payload.e2ee as object),
      receipt: message.encryption?.frankingReceipt ?? null,
      receiptKeyId: message.encryption?.frankingKeyId ?? null,
      sentAtUs: message.encryption?.sentAtUs ?? null,
    };
    work.put("messages", {
      ...row,
      e2eeState: row.e2eeState === "outgoing" ? "decrypted" : row.e2eeState,
      sentAtUs: sentAtUs ?? row.sentAtUs,
      payload: { ...row.payload, sentAt: message.sentAt ?? row.payload.sentAt, e2ee },
    });
    return { unsentBody: null };
  }
  if (message) return { unsentBody: null };
  if (record.kind === "send") {
    if (row?.e2eeState !== "outgoing") return { unsentBody: null };
    work.delete("messages", rowKey(work.account, messageId));
    return { unsentBody: row.text };
  }
  if (record.previous && row) {
    work.put("messages", { ...row, text: record.previous.text, payload: record.previous.payload });
  }
  return { unsentBody: null };
}

/** The entry of a stored message's attachment, by blob hash. */
export async function attachmentEntry(
  work: Work,
  messageId: string,
  blobSha256: string,
): Promise<AttachmentEntry | null> {
  const row = await readRow(work, messageId);
  if (!row || (row.e2eeState !== "decrypted" && row.e2eeState !== "outgoing")) return null;
  const content = (row.payload.e2ee as { content?: string } | undefined)?.content;
  if (!content) return null;
  const parsed = JSON.parse(content) as { attachments?: AttachmentEntry[] };
  return parsed.attachments?.find((a) => a.blobSha256 === blobSha256) ?? null;
}
