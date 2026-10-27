import { describe, it, expect } from "vitest";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { runsOnServer, skippedUnattended, unknownCommandError } from "./serverRunnable";

describe("runsOnServer", () => {
  it("accepts a backend command and refuses a desktop-local one", () => {
    expect(runsOnServer({ executionTarget: "BACKEND" })).toBe(true);
    expect(runsOnServer({ executionTarget: "DESKTOP_LOCAL" })).toBe(false);
  });
});

describe("skippedUnattended", () => {
  it.each([
    [CommandSensitivity.SAFE, false, false],
    [CommandSensitivity.SENSITIVE, false, false],
    [CommandSensitivity.MUTATING, false, true],
    [CommandSensitivity.RESTRICTED, false, true],
    [CommandSensitivity.SAFE, true, true],
    [undefined, false, false],
  ])("sensitivity %s, dangerous %s: skipped %s", (sensitivity, dangerous, skipped) => {
    expect(skippedUnattended({ sensitivity, dangerous })).toBe(skipped);
  });
});

describe("unknownCommandError", () => {
  const palette = [{ id: "chat.post_message" }];
  const picker = [{ id: "chat.delete_message" }];

  it("names a typed title that is not a command id", () => {
    expect(unknownCommandError("Post Message", palette, picker)).toBe(
      "Unknown command: Post Message",
    );
  });

  it("accepts an id from either registry", () => {
    expect(unknownCommandError("chat.post_message", palette, picker)).toBeNull();
    expect(unknownCommandError("chat.delete_message", palette, picker)).toBeNull();
  });

  it("judges nothing while a registry is loading", () => {
    expect(unknownCommandError("Post Message", palette, undefined)).toBeNull();
    expect(unknownCommandError("Post Message", undefined, picker)).toBeNull();
  });

  it("ignores an empty id and surrounding spaces", () => {
    expect(unknownCommandError("", palette, picker)).toBeNull();
    expect(unknownCommandError("   ", palette, picker)).toBeNull();
    expect(unknownCommandError("  chat.post_message ", palette, picker)).toBeNull();
    expect(unknownCommandError(" Post Message ", palette, picker)).toBe(
      "Unknown command: Post Message",
    );
  });
});
