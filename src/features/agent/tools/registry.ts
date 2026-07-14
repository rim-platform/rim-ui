import type { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import type { AiToolDefinition } from "../providers/types";
import type { AiToolHandler, RegisteredTool } from "./types";

const tools = new Map<string, RegisteredTool>();

export function registerTool(
  definition: AiToolDefinition,
  handler: AiToolHandler,
  options?: {
    sideEffect?: boolean;
    requiresConfirmation?: boolean;
    sensitivity?: CommandSensitivity;
    nlDescription?: string;
    description?: string;
  },
): void {
  tools.set(definition.name, {
    definition,
    handler,
    sideEffect: options?.sideEffect,
    requiresConfirmation: options?.requiresConfirmation,
    sensitivity: options?.sensitivity,
    nlDescription: options?.nlDescription,
    description: options?.description,
  });
}

export function unregisterTool(name: string): void {
  tools.delete(name);
}

export function getTool(name: string): RegisteredTool | undefined {
  return tools.get(name);
}

export function getAllToolDefinitions(): AiToolDefinition[] {
  return Array.from(tools.values()).map((t) => t.definition);
}

export function getAllTools(): RegisteredTool[] {
  return Array.from(tools.values());
}
