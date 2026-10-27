/**
 * Which unencrypted conversations already showed their "not encrypted" dialog on this device,
 * per account. Kept sealed with the account's other values (the newest 1000), and in memory for
 * this session too.
 */

import { readSealedItem, writeSealedItem } from "../../../core/accountVault/sealedStorage";

const STORAGE_KEY = "rim.e2ee.plaintextNoticeSeen";
const KEEP = 1000;

const seenThisSession = new Set<string>();

function noticeKey(userId: string, conversationId: string): string {
  return `${userId}/${conversationId}`;
}

function readSeen(): string[] {
  try {
    const parsed: unknown = JSON.parse(readSealedItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** Whether `userId` already dismissed the dialog of `conversationId` on this device. */
export function plaintextNoticeSeen(userId: string, conversationId: string): boolean {
  const key = noticeKey(userId, conversationId);
  return seenThisSession.has(key) || readSeen().includes(key);
}

/** Remember that `userId` dismissed the dialog of `conversationId`. */
export function rememberPlaintextNotice(userId: string, conversationId: string): void {
  const key = noticeKey(userId, conversationId);
  seenThisSession.add(key);
  const known = readSeen().filter((k) => k !== key);
  writeSealedItem(STORAGE_KEY, JSON.stringify([...known, key].slice(-KEEP)));
}
