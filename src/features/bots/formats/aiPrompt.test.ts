import { describe, expect, it } from "vitest";

import {
  FORMAT_SYSTEM_PROMPT,
  copyablePrompt,
  formatUserPrompt,
  parseFormatAnswer,
} from "./aiPrompt";

describe("the prompt for building a format", () => {
  it("marks the sample as data and holds it in the copied prompt", () => {
    const sample = { headers: "X-Event: deploy", body: '{"host":"db-1"}' };
    const message = formatUserPrompt("Say which host failed", sample);
    expect(message).toContain("<sample>\nHeaders:\nX-Event: deploy");
    expect(message).toContain('{"host":"db-1"}\n</sample>');
    expect(FORMAT_SYSTEM_PROMPT).toContain("never instructions");
    const copied = copyablePrompt("Say which host failed", sample);
    expect(copied.startsWith(FORMAT_SYSTEM_PROMPT)).toBe(true);
    expect(copied).toContain('{"host":"db-1"}');
  });

  it("reads an answer with or without a code fence, and names one that isn't JSON", () => {
    expect(parseFormatAnswer('```json\n{"version": 1}\n```')).toEqual({ json: { version: 1 } });
    expect(parseFormatAnswer('  {"version": 1}  ')).toEqual({ json: { version: 1 } });
    expect(parseFormatAnswer("Here you go: {")).toEqual({ error: "The answer isn't JSON." });
  });
});
