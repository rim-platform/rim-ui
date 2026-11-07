import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandDefinition } from "../types";

/** A `key=value` pair typed after a command's name. */
export interface TypedPair {
  key: string;
  value: string;
}

/** What a message box line holds: the words naming a command, then its typed pairs. */
export interface CommandLineParts {
  /** The words before the first pair, lowercased with their spacing collapsed. */
  head: string;
  pairs: TypedPair[];
  /** Why the pairs cannot be read, when they cannot. */
  error?: string;
}

const KEY_VALUE = /^[A-Za-z_][A-Za-z0-9_-]*=/;

function normalized(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Splits `text` at spaces that are outside double quotes. A quote opens at the start of a value
 * and `\"` and `\\` stand for themselves inside it.
 *
 * @returns The tokens with their quotes removed from values, or `null` for an unclosed quote.
 */
function tokens(text: string): { raw: string; value: string }[] | null {
  const out: { raw: string; value: string }[] = [];
  let raw = "";
  let value = "";
  let quoted = false;
  const flush = () => {
    if (raw !== "") out.push({ raw, value });
    raw = "";
    value = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      raw += ch;
      if (ch === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) {
        value += text[i + 1];
        raw += text[i + 1];
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (/\s/.test(ch)) {
      flush();
    } else if (ch === '"' && raw.endsWith("=")) {
      quoted = true;
      raw += ch;
    } else {
      raw += ch;
      value += ch;
    }
  }
  if (quoted) return null;
  flush();
  return out;
}

function coerce(command: CommandDefinition, name: string, value: string): unknown {
  const type = command.arguments?.find((a) => a.name === name)?.argumentType;
  if (type === CommandArgumentType.INTEGER && /^-?\d+$/.test(value)) return Number(value);
  if (type === CommandArgumentType.FLOAT && value !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  if (type === CommandArgumentType.BOOLEAN && (value === "true" || value === "false")) {
    return value === "true";
  }
  return value;
}

/**
 * Splits a line that starts with `/` into the words that name a command and the `key=value`
 * pairs after them. A value with spaces is quoted: `text="two words"`, with `\"` and `\\` for
 * themselves inside it.
 */
export function splitCommandLine(line: string): CommandLineParts {
  const body = line.replace(/^\//, "").trim();
  const all = tokens(body);
  // An unclosed quote still names its command; the pairs are then unreadable.
  const words = all ?? tokens(body + '"') ?? [];
  const firstPair = words.findIndex((t) => KEY_VALUE.test(t.raw));
  const head = normalized(
    (firstPair === -1 ? words : words.slice(0, firstPair)).map((t) => t.raw).join(" "),
  );
  if (firstPair === -1) return { head, pairs: [] };
  if (all === null)
    return { head, pairs: [], error: "A quoted value is missing its closing quote." };
  const pairs: TypedPair[] = [];
  for (const token of all.slice(firstPair)) {
    if (!KEY_VALUE.test(token.raw)) {
      return { head, pairs: [], error: `Expected key=value, found "${token.raw}".` };
    }
    const key = token.raw.slice(0, token.raw.indexOf("="));
    pairs.push({ key, value: token.value.slice(key.length + 1) });
  }
  return { head, pairs };
}

/**
 * The arguments `pairs` give `command`: integer, float and boolean values become what the
 * command declares, any other value stays text.
 */
export function commandArguments(
  command: CommandDefinition,
  pairs: readonly TypedPair[],
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const { key, value } of pairs) args[key] = coerce(command, key, value);
  return args;
}

function spoken(text: string): string {
  return normalized(text.replace(/[._-]+/g, " "));
}

/** Whether `head`, the words typed so far, is the whole id or the whole title of `command`. */
export function namesCommand(command: CommandDefinition, head: string): boolean {
  return normalized(command.id) === head || normalized(command.title) === head;
}

/**
 * The commands whose id, title or category contain the words typed so far, ignoring case and
 * the separators of an id, with the one whose whole id or title was typed first.
 */
export function commandsMatching(
  head: string,
  commands: readonly CommandDefinition[],
): CommandDefinition[] {
  const wanted = spoken(head);
  const matching = commands.filter(
    (cmd) =>
      spoken(cmd.id).includes(wanted) ||
      spoken(cmd.title).includes(wanted) ||
      spoken(cmd.category).includes(wanted),
  );
  return [
    ...matching.filter((c) => namesCommand(c, head)),
    ...matching.filter((c) => !namesCommand(c, head)),
  ];
}
