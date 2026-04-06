import { describe, it, expect } from "vitest";

// Type-level tests to verify the thread query key shapes
import { queryKeys } from "../../../core/query/keys";

describe("thread query keys", () => {
  it("threadByRoot produces consistent key shape", () => {
    const key = queryKeys.threadByRoot("ws-1", "conv-1", "msg-1");
    expect(key).toEqual(["threadByRoot", "ws-1", "conv-1", "msg-1"]);
  });

  it("threadByRoot handles undefined args", () => {
    const key = queryKeys.threadByRoot(undefined, undefined, undefined);
    expect(key).toEqual(["threadByRoot", undefined, undefined, undefined]);
  });

  it("threadMessages produces consistent key shape", () => {
    const key = queryKeys.threadMessages("ws-1", "conv-1", "thread-1");
    expect(key).toEqual(["threadMessages", "ws-1", "conv-1", "thread-1"]);
  });

  it("threadMessages handles undefined args", () => {
    const key = queryKeys.threadMessages(undefined, undefined, undefined);
    expect(key).toEqual(["threadMessages", undefined, undefined, undefined]);
  });

  it("thread keys are distinct from message keys", () => {
    const threadKey = queryKeys.threadByRoot("ws-1", "conv-1", "msg-1");
    const msgKey = queryKeys.messages("ws-1", "conv-1");
    expect(threadKey[0]).not.toBe(msgKey[0]);
  });
});
