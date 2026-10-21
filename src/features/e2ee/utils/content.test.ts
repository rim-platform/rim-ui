import { describe, expect, it } from "vitest";

import {
  matchingKeyword,
  mentionedPrincipals,
  replaceMentions,
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

describe("replaceMentions", () => {
  const token = (userId: string) => `<@${userId}>`;

  it("reads a handle before the bare username it starts with", () => {
    const mentions = new Map([
      ["kuba", "u-local"],
      ["kuba:elsewhere.example", "u-remote"],
    ]);
    expect(replaceMentions("@kuba and @kuba:elsewhere.example", mentions, token)).toBe(
      "<@u-local> and <@u-remote>",
    );
  });

  it("leaves a name followed by more of a name or a domain alone", () => {
    const mentions = new Map([["kuba", "u-local"]]);
    expect(
      replaceMentions("@kuba_2 @kuba:other.example @kuba. @kuba: hi @kuba's", mentions, token),
    ).toBe("@kuba_2 @kuba:other.example <@u-local>. <@u-local>: hi <@u-local>'s");
  });

  it("leaves a user whose token is null as typed", () => {
    expect(replaceMentions("@ada", new Map([["ada", "u-ada"]]), () => null)).toBe("@ada");
  });
});

describe("matchingKeyword", () => {
  it("matches whole words, case-insensitively, outside mention tokens", () => {
    expect(matchingKeyword("The Deploy failed", ["deploy"])).toBe("deploy");
    expect(matchingKeyword("redeployed", ["deploy"])).toBeNull();
    expect(matchingKeyword(`ping <@rimp1_deploy>`, ["deploy"])).toBeNull();
    expect(matchingKeyword("outage: db-01 down", ["db-01"])).toBe("db-01");
    expect(matchingKeyword("anything", [])).toBeNull();
  });
});
