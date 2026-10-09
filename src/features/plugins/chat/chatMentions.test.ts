import { describe, expect, it } from "vitest";

import { mentionsForSend } from "./chatMentions";

const members = [
  { userId: "u-ada", principalId: "rimp1_ada", provisionalId: "rimp0_ada" },
  { userId: "u-bo", principalId: null, provisionalId: "rimp0_bo" },
];

describe("mentionsForSend", () => {
  it("writes user tokens in a plaintext conversation", () => {
    expect(mentionsForSend("hi <@rimp1_ada> <@rimp0_ada> <@rimp0_bo> <@x>", members, false)).toBe(
      "hi <@u-ada> <@u-ada> <@u-bo> <@x>",
    );
  });

  it("writes key-based principal tokens in an encrypted one", () => {
    expect(mentionsForSend("hi <@rimp0_ada> <@rimp0_bo>", members, true)).toBe(
      "hi <@rimp1_ada> <@rimp0_bo>",
    );
  });
});
