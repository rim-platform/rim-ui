import { describe, expect, it } from "vitest";

import { stateKeyProblem } from "./stateKeyRules";

describe("stateKeyProblem", () => {
  it("takes keys that keep the rules", () => {
    expect(stateKeyProblem("deploy.count")).toBeNull();
    expect(stateKeyProblem("a1")).toBeNull();
    expect(stateKeyProblem("team:ops_on-call.v2")).toBeNull();
  });

  it("says which rule a key breaks, in plain words", () => {
    expect(stateKeyProblem("a")).toBe("A key has at least 2 characters");
    expect(stateKeyProblem("a".repeat(513))).toBe("A key has at most 512 characters");
    expect(stateKeyProblem("1abc")).toBe("A key starts with a lowercase letter");
    expect(stateKeyProblem("Deploy")).toBe("A key starts with a lowercase letter");
    expect(stateKeyProblem("deploy count")).toBe(
      "A key has only lowercase letters, digits and . _ : -",
    );
    expect(stateKeyProblem("deploy.")).toBe("A key ends with a lowercase letter or a digit");
  });

  it("refuses keys under system. unless a read allows them", () => {
    expect(stateKeyProblem("system.config")).toBe(
      "Keys starting with system. are kept for the workspace itself",
    );
    expect(stateKeyProblem("system.config", { allowSystem: true })).toBeNull();
  });
});
