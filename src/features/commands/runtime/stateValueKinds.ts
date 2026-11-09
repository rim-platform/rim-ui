/**
 * The kinds of value `state.set` stores. The command's `value` argument is text the server reads
 * as JSON first and keeps as plain text only when that fails, so each kind sends JSON:
 * - `boolean`: `true` or `false`;
 * - `number`: the number as typed, such as `42` or `-1.5`;
 * - `text`: the text as a JSON string, so `true` or `42` typed as text stays text;
 * - `json`: any JSON as typed.
 */
export type StateValueKind = "boolean" | "number" | "text" | "json";

/** The kinds in the order the kind select offers them, each with its label. */
export const STATE_VALUE_KINDS: readonly { kind: StateValueKind; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "number", label: "Number" },
  { kind: "boolean", label: "Yes/No" },
  { kind: "json", label: "JSON" },
];

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** The kind of a value as the server stores it. */
export function kindOfStoredValue(value: unknown): StateValueKind {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "text";
    default:
      return "json";
  }
}

/** A value's kind and what its field shows. */
export interface StateValueInput {
  kind: StateValueKind;
  input: string;
}

/**
 * The kind and field text of a `value` argument as it was sent or saved. Text that is not JSON
 * is the plain text the server stores for it.
 *
 * @param sent - The argument's text, such as `true`, `42`, `"hi"` or `{"a":1}`.
 */
export function decodeStateValue(sent: string): StateValueInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sent);
  } catch {
    return { kind: "text", input: sent };
  }
  switch (typeof parsed) {
    case "boolean":
      return { kind: "boolean", input: String(parsed) };
    case "number":
      return { kind: "number", input: sent.trim() };
    case "string":
      return { kind: "text", input: parsed };
    default:
      return { kind: "json", input: sent };
  }
}

/**
 * The `value` argument a field of `kind` sends, or `""` when it holds nothing yet.
 *
 * @param kind - The kind picked.
 * @param input - What the field holds: `true` or `false` for Yes/No, else the text typed.
 */
export function encodeStateValue(kind: StateValueKind, input: string): string {
  switch (kind) {
    case "boolean":
      return input === "true" || input === "false" ? input : "";
    case "number":
      return input.trim();
    case "text":
      return input === "" ? "" : JSON.stringify(input);
    case "json":
      return input.trim() === "" ? "" : input;
  }
}

/**
 * The `value` argument that keeps the meaning of a saved one while being JSON: saved plain text
 * becomes a JSON string, the text the server stored for it.
 */
export function normalizeStateValue(sent: string): string {
  if (sent === "") return "";
  const { kind, input } = decodeStateValue(sent);
  return kind === "text" ? encodeStateValue("text", input) : sent;
}

/**
 * Why a field of `kind` holding `input` cannot be stored, or `null` when it can or is empty.
 */
export function stateValueInputProblem(kind: StateValueKind, input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  if (kind === "number") return JSON_NUMBER.test(text) ? null : "Enter a number, such as 42 or 1.5";
  if (kind === "json") {
    try {
      JSON.parse(text);
      return null;
    } catch {
      return 'Not valid JSON, such as {"a": 1}, [1, 2] or "text"';
    }
  }
  return null;
}

/** Why a `value` argument cannot be stored as its kind meant, or `null` when it can. */
export function stateValueProblem(sent: string): string | null {
  try {
    JSON.parse(sent);
    return null;
  } catch {
    return "Enter a valid number or JSON value";
  }
}

/**
 * A stored value as one short line of JSON, for a suggestion or a "Now:" note: text in quotes,
 * so it reads apart from a number or Yes/No.
 */
export function shortStateValue(value: unknown, max = 60): string {
  const text = JSON.stringify(value);
  const line = (text ?? "").replace(/\s+/g, " ");
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
