import { describe, it, expect } from "vitest";

import { addKeywords, isValidTimeZone, tomorrowMorning, toTimeInput } from "./rules";

describe("addKeywords", () => {
  it("trims, lower-cases and deduplicates like the server", () => {
    expect(addKeywords(["deploy"], "  Outage , DEPLOY,outage")).toEqual({
      ok: true,
      keywords: ["deploy", "outage"],
    });
  });

  it("counts characters, not bytes", () => {
    expect(addKeywords([], "é".repeat(40))).toMatchObject({ ok: true });
    expect(addKeywords([], "é".repeat(41))).toMatchObject({ ok: false });
  });

  it("refuses control characters", () => {
    expect(addKeywords([], "tab\tbed")).toEqual({
      ok: false,
      error: "Keywords must not contain control characters.",
    });
  });

  it("allows 20 keywords but not 21, and a duplicate does not count", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `kw${i}`);
    expect(addKeywords(twenty, "kw3")).toEqual({ ok: true, keywords: twenty });
    expect(addKeywords(twenty, "extra")).toEqual({
      ok: false,
      error: "At most 20 keywords are allowed.",
    });
  });
});

describe("time helpers", () => {
  it("cuts seconds off server times", () => {
    expect(toTimeInput("07:30:00")).toBe("07:30");
    expect(toTimeInput("07:30")).toBe("07:30");
  });

  it("knows IANA zones", () => {
    expect(isValidTimeZone("Europe/Prague")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("tomorrow means 09:00 local on the next day", () => {
    const next = tomorrowMorning(new Date(2026, 9, 5, 23, 30));
    expect([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours()]).toEqual([
      2026, 9, 6, 9,
    ]);
  });
});
