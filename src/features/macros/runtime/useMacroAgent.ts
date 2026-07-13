import { useState, useCallback } from "react";

import { invoke } from "@tauri-apps/api/core";
import { registerProvider, getProvider } from "../../agent/providers/registry";
import { loadApiKey, ProviderKeyMissingError } from "../../agent/runtime/keyStore";
import { useAgentStore } from "../../agent/state/useAgentStore";
import type { AiMessage } from "../../agent/providers/types";
import type { CommandDefinition } from "../../commands/types";
import type { MacroStep } from "../api/useMacros";

export interface GeneratedMacro {
  name: string;
  description: string;
  steps: MacroStep[];
}

interface UseMacroAgentResult {
  generate: (description: string, commands: CommandDefinition[]) => Promise<GeneratedMacro>;
  isGenerating: boolean;
  error: string | null;
}

function buildSystemPrompt(commands: CommandDefinition[]): string {
  const commandList = commands
    .map((c) => `- ${c.id}: ${c.description} (category: ${c.category})`)
    .join("\n");

  return `You are a macro builder for RIM, a programmable communication workspace.
The user will describe what they want a macro to do. You must respond with a JSON object.

Each step has:
- commandId: string (must be one of the available commands listed below)
- args: optional object with arguments for the command

Available commands:
${commandList}

Respond with ONLY a JSON object in this format (no markdown fences, no extra text):
{
  "name": "suggested-macro-name",
  "description": "What this macro does",
  "steps": [
    { "commandId": "command.id", "args": { } },
    ...
  ]
}`;
}

function parseMacroResponse(text: string, validCommandIds: Set<string>): GeneratedMacro {
  // Trim first, then strip possible markdown code fences
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(
      "Failed to parse AI response as JSON. The response may have been truncated — try a simpler description.",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("steps" in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).steps)
  ) {
    throw new Error("Response is not a valid macro definition");
  }

  const obj = parsed as Record<string, unknown>;
  const steps = (obj.steps as unknown[]).map((s, i) => {
    if (
      typeof s !== "object" ||
      s === null ||
      typeof (s as Record<string, unknown>).commandId !== "string"
    ) {
      throw new Error(`Invalid step ${i + 1}: missing commandId`);
    }
    const step = s as Record<string, unknown>;
    const commandId = step.commandId as string;

    // Validate commandId against known commands
    if (!validCommandIds.has(commandId)) {
      throw new Error(
        `Step ${i + 1} references unknown command "${commandId}". The AI may have hallucinated this command.`,
      );
    }

    const args =
      step.args !== undefined && step.args !== null && typeof step.args === "object"
        ? (step.args as Record<string, unknown>)
        : {};
    return { commandId, args };
  });

  return {
    name: typeof obj.name === "string" ? obj.name : "Generated Macro",
    description: typeof obj.description === "string" ? obj.description : "",
    steps,
  };
}

export function useMacroAgent(): UseMacroAgentResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (description: string, commands: CommandDefinition[]): Promise<GeneratedMacro> => {
      setIsGenerating(true);
      setError(null);

      try {
        const settings = useAgentStore.getState().settings;
        const { providerId, modelId } = settings;

        // Presence-check the OS keyring — single source of truth after the
        // Stronghold → keyring cutover (agent-settings-consolidation §3).
        const hasKey = await invoke<boolean>("is_provider_key_configured", {
          provider: providerId,
        });
        if (!hasKey) {
          throw new Error("no-api-key");
        }

        // Lazy-register: if the macro builder is invoked before AgentOverlay
        // has ever opened, there is no registered provider yet. Register one
        // here using the same Stronghold-reading loader pattern as
        // AgentOverlay. If a provider is already registered, we reuse it —
        // but first-open from the macro surface must still work.
        let provider = getProvider(providerId);
        if (!provider) {
          const loader = async () => {
            const key = await loadApiKey(providerId);
            if (!key) throw new ProviderKeyMissingError(providerId);
            return key;
          };
          if (providerId === "anthropic") {
            const { createAnthropicProvider } = await import("../../agent/providers/anthropic");
            provider = createAnthropicProvider(loader);
            registerProvider(provider);
          } else if (providerId === "openai") {
            const { createOpenAiProvider } = await import("../../agent/providers/openai");
            provider = createOpenAiProvider(loader);
            registerProvider(provider);
          } else {
            throw new Error(
              `Provider "${providerId}" is not supported. Configure the AI agent in Settings.`,
            );
          }
        }

        const systemPrompt = buildSystemPrompt(commands);
        const messages: AiMessage[] = [{ role: "user", content: description }];

        const stream = provider.chat({
          model: modelId,
          messages,
          systemPrompt,
          maxTokens: 2048,
        });

        let fullText = "";
        for await (const chunk of stream) {
          if (chunk.kind === "text_delta") {
            fullText += chunk.text;
          } else if (chunk.kind === "error") {
            throw new Error(chunk.message);
          }
        }

        const validCommandIds = new Set(commands.map((c) => c.id));
        const result = parseMacroResponse(fullText, validCommandIds);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error occurred";
        setError(message);
        throw err;
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  return { generate, isGenerating, error };
}
