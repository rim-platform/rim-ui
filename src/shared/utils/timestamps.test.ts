import { describe, expect, it } from "vitest";

import { isAfter } from "./timestamps";

describe("isAfter", () => {
  it("orders times inside one millisecond", () => {
    expect(isAfter("2026-11-06T19:55:18.992026+00:00", "2026-11-06T19:55:18.992025+00:00")).toBe(
      true,
    );
    expect(isAfter("2026-11-06T19:55:18.992025+00:00", "2026-11-06T19:55:18.992026+00:00")).toBe(
      false,
    );
  });

  it("treats one instant written two ways as equal", () => {
    expect(isAfter("2026-11-06T19:55:18.992026Z", "2026-11-06T19:55:18.992026+00:00")).toBe(false);
    expect(isAfter("2026-11-06T19:55:18.992026+00:00", "2026-11-06T19:55:18.992026Z")).toBe(false);
    expect(isAfter("2026-11-06T19:55:18Z", "2026-11-06T19:55:18.000+00:00")).toBe(false);
  });

  it("orders times with a different number of digits", () => {
    expect(isAfter("2026-11-06T19:55:18.5Z", "2026-11-06T19:55:18.499999Z")).toBe(true);
    expect(isAfter("2026-11-06T19:55:19Z", "2026-11-06T19:55:18.999999+00:00")).toBe(true);
  });

  it("compares across offsets", () => {
    expect(isAfter("2026-11-06T20:00:00+01:00", "2026-11-06T18:59:59Z")).toBe(true);
  });
});
