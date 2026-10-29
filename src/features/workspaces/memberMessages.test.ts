import { describe, expect, it } from "vitest";

import {
  DELETE_PERIODS,
  countOf,
  deletedText,
  messagesToDelete,
  periodSince,
  tallyText,
} from "./memberMessages";

const NOW = Date.parse("2026-10-05T10:00:00.000Z");

describe("member message deletion helpers", () => {
  it("turns each period into its start and everything into no bound", () => {
    expect(periodSince("1h", NOW)).toBe("2026-10-05T09:00:00.000Z");
    expect(periodSince("24h", NOW)).toBe("2026-10-04T10:00:00.000Z");
    expect(periodSince("7d", NOW)).toBe("2026-09-28T10:00:00.000Z");
    expect(periodSince("all", NOW)).toBeNull();
    expect(periodSince("none", NOW)).toBeNull();
    expect(DELETE_PERIODS.map((p) => p.label)).toEqual([
      "Last hour",
      "Last 24 hours",
      "Last 7 days",
      "Everything",
    ]);
  });

  it("counts messages and channels in words, singular for one", () => {
    expect(countOf(0, "message")).toBe("0 messages");
    expect(countOf(1, "message")).toBe("1 message");
    expect(countOf(2, "channel")).toBe("2 channels");
    expect(tallyText({ messages: 38, channels: 3 })).toBe("38 messages in 3 channels");
    expect(tallyText({ messages: 1, channels: 1 })).toBe("1 message in 1 channel");
  });

  it("adds the private channels the viewer is not in only when included", () => {
    const counts = {
      readable: { messages: 38, channels: 3 },
      unjoinedPrivate: { messages: 4, channels: 1 },
    };
    expect(messagesToDelete(counts, true)).toBe(42);
    expect(messagesToDelete(counts, false)).toBe(38);
  });

  it("says more remain after the most rounds", () => {
    expect(deletedText({ deleted: 1, hasMore: false })).toBe("Deleted 1 message");
    expect(deletedText({ deleted: 50000, hasMore: true })).toBe(
      "Deleted 50000 messages; more remain, run Delete messages again",
    );
  });
});
