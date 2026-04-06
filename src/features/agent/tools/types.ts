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
}
