import { describe, it, expect } from "vitest";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { RegisteredTool } from "../tools/types";
import {
  MAX_MUTATING_PER_TURN,
  MUTATING_CAP_MESSAGE,
  createTurnBudget,
  isMutating,
  sanitizeToolError,
} from "./turnBudget";

function makeTool(opts: Partial<RegisteredTool> = {}): RegisteredTool {
  return {
    definition: {
      name: opts.definition?.name ?? "test.tool",
      description: opts.definition?.description ?? "",
      input_schema: opts.definition?.input_schema ?? { type: "object" },
    },
    handler: opts.handler ?? (async () => "ok"),
    sideEffect: opts.sideEffect,
    requiresConfirmation: opts.requiresConfirmation,
    sensitivity: opts.sensitivity,
  };
}

describe("isMutating", () => {
  it("treats sideEffect=true as mutating regardless of sensitivity", () => {
    expect(isMutating(makeTool({ sideEffect: true }))).toBe(true);
    expect(isMutating(makeTool({ sideEffect: true, sensitivity: CommandSensitivity.SAFE }))).toBe(
      true,
    );
  });

  it("treats MUTATING and RESTRICTED sensitivities as mutating", () => {
    expect(isMutating(makeTool({ sensitivity: CommandSensitivity.MUTATING }))).toBe(true);
    expect(isMutating(makeTool({ sensitivity: CommandSensitivity.RESTRICTED }))).toBe(true);
  });

  it("treats SAFE and SENSITIVE as non-mutating", () => {
    expect(isMutating(makeTool({ sensitivity: CommandSensitivity.SAFE }))).toBe(false);
    expect(isMutating(makeTool({ sensitivity: CommandSensitivity.SENSITIVE }))).toBe(false);
  });

  it("defaults to non-mutating when no flags are set", () => {
    expect(isMutating(makeTool())).toBe(false);
  });
});

describe("createTurnBudget", () => {
  it("allows non-mutating tools without consuming budget", () => {
    const budget = createTurnBudget();
    const safe = makeTool({ sensitivity: CommandSensitivity.SAFE });
    for (let i = 0; i < 10; i++) {
      expect(budget.reserve(safe)).toBeNull();
    }
    expect(budget.mutatingUsed).toBe(0);
  });

  it("permits up to MAX_MUTATING_PER_TURN mutating reservations", () => {
    const budget = createTurnBudget();
    const mut = makeTool({ sensitivity: CommandSensitivity.MUTATING });
    for (let i = 0; i < MAX_MUTATING_PER_TURN; i++) {
      expect(budget.reserve(mut)).toBeNull();
    }
    expect(budget.mutatingUsed).toBe(MAX_MUTATING_PER_TURN);
  });

  it("returns the cap message and stops counting once exceeded", () => {
    const budget = createTurnBudget();
    const mut = makeTool({ sensitivity: CommandSensitivity.MUTATING });
    for (let i = 0; i < MAX_MUTATING_PER_TURN; i++) {
      budget.reserve(mut);
    }
    expect(budget.reserve(mut)).toBe(MUTATING_CAP_MESSAGE);
    expect(budget.reserve(mut)).toBe(MUTATING_CAP_MESSAGE);
    // Counter must not increment past the cap.
    expect(budget.mutatingUsed).toBe(MAX_MUTATING_PER_TURN);
  });

  it("counts sideEffect tools toward the mutating cap", () => {
    const budget = createTurnBudget();
    const fx = makeTool({ sideEffect: true });
    for (let i = 0; i < MAX_MUTATING_PER_TURN; i++) {
      expect(budget.reserve(fx)).toBeNull();
    }
    expect(budget.reserve(fx)).toBe(MUTATING_CAP_MESSAGE);
  });

  it("does not count non-mutating tools after the cap is reached", () => {
    const budget = createTurnBudget();
    const mut = makeTool({ sensitivity: CommandSensitivity.MUTATING });
    const safe = makeTool({ sensitivity: CommandSensitivity.SAFE });
    for (let i = 0; i < MAX_MUTATING_PER_TURN; i++) budget.reserve(mut);
    // Mutating tools should be denied, but reads still go through.
    expect(budget.reserve(mut)).toBe(MUTATING_CAP_MESSAGE);
    expect(budget.reserve(safe)).toBeNull();
  });
});

describe("sanitizeToolError", () => {
  it("formats a plain Error message with the prefix", () => {
    expect(sanitizeToolError(new Error("boom"))).toBe("Tool error: boom");
  });

  it("strips URLs", () => {
    const out = sanitizeToolError(
      new Error("fetch failed: https://internal.example.com/api/v1/secret"),
    );
    expect(out).toContain("[url]");
    expect(out).not.toContain("internal.example.com");
  });

  it("strips absolute unix paths", () => {
    const out = sanitizeToolError(new Error("ENOENT at /home/kuba/secrets/db.sqlite"));
    expect(out).toContain("[path]");
    expect(out).not.toContain("/home/kuba");
  });

  it("strips Windows absolute paths", () => {
    const out = sanitizeToolError(new Error("cannot open C:\\Users\\admin\\Desktop\\notes.txt"));
    expect(out).toContain("[path]");
    expect(out).not.toContain("admin");
  });

  it("collapses control characters into spaces", () => {
    const out = sanitizeToolError(new Error("line1\nline2\tline3\r\nstacktrace here"));
    expect(out).not.toMatch(/[\n\t\r]/);
    expect(out).toContain("line1");
    expect(out).toContain("line3");
  });

  it("caps message length and appends ellipsis", () => {
    const long = "x".repeat(500);
    const out = sanitizeToolError(new Error(long));
    expect(out.length).toBeLessThanOrEqual("Tool error: ".length + 200);
    expect(out.endsWith("...")).toBe(true);
  });

  it("returns a generic message for non-Error/non-string values", () => {
    expect(sanitizeToolError(42)).toBe("Tool execution failed.");
    expect(sanitizeToolError({ leak: "secret" })).toBe("Tool execution failed.");
    expect(sanitizeToolError(undefined)).toBe("Tool execution failed.");
    expect(sanitizeToolError(null)).toBe("Tool execution failed.");
  });

  it("returns the generic message for an Error with empty message", () => {
    expect(sanitizeToolError(new Error(""))).toBe("Tool error: Error");
  });

  it("accepts plain strings", () => {
    expect(sanitizeToolError("plain text")).toBe("Tool error: plain text");
  });

  it("returns a generic message when stripping leaves nothing", () => {
    expect(sanitizeToolError("\n\t\r\x00")).toBe("Tool execution failed.");
  });
});
