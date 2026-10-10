import { describe, it, expect } from "vitest";

import { detectCrossChannel } from "./crossChannelDetector";

describe("detectCrossChannel", () => {
  it("returns null when current conversation is not set", () => {
    expect(detectCrossChannel({ conversation_id: "abc" }, null)).toBeNull();
  });

  it("returns null when no destination-bearing arg is present", () => {
    expect(detectCrossChannel({ message: "hi", limit: 10 }, "current")).toBeNull();
  });

  it("returns null when destination matches the current conversation", () => {
    expect(detectCrossChannel({ conversation_id: "current" }, "current")).toBeNull();
  });

  it("returns mismatch info for conversation_id divergence", () => {
    expect(detectCrossChannel({ conversation_id: "ops-deploys" }, "general")).toEqual({
      targetId: "ops-deploys",
      argName: "conversation_id",
    });
  });

  it("recognizes channel_id, dm_recipient_id, target_conversation_id", () => {
    expect(detectCrossChannel({ channel_id: "engineering" }, "general")).toEqual({
      targetId: "engineering",
      argName: "channel_id",
    });
    expect(detectCrossChannel({ dm_recipient_id: "u1" }, "general")).toEqual({
      targetId: "u1",
      argName: "dm_recipient_id",
    });
    expect(detectCrossChannel({ target_conversation_id: "ops" }, "general")).toEqual({
      targetId: "ops",
      argName: "target_conversation_id",
    });
  });

  it("ignores empty-string and non-string destination values", () => {
    expect(detectCrossChannel({ conversation_id: "" }, "general")).toBeNull();
    expect(detectCrossChannel({ conversation_id: 42 as unknown as string }, "general")).toBeNull();
  });

  it("uses the first matching destination arg in declaration order", () => {
    // conversation_id is checked before channel_id. If conversation_id matches
    // current, the function moves on to channel_id.
    expect(
      detectCrossChannel({ conversation_id: "general", channel_id: "ops" }, "general"),
    ).toEqual({ targetId: "ops", argName: "channel_id" });
  });
});
