import { afterEach, describe, expect, it, vi } from "vitest";

import { formatShortTime } from "./formatShortTime";

describe("formatShortTime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for the hour without a leading zero", () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleTimeString");
    formatShortTime(new Date(2026, 3, 5, 9, 15).toISOString());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({ hour: "numeric", minute: "2-digit" });
  });

  it("wraps the time in brackets", () => {
    expect(formatShortTime(new Date(2026, 3, 5, 9, 15).toISOString())).toMatch(/^\[.+\]$/);
  });
});
