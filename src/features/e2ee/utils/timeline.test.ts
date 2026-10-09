import { describe, expect, it } from "vitest";

import type { MessageE2ee, MessageItem } from "../../../core/types/messages";
import { withEncryptionNotices, type TimelineMessage } from "./timeline";

function message(id: string, sentAt: string, extra: Partial<MessageItem> = {}): MessageItem {
  return {
    id,
    serverId: "ws",
    conversationId: "c",
    authorId: "u-a",
    author: null,
    text: id,
    hasAttachments: false,
    isPinned: false,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    sentAt,
    reactions: [],
    attachments: [],
    linkPreviews: [],
    ...extra,
  };
}

function e2ee(status: MessageE2ee["status"], incarnation = 1): MessageE2ee {
  return { status, incarnation, epoch: 1, senderDeviceId: "d" };
}

const context = {
  encryptedAt: "2026-10-09T10:00:00Z",
  resets: [{ incarnation: 2, principalId: "rimp1_bob", deviceId: "dev-b" }],
  userOfPrincipal: (p: string) => (p === "rimp1_bob" ? "u-b" : undefined),
};

const shape = (items: TimelineMessage[]) =>
  items.map((m) => (m.e2eeNotice ? `[${m.e2eeNotice.kind}]` : m.id));

describe("withEncryptionNotices", () => {
  it("leaves a plaintext conversation alone", () => {
    const items = [message("a", "2026-10-09T09:00:00Z")];
    expect(withEncryptionNotices(items, { ...context, encryptedAt: null })).toBe(items);
  });

  it("marks where encryption starts and notes older plaintext", () => {
    const items = withEncryptionNotices(
      [
        message("old", "2026-10-09T09:00:00Z"),
        message("new", "2026-10-09T11:00:00Z", {
          e2ee: e2ee("decrypted"),
          text: "hi <@rimp1_bob>",
        }),
      ],
      context,
    );
    expect(shape(items)).toEqual(["old", "[encryptedFrom]", "new"]);
    expect(items[0].beforeEncryption).toBe(true);
    expect(items[2].text).toBe("hi <@u-b>");
  });

  it("collapses what this device cannot read into one line, and says who reset", () => {
    const items = withEncryptionNotices(
      [
        message("p1", "2026-10-09T10:01:00Z", { e2ee: e2ee("undecryptable") }),
        message("p2", "2026-10-09T10:02:00Z", { e2ee: e2ee("undecryptable") }),
        message("m1", "2026-10-09T10:03:00Z", { e2ee: e2ee("decrypted") }),
        message("m2", "2026-10-09T10:04:00Z", { e2ee: e2ee("decrypted", 2) }),
      ],
      context,
    );
    expect(shape(items)).toEqual(["[encryptedFrom]", "[earlier]", "m1", "[reset]", "m2"]);
    expect(items[1].e2eeNotice).toEqual({ kind: "earlier", count: 2 });
    expect(items[3].e2eeNotice).toEqual({
      kind: "reset",
      incarnation: 2,
      principalId: "rimp1_bob",
      deviceId: "dev-b",
    });
  });

  it("places the marker last when every loaded message predates encryption", () => {
    const items = withEncryptionNotices([message("old", "2026-10-09T09:00:00Z")], context);
    expect(shape(items)).toEqual(["old", "[encryptedFrom]"]);
  });
});
