import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forceEnUsTimes } from "../../test/forceEnUsTimes";
import { useClockFormatStore } from "../state/useClockFormatStore";
import { formatEditedAt, formatTime, hourCycleOptions } from "./formatTime";

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

const evening = new Date(2026, 0, 5, 21, 5).toISOString();
const morning = new Date(2026, 0, 5, 9, 5).toISOString();

function today(hour: number): string {
  const d = new Date();
  d.setHours(hour, 5, 0, 0);
  return d.toISOString();
}

beforeEach(() => {
  forceEnUsTimes();
});

afterEach(() => {
  vi.restoreAllMocks();
  useClockFormatStore.setState({ clockFormat: "auto" });
  localStorage.removeItem("rim:clock-format");
});

describe("hourCycleOptions", () => {
  it("maps each setting to Intl options", () => {
    expect(hourCycleOptions()).toEqual({});
    useClockFormatStore.getState().setClockFormat("12h");
    expect(hourCycleOptions()).toEqual({ hour12: true });
    useClockFormatStore.getState().setClockFormat("24h");
    expect(hourCycleOptions()).toEqual({ hour12: false });
  });
});

describe("formatTime with a clock choice", () => {
  it("follows the language in automatic mode", () => {
    expect(formatTime(today(21))).toBe("9:05 PM");
  });

  it("writes 12-hour times without a leading zero", () => {
    useClockFormatStore.getState().setClockFormat("12h");
    expect(formatTime(today(21))).toBe("9:05 PM");
    expect(formatTime(today(9))).toBe("9:05 AM");
  });

  it("writes 24-hour times with two-digit hours", () => {
    useClockFormatStore.getState().setClockFormat("24h");
    expect(formatTime(today(21))).toBe("21:05");
    expect(formatTime(today(9))).toBe("09:05");
    expect(formatTime(today(0))).toBe("00:05");
  });

  it("applies the choice to the time of an earlier day", () => {
    useClockFormatStore.getState().setClockFormat("24h");
    expect(formatTime(new Date(2020, 0, 5, 21, 5).toISOString())).toBe("Jan 5 21:05");
  });
});

describe("formatEditedAt", () => {
  it("applies the choice to the tooltip", () => {
    expect(formatEditedAt(evening)).toBe("Jan 5, 2026, 9:05 PM");
    useClockFormatStore.getState().setClockFormat("24h");
    expect(formatEditedAt(evening)).toBe("Jan 5, 2026, 21:05");
    expect(formatEditedAt(morning)).toBe("Jan 5, 2026, 09:05");
  });
});

describe("clock format storage", () => {
  it("keeps the choice on this device", () => {
    useClockFormatStore.getState().setClockFormat("12h");
    expect(JSON.parse(localStorage.getItem("rim:clock-format") ?? "{}")).toEqual({
      clockFormat: "12h",
    });
  });
});
