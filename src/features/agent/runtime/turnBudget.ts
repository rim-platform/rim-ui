import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { RegisteredTool } from "../tools/types";

/**
 * Per-turn spending caps.
 *
 * - `MAX_PARALLEL_TOOL_CALLS` bounds how many tool_use blocks are honored in
 *   a single model round. The LLM can request more; the excess is rejected
 *   with a sanitized tool_result so the model can replan.
 * - `MAX_MUTATING_PER_TURN` bounds the number of mutating tool calls across
 *   the entire `runAgent` invocation (all rounds combined). A "mutating"
 *   call is one whose registered tool has sensitivity MUTATING or
 *   RESTRICTED, or whose registration carried `sideEffect: true`. SAFE and
 *   SENSITIVE tools do not count.
 *
 * Both caps exist to bound blast radius on a runaway tool loop. When a cap
 * is hit, the engine returns a synthetic tool_result instead of throwing, so
 * the LLM keeps the conversation coherent and can either stop or pick a
 * smaller subset.
 */
export const MAX_PARALLEL_TOOL_CALLS = 3;
export const MAX_MUTATING_PER_TURN = 3;

export const PARALLEL_CAP_MESSAGE = `Skipped: this turn already issued ${MAX_PARALLEL_TOOL_CALLS} parallel tool calls (the per-round cap). Re-issue this call in a follow-up turn.`;
export const MUTATING_CAP_MESSAGE = `Skipped: this run already executed ${MAX_MUTATING_PER_TURN} mutating actions (the per-run cap). Ask the user to start a new run before issuing more mutating actions.`;

export function isMutating(tool: RegisteredTool): boolean {
  if (tool.sideEffect) return true;
  const sev = tool.sensitivity;
  return sev === CommandSensitivity.MUTATING || sev === CommandSensitivity.RESTRICTED;
}

export interface TurnBudget {
  /** Number of mutating calls already executed this run. */
  mutatingUsed: number;
  /**
   * Decide whether the next tool call may proceed. Returns null on allow,
   * or a sanitized message string the engine should surface as the
   * tool_result (and skip the actual handler invocation).
   */
  reserve(tool: RegisteredTool): string | null;
}

export function createTurnBudget(): TurnBudget {
  let mutatingUsed = 0;
  return {
    get mutatingUsed() {
      return mutatingUsed;
    },
    reserve(tool: RegisteredTool): string | null {
      if (!isMutating(tool)) return null;
      if (mutatingUsed >= MAX_MUTATING_PER_TURN) {
        return MUTATING_CAP_MESSAGE;
      }
      mutatingUsed += 1;
      return null;
    },
  };
}

const URL_RE = /\b[a-z]+:\/\/\S+/gi;
const ABS_PATH_RE = /(?:\/[^/\s]+){2,}|\b[a-zA-Z]:\\[^\s]+/g;
// eslint-disable-next-line no-control-regex -- intentionally matches control chars to strip them
const CONTROL_RE = /[\x00-\x1F\x7F]+/g;
const MAX_ERR_LEN = 200;

/**
 * Tool error sanitization.
 *
 * Tool handler errors flow back to the LLM as a `tool_result` with
 * `is_error: true`. Without sanitization, raw `Error.message` strings can
 * carry stack traces, file paths, internal class names, and (worst case)
 * server payloads echoed verbatim. None of that helps the model and some
 * of it leaks implementation detail to chat transcripts.
 *
 * Rules:
 * - Strip control chars (newlines, tabs) — collapse to single spaces.
 * - Strip URL-shaped tokens (`http://...`, `file://...`).
 * - Strip absolute paths (`/home/...`, `C:\...`).
 * - Cap to 200 chars; trailing ellipsis if truncated.
 * - For inputs that are neither an Error nor a string, produce a generic
 *   message — never JSON.stringify arbitrary objects (might contain PII).
 */
export function sanitizeToolError(err: unknown): string {
  let raw: string;
  if (err instanceof Error) {
    raw = err.message || err.name || "Error";
  } else if (typeof err === "string") {
    raw = err;
  } else {
    return "Tool execution failed.";
  }

  let cleaned = raw
    .replace(URL_RE, "[url]")
    .replace(ABS_PATH_RE, "[path]")
    .replace(CONTROL_RE, " ")
    .trim();

  if (cleaned.length === 0) return "Tool execution failed.";
  if (cleaned.length > MAX_ERR_LEN) {
    cleaned = cleaned.slice(0, MAX_ERR_LEN - 3) + "...";
  }
  return `Tool error: ${cleaned}`;
}
