import { describe, expect, it } from "vitest";

import {
  choiceKey,
  chosenTimeChoice,
  countInputOf,
  durationLabel,
  isoOfLocalInput,
  localInputOfIso,
  storedCountOf,
  timeField,
  timeFieldProblem,
  unusedTimeArguments,
  valuesForChoice,
} from "./timeChoices";

describe("time choices", () => {
  it("finds the choice saved values make, a preset before a typed length", () => {
    const ban = timeField("banEnd");
    expect(chosenTimeChoice(ban, {})?.id).toBe("none");
    expect(chosenTimeChoice(ban, { minutes: "43200" })?.id).toBe("for-30d");
    expect(chosenTimeChoice(ban, { minutes: "61" })?.id).toBe("for");
    expect(chosenTimeChoice(ban, { expires_at: "2999-01-01T00:00:00Z" })?.id).toBe("at");
    expect(chosenTimeChoice(ban, { minutes: "5", expires_at: "2999-01-01T00:00:00Z" })).toBe(
      undefined,
    );

    const mute = timeField("muteDuration");
    expect(chosenTimeChoice(mute, { duration: "" })).toBeUndefined();
    expect(chosenTimeChoice(mute, { duration: "forever" })?.id).toBe("forever");
  });

  it("keeps a picked choice while its count is still empty", () => {
    const ban = timeField("banEnd");
    const picked = valuesForChoice(
      ban,
      ban.choices.find((c) => c.id === "for"),
      {},
    );
    expect(picked).toEqual({ [choiceKey("expires_at")]: "for", expires_at: "", minutes: "" });
    expect(chosenTimeChoice(ban, picked)?.id).toBe("for");
    expect(timeFieldProblem(ban, picked)).toBe("Enter how long");
  });

  it("sends only what the chosen choice sets", () => {
    const pause = timeField("pauseMode");
    expect(unusedTimeArguments(pause, { mode: "on", until: "", minutes: "" })).toEqual([
      "until",
      "minutes",
    ]);
    expect(unusedTimeArguments(pause, { mode: "until", until: "", minutes: "60" })).toEqual([
      "until",
    ]);
  });

  it("says how long the longest length is", () => {
    expect(durationLabel(10_080 * 60)).toBe("7 days");
    expect(durationLabel(60 * 60)).toBe("1 hour");
    expect(durationLabel(90)).toBe("90 seconds");
  });
});

describe("lengths and times", () => {
  it("round-trips a state entry's seconds through a count and its unit", () => {
    const spec = timeField("ttl").count!;
    for (const seconds of ["60", "5400", "7200", "86400", "1209600", "45"]) {
      expect(storedCountOf(spec, countInputOf(spec, seconds))).toBe(seconds);
    }
    expect(countInputOf(spec, "1209600")).toEqual({ count: "14", unit: "days" });
    expect(countInputOf(spec, "5400")).toEqual({ count: "90", unit: "minutes" });
    expect(countInputOf(spec, "")).toEqual({ count: "", unit: "hours" });
    expect(storedCountOf(spec, { count: "1.5", unit: "hours" })).toBe("");
    expect(storedCountOf(spec, { count: "0", unit: "hours" })).toBe("");
  });

  it("stores a typed length in the argument's own unit", () => {
    const spec = timeField("muteDuration").count!;
    expect(storedCountOf(spec, { count: "3", unit: "hours" })).toBe("180");
    expect(countInputOf(spec, "180")).toEqual({ count: "3", unit: "hours" });
  });

  it("round-trips a local date and time through RFC 3339", () => {
    const iso = isoOfLocalInput("2999-12-31T23:45");
    expect(iso).toBe(new Date("2999-12-31T23:45").toISOString());
    expect(localInputOfIso(iso)).toBe("2999-12-31T23:45");
    expect(isoOfLocalInput("")).toBe("");
    expect(localInputOfIso("soon")).toBe("");
  });
});
