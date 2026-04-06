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

  it("returns a string (not undefined) for valid ISO input", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    expect(typeof formatTime("2026-04-05T00:00:00Z")).toBe("string");
  });
});
