/**
 * The encrypted send path: messages, thread replies, timeline replies, forwards and edits.
 *
 * Before sending, the device runs the client loop and commits pending changes (the server
 * refuses a message while removals are pending). The plaintext is stored under the message id
 * this device chose (UUID v7) before the envelope leaves; `STALE_EPOCH` sends the same content
 * again in the newer epoch with the same id. Attachments are encrypted first and uploaded once
 * the message exists; link previews are fetched here, by the sender only.
 */

import { getApiOrigin } from "../../../core/graphql/config";
import { graphqlErrorCode } from "../../../core/graphql/errors";
import { logger } from "../../../core/logger";
import { featureDisabledFromResponse } from "../../../core/serverFeatures";
import type { MessageAuthor, MessageItem } from "../../../core/types/messages";
import { hostOf } from "../../relay/state/useRelayStore";
import { asResponse, remoteFetch } from "../../relay/transport/remoteFetch";
import {
  createAttachment,
  finalizeAttachment,
  uploadFileRest,
} from "../../messages/api/useAttachments";
import {
  editEncryptedMessage,
  fetchConversationGroup,
  fetchMessageAttachments,
  sendEncryptedMessage,
} from "../api/e2eeApi";
import {
  E2eeCommandError,
  e2eeCommands,
  encryptAttachment,
  fetchLinkPreview,
  type DraftInput,
  type OutgoingMessage,
} from "../api/e2eeCommands";
import {
  catchUp,
  commitPendingLocked,
  createGroupLocked,
  invalidateTimeline,
  MLS_COMMIT_REQUIRED,
  STALE_EPOCH,
  withConversation,
} from "./groups";
import { e2eeSession, type E2eeSession } from "./session";

/** Attempts of a send that keeps meeting newer epochs or pending Commits. */
const SEND_ATTEMPTS = 3;
const URL_PATTERN = /https?:\/\/[^\s<>()]+/g;

/** Why an encrypted send did not go through. */
export class EncryptedSendError extends Error {
  /** The body of a message that was never sent, to give back to the composer. */
  readonly unsentBody: string | null;
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined, unsentBody: string | null) {
    super(message);
    this.name = "EncryptedSendError";
    this.code = code;
    this.unsentBody = unsentBody;
  }
}

export interface EncryptedDraft {
  /** Mentions already as `<@principalId>` tokens. */
  body: string;
  author: MessageAuthor;
  threadRootId?: string | null;
  threadId?: string | null;
  replyTo?: string | null;
  forwardedFrom?: DraftInput["forwardedFrom"];
  files?: File[];
  /** Blob hashes of a forwarded encrypted message's attachments, and that message's id. */
  forwardAttachments?: { messageId: string; conversationId: string; blobSha256: string[] };
}

async function requireSession(): Promise<E2eeSession> {
  const session = await e2eeSession();
  if (!session) {
    throw new EncryptedSendError(
      "This device is not set up for encrypted conversations",
      "E2EE_NO_DEVICE",
      null,
    );
  }
  return session;
}

/** Previews of the body's first links, fetched by this device. */
async function linkPreviews(body: string): Promise<DraftInput["linkPreviews"]> {
  const urls = [...new Set(body.match(URL_PATTERN) ?? [])].slice(0, 3);
  const previews = await Promise.all(urls.map((url) => fetchLinkPreview(url).catch(() => null)));
  return previews.flatMap((p) => (p ? [p] : []));
}

/** Make sure the group exists and nothing blocks a message: the loop, then pending removes. */
async function prepare(session: E2eeSession, workspaceId: string, conversationId: string) {
  await catchUp(session, workspaceId, conversationId);
  const info = await fetchConversationGroup(workspaceId, conversationId);
  if (!info.mlsGroup) {
    await createGroupLocked(session, workspaceId, conversationId);
    return;
  }
  if (info.mlsGroup.pendingRemoves.length > 0) {
    await commitPendingLocked(session, workspaceId, conversationId);
  }
}

/**
 * Deliver an envelope, re-encrypting it after `STALE_EPOCH` or a required Commit. Returns the
 * server's message; on any other refusal the stored plaintext is undone and the error thrown.
 */
async function deliver(
  session: E2eeSession,
  workspaceId: string,
  conversationId: string,
  first: OutgoingMessage,
  send: (out: OutgoingMessage) => Promise<MessageItem>,
): Promise<MessageItem> {
  let out = first;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < SEND_ATTEMPTS; attempt += 1) {
    try {
      const message = await send(out);
      await e2eeCommands.settleMessage(session.account, out.messageId, message);
      return message;
    } catch (err) {
      lastError = err;
      const code = graphqlErrorCode(err);
      if (code === STALE_EPOCH) {
        await catchUp(session, workspaceId, conversationId);
      } else if (code === MLS_COMMIT_REQUIRED) {
        await prepare(session, workspaceId, conversationId);
      } else if (code === undefined && !(err instanceof E2eeCommandError)) {
        // No answer: the same bytes again are answered with the stored message.
        continue;
      } else {
        break;
      }
      out = await e2eeCommands.reencryptMessage(session.account, out.messageId);
    }
  }
  const settled = await e2eeCommands
    .settleMessage(session.account, out.messageId, null)
    .catch(() => ({ unsentBody: null }));
  throw new EncryptedSendError(
    lastError instanceof Error ? lastError.message : "The message could not be sent",
    graphqlErrorCode(lastError),
    settled.unsentBody,
  );
}

