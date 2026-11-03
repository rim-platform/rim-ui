import { describe, expect, it } from "vitest";

import type { MemberRemoval } from "../../conversations/api/useMemberRemovals";
import type { TimelineMessage } from "../../e2ee/utils/timeline";
import { timelineNotice } from "../../e2ee/utils/timeline";
import { withRemovalNotices } from "./removalNotices";

function message(id: string, sentAt: string): TimelineMessage {
  return { ...timelineNotice(id, sentAt), text: id };
}

function removal(id: string, removedAt: string): MemberRemoval {
  return { id, userId: "bob", removedById: "alice", removedAt, user: null, removedBy: null };
}

const items = [message("m1", "2026-11-01T10:00:00Z"), message("m2", "2026-11-01T11:00:00Z")];

const ids = (list: TimelineMessage[]) => list.map((m) => m.id);

describe("withRemovalNotices", () => {
  it("returns the same items when nothing was removed", () => {
    expect(withRemovalNotices(items, [], true)).toBe(items);
  });

  it("puts a removal between the messages around it, with a removal id", () => {
    const out = withRemovalNotices(items, [removal("r1", "2026-11-01T10:30:00Z")], false);
    expect(ids(out)).toEqual(["m1", "removal:r1", "m2"]);
    expect(out[1].membershipNotice).toMatchObject({ kind: "removed", removal: { id: "r1" } });
    expect(out[1].sentAt).toBe("2026-11-01T10:30:00Z");
  });

  it("puts a removal after the newest message when nothing was sent since", () => {
    const out = withRemovalNotices(items, [removal("r1", "2026-11-01T12:00:00Z")], false);
    expect(ids(out)).toEqual(["m1", "m2", "removal:r1"]);
  });

  it("keeps several removals in the order they happened", () => {
    const out = withRemovalNotices(
      items,
      [removal("late", "2026-11-01T12:00:00Z"), removal("early", "2026-11-01T10:30:00Z")],
      false,
    );
    expect(ids(out)).toEqual(["m1", "removal:early", "m2", "removal:late"]);
  });

  it("waits for its page when a removal is older than every loaded message", () => {
    const old = removal("r1", "2026-11-01T09:00:00Z");
    expect(ids(withRemovalNotices(items, [old], false))).toEqual(["m1", "m2"]);
    expect(ids(withRemovalNotices(items, [old], true))).toEqual(["removal:r1", "m1", "m2"]);
  });

  it("shows nothing while there are no messages and an older page may exist", () => {
    const only = [removal("r1", "2026-11-01T09:00:00Z")];
    expect(withRemovalNotices([], only, false)).toEqual([]);
    expect(ids(withRemovalNotices([], only, true))).toEqual(["removal:r1"]);
  });
});
