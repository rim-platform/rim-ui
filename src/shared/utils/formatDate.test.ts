import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRelativeDate } from "./formatDate";

describe("formatRelativeDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'Today' for a date earlier today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T18:00:00Z"));
    expect(formatRelativeDate("2026-04-05T10:00:00Z")).toBe("Today");
  });

  it("returns 'Yesterday' for a date one day ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    expect(formatRelativeDate("2026-04-04T12:00:00Z")).toBe("Yesterday");
  });

  it("returns 'X days ago' for dates less than 30 days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    expect(formatRelativeDate("2026-03-29T12:00:00Z")).toBe("7 days ago");
  });

  it("returns '1 month ago' for a date ~30 days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    expect(formatRelativeDate("2026-03-05T12:00:00Z")).toBe("1 month ago");
  });

  it("returns plural months for dates several months ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    expect(formatRelativeDate("2026-01-01T12:00:00Z")).toBe("3 months ago");
  });

  it("returns '1 year ago' for a date ~365 days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    expect(formatRelativeDate("2025-04-01T12:00:00Z")).toBe("1 year ago");
  });

  it("returns plural years for dates multiple years ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00Z"));
    expect(formatRelativeDate("2024-01-01T12:00:00Z")).toBe("2 years ago");
  });
});