async function uploadEncrypted(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  blobs: { blob: Uint8Array; blobSha256: string }[],
) {
  for (const { blob, blobSha256 } of blobs) {
    const ticket = await createAttachment({
      serverId: workspaceId,
      conversationId,
      messageId,
      filename: "encrypted",
      contentType: "application/octet-stream",
      sizeBytes: blob.byteLength,
      blobSha256,
    });
    const file = new File([blob as BlobPart], "encrypted", { type: "application/octet-stream" });
    await uploadFileRest(
      file,
      ticket.createAttachment.uploadToken,
      ticket.createAttachment.attachmentId,
      workspaceId,
    );
    await finalizeAttachment({
      attachmentId: ticket.createAttachment.attachmentId,
      serverId: workspaceId,
    });
  }
}

/**
 * Download an attachment's blob as stored on the server (still encrypted): from this server,
 * or through the relay from the host of a space elsewhere.
 */
export async function downloadBlob(workspaceId: string, attachmentId: string): Promise<Uint8Array> {
  const path = `/api/attachments/${attachmentId}/download`;
  const host = hostOf(workspaceId);
  if (host) {
    const res = await remoteFetch(host, path, { method: "GET" });
    if (res.status < 200 || res.status >= 300) {
      throw (
        (await featureDisabledFromResponse(asResponse(res))) ??
        new Error(`Download failed: ${res.status}`)
      );
    }
    return res.body;
  }
  const res = await fetch(`${getApiOrigin()}${path}`, { credentials: "include" });
  if (!res.ok) {
    throw (await featureDisabledFromResponse(res)) ?? new Error(`Download failed: ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Download a reported message's attachment blob through the report (moderators only). */
export async function downloadReportedBlob(
  reportId: string,
  blobSha256: string,
): Promise<Uint8Array> {
  const res = await fetch(
    `${getApiOrigin()}/api/reports/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(blobSha256)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The blobs of a forwarded encrypted message, to upload again under the new message. */
async function forwardedBlobs(
  workspaceId: string,
  source: NonNullable<EncryptedDraft["forwardAttachments"]>,
): Promise<{ blob: Uint8Array; blobSha256: string }[]> {
  if (source.blobSha256.length === 0) return [];
  const uploads = await fetchMessageAttachments(
    workspaceId,
    source.conversationId,
    source.messageId,
  );
  const out: { blob: Uint8Array; blobSha256: string }[] = [];
  for (const hash of source.blobSha256) {
    const upload = uploads.find((u) => u.blobSha256 === hash);
    if (upload) out.push({ blob: await downloadBlob(workspaceId, upload.id), blobSha256: hash });
  }
  return out;
}

/** Send a new encrypted message. Returns its id once the server has it. */
export async function sendEncrypted(
  workspaceId: string,
  conversationId: string,
  draft: EncryptedDraft,
): Promise<string> {
  const session = await requireSession();
  return withConversation(conversationId, async () => {
    await prepare(session, workspaceId, conversationId);
    const files = await Promise.all(
      (draft.files ?? []).map(async (file) =>
        encryptAttachment(
          new Uint8Array(await file.arrayBuffer()),
          file.name,
          file.type || "application/octet-stream",
        ),
      ),
    );
    const forwarded = draft.forwardAttachments
      ? await forwardedBlobs(workspaceId, draft.forwardAttachments).catch((err: unknown) => {
          logger.warn("[RIM:e2ee] forwarded attachments could not be fetched:", err);
          return [];
        })
      : [];
    const out = await e2eeCommands.encryptMessage(
      session.account,
      workspaceId,
      conversationId,
      {
        body: draft.body,
        threadRootId: draft.threadRootId ?? null,
        threadId: draft.threadId ?? null,
        replyTo: draft.replyTo ?? null,
        forwardedFrom: draft.forwardedFrom ?? null,
        attachments: [...files, ...forwarded].map((f) => f.blobSha256),
        linkPreviews: await linkPreviews(draft.body),
        authorId: session.userId,
        author: draft.author,
      },
      draft.forwardAttachments?.messageId ?? null,
    );
    // The plaintext is stored: the timeline shows it while it is sent.
    invalidateTimeline(workspaceId, conversationId);
    const message = await deliver(session, workspaceId, conversationId, out, (o) =>
      sendEncryptedMessage({
        serverId: workspaceId,
        conversationId,
        messageId: o.messageId,
        envelope: o.envelope,
        threadRootMessageId: o.threadRootMessageId,
        forwardedFromMessageId: o.forwardedFromMessageId,
      }),
    ).finally(() => invalidateTimeline(workspaceId, conversationId));
    await uploadEncrypted(workspaceId, conversationId, message.id, [...files, ...forwarded]);
    invalidateTimeline(workspaceId, conversationId);
    return message.id;
  });
}

/** Edit an encrypted message: the whole new content, one revision higher. */
export async function editEncrypted(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  body: string,
  author: MessageAuthor,
): Promise<void> {
  const session = await requireSession();
  await withConversation(conversationId, async () => {
    await prepare(session, workspaceId, conversationId);
    const out = await e2eeCommands.encryptMessage(session.account, workspaceId, conversationId, {
      editOf: messageId,
      body,
      linkPreviews: await linkPreviews(body),
      authorId: session.userId,
      author,
    });
    invalidateTimeline(workspaceId, conversationId);
    await deliver(session, workspaceId, conversationId, out, (o) =>
      editEncryptedMessage({
        serverId: workspaceId,
        conversationId,
        messageId: o.messageId,
        envelope: o.envelope,
      }),
    ).finally(() => invalidateTimeline(workspaceId, conversationId));
  });
}
