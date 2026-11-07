import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandDefinition } from "../types";

/** A message box line that names a command, with the arguments typed after its name. */
export interface CommandLine {
  command: CommandDefinition;
  args: Record<string, unknown>;
}

/** A message box line that names a command but whose arguments cannot be read. */
export interface CommandLineError {
  command: CommandDefinition;
  error: string;
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
 * The command a message box line names. The line starts with `/`, then a command's whole id or
 * title (ignoring case and spacing; an id wins), then nothing or only `key=value` pairs. A value
 * with spaces is quoted: `text="two words"`. Integer, float and boolean values become what the
 * command declares.
 *
 * @returns The command and its arguments; an error when the arguments cannot be read; `null` when
 *   the line names no command, so it is ordinary text.
 */
export function parseCommandLine(
  line: string,
  commands: readonly CommandDefinition[] | undefined,
): CommandLine | CommandLineError | null {
  if (!commands || !line.startsWith("/")) return null;
  const body = line.slice(1).trim();
  if (!body) return null;
  const all = tokens(body);
  // An unclosed quote after a command name is an error; before one it is only text.
  const words = all ?? tokens(body + '"') ?? [];
  const firstPair = words.findIndex((t) => KEY_VALUE.test(t.raw));
  const head = normalized(
    (firstPair === -1 ? words : words.slice(0, firstPair)).map((t) => t.raw).join(" "),
  );
  if (!head) return null;
  const command =
    commands.find((cmd) => normalized(cmd.id) === head) ??
    commands.find((cmd) => normalized(cmd.title) === head);
  if (!command) return null;
  if (firstPair === -1) return { command, args: {} };
  if (all === null) return { command, error: "A quoted value is missing its closing quote." };
  const args: Record<string, unknown> = {};
  for (const token of all.slice(firstPair)) {
    const eq = token.raw.indexOf("=");
    if (!KEY_VALUE.test(token.raw)) {
      return { command, error: `Expected key=value, found "${token.raw}".` };
    }
    const name = token.raw.slice(0, eq);
    args[name] = coerce(command, name, token.value.slice(name.length + 1));
  }
  return { command, args };
}
