import { describe, expect, it } from "vitest";

import { HOLD_MAX, HOLD_MS, StreamSequencer } from "./sequencer";
import { streamMatches } from "./streamRules";

describe("StreamSequencer", () => {
  it("takes the first event as the baseline, then applies in order and drops duplicates", () => {
    const s = new StreamSequencer<string>(null);
    expect(s.offerAt(7, "a", 0)).toEqual({ apply: ["a"], dropped: [] });
    expect(s.offerAt(8, "b", 0).apply).toEqual(["b"]);
    expect(s.offerAt(8, "b again", 0)).toEqual({ apply: [], dropped: ["b again"] });
    expect(s.offerAt(3, "old", 0).dropped).toEqual(["old"]);
    expect(s.lastSeq).toBe(8);
  });

  it("holds events after a gap and releases them when the missing one arrives", () => {
    const s = new StreamSequencer<number>(10);
    expect(s.offerAt(12, 12, 0).apply).toEqual([]);
    expect(s.offerAt(13, 13, 0).apply).toEqual([]);
    expect(s.offerAt(12, 12, 0).dropped).toEqual([12]);
    expect(s.heldCount).toBe(2);
    expect(s.offerAt(11, 11, 0).apply).toEqual([11, 12, 13]);
    expect(s.heldCount).toBe(0);
    expect(s.lastSeq).toBe(13);
  });

  it("asks to reconcile after 30 seconds or 256 held events", () => {
    const timed = new StreamSequencer<number>(0);
    timed.offerAt(2, 2, 1_000);
    expect(timed.due(1_000 + HOLD_MS - 1)).toBe(false);
    expect(timed.due(1_000 + HOLD_MS)).toBe(true);

    const crowded = new StreamSequencer<number>(0);
    for (let seq = 2; seq < HOLD_MAX + 1; seq++) crowded.offerAt(seq, seq, 0);
    expect(crowded.due(0)).toBe(false);
    crowded.offerAt(HOLD_MAX + 1, HOLD_MAX + 1, 0);
    expect(crowded.due(0)).toBe(true);
  });

  it("moves to the head on reconciling and applies what is held right above it", () => {
    const s = new StreamSequencer<number>(1);
    for (const seq of [3, 4, 6, 7]) s.offerAt(seq, seq, 0);
    const outcome = s.reconciled(5);
    expect(outcome.dropped).toEqual([3, 4]);
    expect(outcome.apply).toEqual([6, 7]);
    expect(s.lastSeq).toBe(7);
    expect(s.due(Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("never moves back on a head below what it applied", () => {
    const s = new StreamSequencer<number>(9);
    expect(s.reconciled(4)).toEqual({ apply: [], dropped: [] });
    expect(s.lastSeq).toBe(9);
  });
});

describe("streamMatches", () => {
  const me = "rimp1_me";
  const conv = "0199d1a0-0000-7000-8000-000000000003";

  it("puts a conversation's events on its own stream only", () => {
    const event = { type: "NewMessage", conversation_id: conv };
    expect(streamMatches({ stream: `c:${conv}`, seq: 1, event }, me)).toBe(true);
    expect(streamMatches({ stream: "c:another", seq: 1, event }, me)).toBe(false);
    expect(streamMatches({ stream: "w", seq: 1, event }, me)).toBe(false);
  });

  it("takes a person's events only on this app's own stream", () => {
    const invite = { type: "DmInvite", conversation_id: conv };
    expect(streamMatches({ stream: `u:${me}`, seq: 1, event: invite }, me)).toBe(true);
    expect(streamMatches({ stream: "u:rimp1_other", seq: 1, event: invite }, me)).toBe(false);
    expect(streamMatches({ stream: `c:${conv}`, seq: 1, event: invite }, me)).toBe(false);
  });

  it("takes join request events only on this app's own stream", () => {
    for (const type of ["JoinRequestCreated", "JoinRequestDecided"]) {
      const event = { type };
      expect(streamMatches({ stream: `u:${me}`, seq: 1, event }, me)).toBe(true);
      expect(streamMatches({ stream: "u:rimp1_other", seq: 1, event }, me)).toBe(false);
      expect(streamMatches({ stream: "w", seq: 1, event }, me)).toBe(false);
    }
  });

  it("keeps typing and presence on the ephemeral stream without a seq", () => {
    const typing = { type: "TypingStarted", conversation_id: conv };
    expect(streamMatches({ stream: "e", seq: null, event: typing }, me)).toBe(true);
    expect(streamMatches({ stream: "e", seq: 3, event: typing }, me)).toBe(false);
    expect(streamMatches({ stream: `c:${conv}`, seq: 3, event: typing }, me)).toBe(false);
    expect(streamMatches({ stream: "e", seq: null, event: { type: "NewMessage" } }, me)).toBe(
      false,
    );
  });

  it("puts space-wide events without a conversation on w", () => {
    expect(streamMatches({ stream: "w", seq: 4, event: { type: "MemberJoined" } }, me)).toBe(true);
    expect(streamMatches({ stream: "w", seq: null, event: { type: "MemberJoined" } }, me)).toBe(
      false,
    );
  });
});
