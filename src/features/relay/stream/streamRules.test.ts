import { describe, expect, it } from "vitest";

import { streamMatches } from "./streamRules";

const event = { type: "ReadMarkerRewound", conversation_id: "conv-1" };

describe("streamMatches: ReadMarkerRewound", () => {
  it("belongs on the e route with no seq, like typing and presence", () => {
    expect(streamMatches({ stream: "e", seq: null, event }, "me")).toBe(true);
  });

  it("is refused anywhere else, or with a seq", () => {
    expect(streamMatches({ stream: "e", seq: 1, event }, "me")).toBe(false);
    expect(streamMatches({ stream: "u:me", seq: 1, event }, "me")).toBe(false);
    expect(streamMatches({ stream: "c:conv-1", seq: 1, event }, "me")).toBe(false);
    expect(streamMatches({ stream: "w", seq: 1, event }, "me")).toBe(false);
  });
});
