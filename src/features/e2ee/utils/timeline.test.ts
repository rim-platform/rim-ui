import { describe, expect, it } from "vitest";

import type { MessageE2ee, MessageItem } from "../../../core/types/messages";
import { withEncryptionNotices, withSenderAsAuthor, type TimelineMessage } from "./timeline";

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

function e2ee(status: MessageE2ee["status"], incarnation = 1, epoch = 1): MessageE2ee {
  return { status, incarnation, epoch, senderDeviceId: "d" };
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

  it("finding 4: places who was added and removed where their Commits took effect", () => {
    const at = (n: number) => `2026-10-09T11:00:0${n}Z`;
    const items = withEncryptionNotices(
      [
        message("e1", at(1), { e2ee: e2ee("decrypted", 1, 1) }),
        message("e2", at(2), { e2ee: e2ee("decrypted", 1, 2) }),
        message("e3", at(3), { e2ee: e2ee("decrypted", 1, 4) }),
      ],
      {
        ...context,
        membership: [
          { incarnation: 1, epoch: 4, kind: "removed", principalId: "rimp1_carol" },
          { incarnation: 1, epoch: 1, kind: "added", principalId: "rimp1_old" },
          { incarnation: 1, epoch: 2, kind: "added", principalId: "rimp1_carol" },
          { incarnation: 1, epoch: 6, kind: "added", principalId: "rimp1_dave" },
        ],
      },
    );
    const lines = (m: TimelineMessage) =>
      m.e2eeNotice?.kind === "member"
        ? `${m.e2eeNotice.principalId} ${m.e2eeNotice.change}`
        : (m.e2eeNotice?.kind ?? m.id);
    // An event at the first loaded epoch may belong to an older page: it is left out.
    expect(items.map(lines)).toEqual([
      "encryptedFrom",
      "e1",
      "rimp1_carol added",
      "e2",
      "rimp1_carol removed",
      "e3",
      "rimp1_dave added",
    ]);
  });

  it("finding 5: shows a decrypted message as its MLS sender's, whoever the row names", () => {
    const decrypted = { ...e2ee("decrypted"), senderPrincipalId: "rimp1_bob" };
    const [, shown] = withEncryptionNotices(
      [message("m", "2026-10-09T11:00:00Z", { authorId: "u-a", e2ee: decrypted })],
      context,
    );
    expect(shown.authorId).toBe("u-b");
    expect(shown.author).toMatchObject({ id: "u-b", principalId: "rimp1_bob" });

    // A sender who is no member here is shown as such, never as the row's author.
    const stranger = withSenderAsAuthor(
      message("m", "2026-10-09T11:00:00Z", {
        e2ee: { ...decrypted, senderPrincipalId: "rimp1_x" },
      }),
      context.userOfPrincipal,
    );
    expect(stranger.authorId).toBe("rimp1_x");
    expect(stranger.author?.displayName).toBe("Unknown member");
    // A message that could not be verified keeps the row's author: it shows no content.
    const invalid = message("i", "2026-10-09T11:00:00Z", { e2ee: e2ee("invalid") });
    expect(withSenderAsAuthor(invalid, context.userOfPrincipal)).toBe(invalid);
  });
});
