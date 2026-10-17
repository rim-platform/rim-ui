import type { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { AiToolDefinition } from "../providers/types";

export interface AiToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export type AiToolHandler = (input: Record<string, unknown>) => Promise<string>;

export interface RegisteredTool {
  definition: AiToolDefinition;
  handler: AiToolHandler;
  sideEffect?: boolean;
  requiresConfirmation?: boolean;
  sensitivity?: CommandSensitivity;
  /**
   * The backend `nl_description` as sent. `definition.description` is the
   * model-facing string (nlDescription plus the sanitised intent_samples
   * footer); the confirmation modal shows the plain nlDescription as its
   * subtitle.
   */
  nlDescription?: string;
  /**
   * Raw backend `Command.description` — the human-facing consequence line
   * for the confirmation modal. Distinct
   * from `nlDescription` (model-facing, tuned for the LLM) and from
   * `definition.description` (the LLM tool string with the intent-sample
   * footer appended).
   */
  description?: string;
}
