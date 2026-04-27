import type { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { AiToolDefinition } from "../providers/types";

export interface AiToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export type AiToolHandler = (
  input: Record<string, unknown>,
) => Promise<string>;

export interface RegisteredTool {
  definition: AiToolDefinition;
  handler: AiToolHandler;
  sideEffect?: boolean;
  requiresConfirmation?: boolean;
  sensitivity?: CommandSensitivity;
  /**
   * Raw backend `nl_description` retained alongside the tool. The tool's
   * `definition.description` is the LLM-facing string (nlDescription plus
   * sanitised intent_samples footer); the ConfirmCommandModal wants the
   * plain nlDescription as its subtitle, so we keep both.
   */
  nlDescription?: string;
}
