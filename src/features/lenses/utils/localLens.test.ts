import { describe, expect, it } from "vitest";

import { FilterField, FilterLogic, FilterOp } from "../../../core/graphql/generated/schema-types";
import type { MessageItem } from "../../../core/types/messages";
import { applyLensLocally, conditionMatches } from "./localLens";

function message(overrides: Partial<MessageItem>): MessageItem {
  return {
    id: "m",
    serverId: "ws",
    conversationId: "c",
    authorId: "u-ada",
    author: null,
    text: "deploy https://ci.example.com sev1",
    hasAttachments: true,
    isPinned: true,
    mentionedUserIds: [],
    forwardedFromMessageId: null,
    forwardedFrom: null,
    isDeleted: false,
    sentAt: "2026-10-01T09:00:00Z",
    reactions: [],
    attachments: [],
    linkPreviews: [],
    ...overrides,
  };
}

const plaintext = message({ id: "plain" });
const encrypted = message({
  id: "secret",
  e2ee: { status: "decrypted", incarnation: 1, epoch: 2, senderDeviceId: "d" },
});

describe("a lens applied on this device", () => {
  it("never matches an encrypted message on its text, whatever the condition asks", () => {
    for (const condition of [
      { field: FilterField.TEXT_CONTAINS, op: FilterOp.CONTAINS, value: "sev1" },
      { field: FilterField.HAS_LINKS, op: FilterOp.EQ, value: true },
      { field: FilterField.HAS_LINKS, op: FilterOp.EQ, value: false },
    ]) {
      expect(conditionMatches(encrypted, condition)).toBe(false);
    }
    expect(
      conditionMatches(plaintext, {
        field: FilterField.TEXT_CONTAINS,
        op: FilterOp.CONTAINS,
        value: "SEV1",
      }),
    ).toBe(true);
    expect(
      conditionMatches(plaintext, { field: FilterField.HAS_LINKS, op: FilterOp.EQ, value: true }),
    ).toBe(true);
  });

  it("matches encrypted messages on metadata", () => {
    for (const condition of [
      { field: FilterField.AUTHOR_ID, op: FilterOp.IN, value: ["u-ada"] },
      { field: FilterField.HAS_ATTACHMENTS, op: FilterOp.EQ, value: true },
      { field: FilterField.IS_PINNED, op: FilterOp.EQ, value: true },
    ]) {
      expect(conditionMatches(encrypted, condition)).toBe(true);
    }
  });

  it("combines conditions with AND or OR and drops tombstones", () => {
    const items = [plaintext, encrypted, message({ id: "gone", isDeleted: true })];
    const text = { field: FilterField.TEXT_CONTAINS, op: FilterOp.CONTAINS, value: "deploy" };
    const pinned = { field: FilterField.IS_PINNED, op: FilterOp.EQ, value: true };
    expect(
      applyLensLocally(items, { logic: FilterLogic.AND, conditions: [text, pinned] }).map(
        (m) => m.id,
      ),
    ).toEqual(["plain"]);
    expect(
      applyLensLocally(items, { logic: FilterLogic.OR, conditions: [text, pinned] }).map(
        (m) => m.id,
      ),
    ).toEqual(["plain", "secret"]);
  });
});
