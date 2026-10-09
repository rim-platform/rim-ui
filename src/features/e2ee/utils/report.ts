/**
 * Reports of encrypted messages: what the reporter's device reveals (the exact content, its
 * franking key and the server's receipt, from the cache row) and how a moderator reads the
 * verified content back.
 */

import type { ReportEncryptedMessageInput } from "../../../core/graphql/generated/schema-types";
import type { MessageItem } from "../../../core/types/messages";
import { b64, unb64, utf8 } from "../../key-identity/browser/bytes";

/**
 * The `reportEncryptedMessage` input for a cached encrypted message, or why this device cannot
 * report it.
 */
export function encryptedReport(
  message: MessageItem,
  serverId: string,
  reason: string,
): { input: ReportEncryptedMessageInput } | { refusal: string } {
  const e2ee = message.e2ee;
  if (!e2ee || e2ee.status === "undecryptable") {
    return {
      refusal: "This device could not decrypt this message, so it cannot prove what it said.",
    };
  }
  if (e2ee.status === "invalid") {
    return { refusal: "This message could not be verified, so it cannot be reported." };
  }
  const { content, frankingKey, receipt, receiptKeyId, sentAtUs } = e2ee;
  if (!content || !frankingKey || !receipt || receiptKeyId == null || !sentAtUs) {
    return { refusal: "This message has not reached the server yet. Try again in a moment." };
  }
  return {
    input: {
      serverId,
      conversationId: message.conversationId,
      messageId: message.id,
      reason,
      content: b64(utf8(content)),
      frankingKey,
      receipt,
      receiptKeyId,
      senderUserId: message.authorId,
      senderDeviceId: e2ee.senderDeviceId,
      sentAtUs,
    },
  };
}

/** An attachment entry of a reported message's content. */
export interface ReportedAttachment {
  blobSha256: string;
  name: string;
  mime: string;
  size: number;
}

/** What a moderator is shown of a reported message's verified content. */
export interface ReportedContent {
  /** The exact content bytes, which the attachment download decrypts against. */
  bytes: Uint8Array;
  body: string;
  attachments: ReportedAttachment[];
}

/** The verified content of a report (base64url), or `null` when it does not read as content. */
export function parseReportedContent(frankedContent: string): ReportedContent | null {
  try {
    const bytes = unb64(frankedContent);
    if (!bytes) return null;
    const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof json !== "object" || json === null) return null;
    const { body, attachments } = json as { body?: unknown; attachments?: unknown };
    if (typeof body !== "string" || !Array.isArray(attachments)) return null;
    return {
      bytes,
      body,
      attachments: attachments.flatMap((a: unknown) => {
        if (typeof a !== "object" || a === null) return [];
        const { blobSha256, name, mime, size } = a as Record<string, unknown>;
        if (
          typeof blobSha256 !== "string" ||
          typeof name !== "string" ||
          typeof mime !== "string" ||
          typeof size !== "number"
        ) {
          return [];
        }
        return [{ blobSha256, name, mime, size }];
      }),
    };
  } catch {
    return null;
  }
}
