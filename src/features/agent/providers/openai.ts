import type {
  AiProvider,
  AiProviderConfig,
  AiModelDef,
  AiChatRequest,
  AiStreamChunk,
  AiMessage,
  AiToolDefinition,
} from "./types";

const OPENAI_API = "https://api.openai.com/v1/chat/completions";

/** Static fallback — used when API is unreachable. */
const STATIC_MODELS: AiModelDef[] = [
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 2.0,
    outputPricePerMToken: 8.0,
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 0.4,
    outputPricePerMToken: 1.6,
  },
  {
    id: "gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 0.1,
    outputPricePerMToken: 0.4,
  },
  {
    id: "o3-mini",
    name: "o3-mini",
    contextWindow: 200_000,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 1.1,
    outputPricePerMToken: 4.4,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 2.5,
    outputPricePerMToken: 10.0,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
    inputPricePerMToken: 0.15,
    outputPricePerMToken: 0.6,
  },
];

/** Model IDs we consider relevant for chat (filter out embeddings, tts, whisper, dall-e etc.) */
const CHAT_MODEL_PREFIXES = ["gpt", "o"];

const config: AiProviderConfig = {
  id: "openai",
  name: "OpenAI",
  models: STATIC_MODELS,
};

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function toOpenAiMessages(messages: AiMessage[], systemPrompt?: string): OpenAiMessage[] {
  const result: OpenAiMessage[] = [];

  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const m of messages) {
    if (typeof m.content === "string") {
      result.push({ role: m.role === "system" ? "user" : m.role, content: m.content });
    } else {
      // Anthropic sends assistant messages with mixed text + tool_use blocks.
      // OpenAI expects a single assistant message with both content and tool_calls.
      if (m.role === "assistant") {
        let textContent = "";
        const toolCalls: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];

        for (const block of m.content) {
          if (block.type === "text") {
            textContent += block.text;
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: { name: block.name, arguments: JSON.stringify(block.input) },
            });
          }
        }

        const msg: OpenAiMessage = {
          role: "assistant",
          content: textContent || null,
        };
        if (toolCalls.length > 0) {
          msg.tool_calls = toolCalls;
        }
        result.push(msg);
      } else {
        // User messages: tool_result blocks become separate "tool" role messages
        for (const block of m.content) {
          if (block.type === "text") {
            result.push({ role: "user", content: block.text });
          } else if (block.type === "tool_result") {
            result.push({ role: "tool", tool_call_id: block.tool_use_id, content: block.content });
          }
        }
      }
    }
  }

  return result;
}

function toOpenAiTools(tools: AiToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export function createOpenAiProvider(apiKey: string): AiProvider {
  return {
    config,

    async *chat(request: AiChatRequest): AsyncIterable<AiStreamChunk> {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: toOpenAiMessages(request.messages, request.systemPrompt),
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
      };

      if (request.tools && request.tools.length > 0) {
        body.tools = toOpenAiTools(request.tools);
      }

      let response: Response;
      try {
        response = await fetch(OPENAI_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (err) {
        yield { kind: "error", message: err instanceof Error ? err.message : "Network error" };
        return;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "Unknown error");
        yield { kind: "error", message: `OpenAI API error ${response.status}: ${text}` };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { kind: "error", message: "No response body" };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let inputTokens = 0;
      let outputTokens = 0;

      // Track tool calls being built
      const toolCalls = new Map<number, { id: string; name: string; args: string }>();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }

            const choices = event.choices as { delta?: Record<string, unknown>; finish_reason?: string }[] | undefined;
            const usage = event.usage as Record<string, number> | undefined;

            if (usage) {
              inputTokens = usage.prompt_tokens ?? inputTokens;
              outputTokens = usage.completion_tokens ?? outputTokens;
            }

            if (!choices || choices.length === 0) continue;
            const delta = choices[0].delta;
            if (!delta) continue;

            // Text content
            if (delta.content) {
              yield { kind: "text_delta", text: delta.content as string };
            }

            // Tool calls
            const tc = delta.tool_calls as { index: number; id?: string; function?: { name?: string; arguments?: string } }[] | undefined;
            if (tc) {
              for (const call of tc) {
                const existing = toolCalls.get(call.index);
                if (!existing) {
                  toolCalls.set(call.index, {
                    id: call.id ?? "",
                    name: call.function?.name ?? "",
                    args: call.function?.arguments ?? "",
                  });
                } else {
                  if (call.function?.arguments) {
                    existing.args += call.function.arguments;
                  }
                }
              }
            }

            // Emit completed tool calls on finish
            if (choices[0].finish_reason === "tool_calls") {
              for (const [, call] of toolCalls) {
                let input: Record<string, unknown> = {};
                try {
                  input = JSON.parse(call.args || "{}");
                } catch {
                  // malformed
                }
                yield { kind: "tool_use", id: call.id, name: call.name, input };
              }
              toolCalls.clear();
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { kind: "done", usage: { inputTokens, outputTokens } };
    },

    async validateCredentials(key: string): Promise<boolean> {
      try {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${key}` },
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    async fetchModels(key: string): Promise<AiModelDef[]> {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${key}` },
      });

      if (!res.ok) {
        throw new Error(`OpenAI API error ${res.status}`);
      }

      const data = await res.json() as { data: { id: string; owned_by: string }[] };
      const chatModels = data.data
        .filter((m) => CHAT_MODEL_PREFIXES.some((p) => m.id.startsWith(p)))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => {
          const staticMatch = STATIC_MODELS.find((s) => s.id === m.id);
          return {
            id: m.id,
            name: m.id,
            contextWindow: staticMatch?.contextWindow ?? 128_000,
            supportsTools: true,
            supportsStreaming: true,
            inputPricePerMToken: staticMatch?.inputPricePerMToken,
            outputPricePerMToken: staticMatch?.outputPricePerMToken,
          };
        });

      if (chatModels.length === 0) {
        throw new Error("No chat models returned from OpenAI API");
      }

      return chatModels;
    },
  };
}
