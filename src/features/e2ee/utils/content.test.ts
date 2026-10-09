import { describe, expect, it } from "vitest";

import {
  matchingKeyword,
  mentionedPrincipals,
  toPrincipalMentions,
  toUserMentions,
} from "./content";

const ALICE = "rimp1_alice";
const principals: Record<string, string> = { "u-alice": ALICE };

describe("mentions", () => {
  it("writes mentions as principal tokens and reads them back as user tokens", () => {
    const body = toPrincipalMentions(
      "hi @alice and <@u-alice>, not <@u-nobody>",
      new Map([["alice", "u-alice"]]),
      (userId) => principals[userId],
    );
    expect(body).toBe(`hi <@${ALICE}> and <@${ALICE}>, not <@u-nobody>`);
    expect(mentionedPrincipals(body)).toEqual([ALICE]);
    expect(toUserMentions(body, (p) => (p === ALICE ? "u-alice" : undefined))).toBe(
      "hi <@u-alice> and <@u-alice>, not <@u-nobody>",
    );
  });
});

describe("matchingKeyword", () => {
  it("matches whole words, case-insensitively, outside mention tokens", () => {
    expect(matchingKeyword("The Deploy failed", ["deploy"])).toBe("deploy");
    expect(matchingKeyword("redeployed", ["deploy"])).toBeNull();
    expect(matchingKeyword(`ping <@rimp1_deploy>`, ["deploy"])).toBeNull();
    expect(matchingKeyword("incident: db-01 down", ["db-01"])).toBe("db-01");
    expect(matchingKeyword("anything", [])).toBeNull();
  });
});
