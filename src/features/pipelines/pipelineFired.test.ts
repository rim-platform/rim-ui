import { describe, expect, it } from "vitest";

import { pipelineTriggerPhrase } from "./pipelineFired";

describe("pipelineTriggerPhrase", () => {
  it("names the trigger in plain words", () => {
    expect(pipelineTriggerPhrase("NewMessage")).toBe("after a new message");
    expect(pipelineTriggerPhrase("MemberJoined")).toBe("after a member joined");
  });

  it("gives nothing for a trigger it does not know", () => {
    expect(pipelineTriggerPhrase("Other")).toBeNull();
  });
});
