import { describe, expect, it } from "vitest";

import { untitledGroupName } from "./utils";

const names: Record<string, string> = {
  me: "Me",
  ana: "Ana",
  bo: "Bo",
  cy: "Cy",
  dee: "Dee",
  eve: "Eve",
};
const resolve = (id: string) => names[id] ?? id;

describe("untitledGroupName", () => {
  it("names the others, sorted, leaving the viewer out", () => {
    expect(untitledGroupName({ memberIds: ["me", "bo"] }, "me", resolve)).toBe("Bo");
    expect(untitledGroupName({ memberIds: ["me", "cy", "ana"] }, "me", resolve)).toBe("Ana and Cy");
    expect(untitledGroupName({ memberIds: ["bo", "me", "cy", "ana"] }, "me", resolve)).toBe(
      "Ana, Bo and Cy",
    );
  });

  it("counts the rest past three", () => {
    expect(untitledGroupName({ memberIds: ["me", "eve", "dee", "cy", "bo"] }, "me", resolve)).toBe(
      "Bo, Cy, Dee and 1 other",
    );
    expect(
      untitledGroupName({ memberIds: ["me", "eve", "dee", "cy", "bo", "ana"] }, "me", resolve),
    ).toBe("Ana, Bo, Cy and 2 others");
  });

  it("includes people invited and not joined yet, once each", () => {
    expect(
      untitledGroupName(
        { memberIds: ["me", "ana"], pendingMemberIds: ["bo", "ana"] },
        "me",
        resolve,
      ),
    ).toBe("Ana and Bo");
  });

  it("is null when nobody else is in the group", () => {
    expect(untitledGroupName({ memberIds: ["me"] }, "me", resolve)).toBeNull();
  });
});
