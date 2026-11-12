import { describe, expect, it } from "vitest";

import {
  presetArgsProblem,
  readChannelSettings,
  readCount,
  readDirectSettings,
  readQuickSettings,
} from "./settings";

describe("box settings", () => {
  it("reads only 3, 5 or 10 as a count", () => {
    expect([3, 5, 10].map(readCount)).toEqual([3, 5, 10]);
    for (const bad of [7, 0, "5", null, undefined]) expect(readCount(bad)).toBeNull();
  });

  it("reads a channel box's settings or nothing", () => {
    expect(readChannelSettings({ workspaceId: "w", conversationId: "c", count: 3 })).toEqual({
      workspaceId: "w",
      conversationId: "c",
      count: 3,
    });
    for (const bad of [
      null,
      [],
      { workspaceId: "w", conversationId: "c", count: 7 },
      { workspaceId: 3, conversationId: "c", count: 3 },
      { workspaceId: "w", conversationId: "", count: 3 },
    ]) {
      expect(readChannelSettings(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(readDirectSettings({ count: 10 })).toEqual({ count: 10 });
    expect(readDirectSettings({ count: 7 })).toBeNull();
  });

  it("takes preset arguments as a JSON object of at most 4096 bytes", () => {
    expect(presetArgsProblem({})).toBeNull();
    expect(presetArgsProblem({ note: "x".repeat(4096 - '{"note":""}'.length) })).toBeNull();
    expect(presetArgsProblem({ note: "x".repeat(4097 - '{"note":""}'.length) })).toBe(
      "Arguments must be at most 4096 bytes",
    );
    expect(presetArgsProblem([1])).toBe("Arguments must be a JSON object, such as {}");
  });

  it("reads one to six actions, each a command with optional arguments", () => {
    expect(
      readQuickSettings({
        actions: [{ commandId: "a" }, { commandId: "b", presetArgs: { x: 1 } }],
      }),
    ).toEqual({ actions: [{ commandId: "a" }, { commandId: "b", presetArgs: { x: 1 } }] });
    for (const bad of [
      { actions: [] },
      { actions: Array.from({ length: 7 }, () => ({ commandId: "a" })) },
      { actions: [{ commandId: "" }] },
      { actions: [{ commandId: "a", presetArgs: "x" }] },
      {},
    ]) {
      expect(readQuickSettings(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
