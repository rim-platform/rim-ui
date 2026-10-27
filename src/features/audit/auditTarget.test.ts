import { describe, expect, it } from "vitest";

import { auditTargetUserId, shortUserId } from "./auditTarget";

const ACTOR = "0192abcd-0000-7000-8000-000000000001";
const CAROL = "0192abcd-1111-7000-8000-000000000002";
const DAVE = "0192abcd-2222-7000-8000-000000000003";

function target(argsRedacted: unknown, actorUserId = ACTOR) {
  return auditTargetUserId({ actorUserId, argsRedacted });
}

describe("auditTargetUserId", () => {
  it("returns the member under user_id", () => {
    expect(target({ user_id: CAROL, reason: "spam" })).toBe(CAROL);
  });

  it("returns the author under author_id when there is no user_id", () => {
    expect(target({ author_id: DAVE, message_id: "m-1" })).toBe(DAVE);
  });

  it("prefers user_id over author_id", () => {
    expect(target({ author_id: DAVE, user_id: CAROL })).toBe(CAROL);
  });

  it("names no target when the member is the actor", () => {
    expect(target({ user_id: ACTOR })).toBeNull();
  });

  it.each([["[REDACTED]"], [""], [42]])("ignores a user_id of %j", (value) => {
    expect(target({ user_id: value })).toBeNull();
  });

  it.each([[null], [[]], ["x"], [{}]])("names no target for arguments %j", (args) => {
    expect(target(args)).toBeNull();
  });
});

describe("shortUserId", () => {
  it("keeps the first eight characters and an ellipsis", () => {
    expect(shortUserId("0192abcd-1111-7000-8000-000000000002")).toBe("0192abcd…");
  });
});
