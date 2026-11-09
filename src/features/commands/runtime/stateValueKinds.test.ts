import { describe, expect, it } from "vitest";

import {
  decodeStateValue,
  encodeStateValue,
  kindOfStoredValue,
  normalizeStateValue,
  shortStateValue,
  stateValueInputProblem,
  stateValueProblem,
  type StateValueKind,
} from "./stateValueKinds";

describe("encodeStateValue and decodeStateValue", () => {
  const cases: { kind: StateValueKind; input: string; sent: string }[] = [
    { kind: "boolean", input: "true", sent: "true" },
    { kind: "boolean", input: "false", sent: "false" },
    { kind: "number", input: "42", sent: "42" },
    { kind: "number", input: "-1.5", sent: "-1.5" },
    { kind: "text", input: "hello", sent: '"hello"' },
    { kind: "text", input: "true", sent: '"true"' },
    { kind: "text", input: "42", sent: '"42"' },
    { kind: "text", input: 'say "hi"', sent: '"say \\"hi\\""' },
    { kind: "json", input: '{"a":1}', sent: '{"a":1}' },
    { kind: "json", input: "[1, 2]", sent: "[1, 2]" },
    { kind: "json", input: "null", sent: "null" },
  ];

  it.each(cases)("sends $kind $input as $sent and reads it back", ({ kind, input, sent }) => {
    expect(encodeStateValue(kind, input)).toBe(sent);
    expect(decodeStateValue(sent)).toEqual({ kind, input });
  });

  it("sends text the server would read as JSON as a JSON string, so it is stored as text", () => {
    for (const text of ["true", "false", "42", "null", "[1]", '{"a":1}']) {
      expect(JSON.parse(encodeStateValue("text", text))).toBe(text);
    }
  });

  it("sends nothing for an empty field of any kind", () => {
    expect(encodeStateValue("boolean", "")).toBe("");
    expect(encodeStateValue("number", "  ")).toBe("");
    expect(encodeStateValue("text", "")).toBe("");
    expect(encodeStateValue("json", " ")).toBe("");
  });

  it("reads saved text that is not JSON as that text", () => {
    expect(decodeStateValue("hello there")).toEqual({ kind: "text", input: "hello there" });
  });
});

describe("normalizeStateValue", () => {
  it("keeps JSON as it is and quotes plain text, which means the same to the server", () => {
    expect(normalizeStateValue("42")).toBe("42");
    expect(normalizeStateValue('"42"')).toBe('"42"');
    expect(normalizeStateValue("true")).toBe("true");
    expect(normalizeStateValue('{"a":1}')).toBe('{"a":1}');
    expect(normalizeStateValue("hello")).toBe('"hello"');
    expect(normalizeStateValue("")).toBe("");
  });
});

describe("kindOfStoredValue", () => {
  it("is the stored value's JSON type", () => {
    expect(kindOfStoredValue(true)).toBe("boolean");
    expect(kindOfStoredValue(3)).toBe("number");
    expect(kindOfStoredValue("x")).toBe("text");
    expect(kindOfStoredValue({ a: 1 })).toBe("json");
    expect(kindOfStoredValue(null)).toBe("json");
  });
});

describe("value problems", () => {
  it("checks a number and JSON as they are typed", () => {
    expect(stateValueInputProblem("number", "12")).toBeNull();
    expect(stateValueInputProblem("number", "twelve")).toBe("Enter a number, such as 42 or 1.5");
    expect(stateValueInputProblem("number", "0x10")).not.toBeNull();
    expect(stateValueInputProblem("json", '{"a": 1}')).toBeNull();
    expect(stateValueInputProblem("json", "{a: 1}")).toMatch(/^Not valid JSON/);
    expect(stateValueInputProblem("text", "{a: 1}")).toBeNull();
    expect(stateValueInputProblem("json", "")).toBeNull();
  });

  it("refuses a value argument that is not JSON", () => {
    expect(stateValueProblem('"hi"')).toBeNull();
    expect(stateValueProblem("twelve")).toBe("Enter a valid number or JSON value");
  });
});

describe("shortStateValue", () => {
  it("shows a value as one line of JSON, shortened", () => {
    expect(shortStateValue("hi")).toBe('"hi"');
    expect(shortStateValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(shortStateValue("x".repeat(100), 10)).toBe(`"${"x".repeat(8)}…`);
  });
});
