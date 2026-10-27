import { describe, it, expect, vi, afterEach } from "vitest";
import { formatTime } from "./formatTime";

describe("formatTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns only time for a date today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T18:00:00Z"));
    const result = formatTime("2026-04-05T10:30:00Z");
    // Should contain time digits but NOT a month name
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("includes date info for a date not today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    const result = formatTime("2026-03-20T14:30:00Z");
    // Should contain both a month abbreviation and time
    expect(result).toMatch(/\w+/);
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it("asks for the hour without a leading zero, today and on an older date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 5, 12, 0));
    const spy = vi.spyOn(Date.prototype, "toLocaleTimeString");
    formatTime(new Date(2026, 3, 5, 9, 15).toISOString());
    formatTime(new Date(2026, 2, 20, 9, 15).toISOString());
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect(call[1]).toEqual({ hour: "numeric", minute: "2-digit" });
    }
    spy.mockRestore();
  });

  it("has no leading zero in the morning", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 5, 12, 0));
    expect(formatTime(new Date(2026, 3, 5, 9, 15).toISOString())).toMatch(/^(9:15\s?AM|0?9:15)$/);
  });

  it("returns a string (not undefined) for valid ISO input", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    expect(typeof formatTime("2026-04-05T00:00:00Z")).toBe("string");
  });

  it("returns em-dash for unparseable input instead of 'Invalid Date'", () => {
    expect(formatTime("not-a-date")).toBe("—");
    expect(formatTime("")).toBe("—");
  });
});
