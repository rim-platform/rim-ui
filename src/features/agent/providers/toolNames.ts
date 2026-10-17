import type { AiMessage, AiToolDefinition } from "./types";

/**
 * Tool names both providers accept. Anthropic allows `^[a-zA-Z0-9_-]{1,128}$`;
 * OpenAI allows the same characters with a maximum length of 64. The stricter
 * of the two applies, so one name works for either provider.
 */
export const TOOL_NAME_MAX_LENGTH = 64;
const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const INVALID_TOOL_NAME_CHARS = /[^a-zA-Z0-9_-]/g;

export function isValidToolName(name: string): boolean {
  return VALID_TOOL_NAME.test(name);
}

/**
 * Two-way map between the agent's tool names and the names sent to a model
 * API. Agent tools are named after command ids, which contain dots
 * (`chat.send_message`); both APIs reject those, so each name is translated
 * on the way out and translated back when the model calls a tool.
 */
export interface ToolNameMap {
  /** API-safe name for an agent tool name. */
  toApi(name: string): string;
  /** Agent tool name for a name the model used. Unknown names pass through unchanged. */
  fromApi(apiName: string): string;
}

/**
 * Builds the map for the given names, in order of priority.
 *
 * - A name that is already valid maps to itself, so it never changes and no
 *   other name can take it.
 * - Any other name has each disallowed character replaced with `_` and is cut
 *   to the length limit. If that result is taken (`chat.send_message` next to
 *   a real `chat_send_message`), it gets the first free `_2`, `_3`, ... suffix,
 *   still within the limit.
 *
 * Every name gets a distinct API name, so `fromApi` always finds the exact
 * original. Earlier names win the unsuffixed form, which keeps a tool's API
 * name stable across a run as long as the tool list is passed first.
 */
export function buildToolNameMap(names: Iterable<string>): ToolNameMap {
  const unique = [...new Set(names)];
  const toApi = new Map<string, string>();
  const fromApi = new Map<string, string>();

  for (const name of unique) {
    if (isValidToolName(name)) {
      toApi.set(name, name);
      fromApi.set(name, name);
    }
  }

  for (const name of unique) {
    if (toApi.has(name)) continue;
    const base =
      name.replace(INVALID_TOOL_NAME_CHARS, "_").slice(0, TOOL_NAME_MAX_LENGTH) || "tool";
    let candidate = base;
    for (let n = 2; fromApi.has(candidate); n++) {
      const suffix = `_${n}`;
      candidate = base.slice(0, TOOL_NAME_MAX_LENGTH - suffix.length) + suffix;
    }
    toApi.set(name, candidate);
    fromApi.set(candidate, name);
  }

  return {
    toApi: (name) => toApi.get(name) ?? name,
    fromApi: (apiName) => fromApi.get(apiName) ?? apiName,
  };
}

/**
 * The map for one chat request: the offered tools first, then any tool named
 * in the history but no longer offered, so earlier tool calls still translate
 * to a valid name.
 */
export function buildRequestToolNameMap(
  tools: ReadonlyArray<AiToolDefinition> | undefined,
  messages: ReadonlyArray<AiMessage>,
): ToolNameMap {
  const names = (tools ?? []).map((t) => t.name);
  for (const message of messages) {
    if (typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type === "tool_use") names.push(block.name);
    }
  }
  return buildToolNameMap(names);
}
