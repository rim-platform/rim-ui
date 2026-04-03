import type {
  AiProvider,
  AiProviderConfig,
  AiModelDef,
  AiChatRequest,
  AiStreamChunk,
  AiMessage,
  AiContentBlock,
  AiToolDefinition,
} from "./types";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

const config: AiProviderConfig = {
  id: "anthropic",
  name: "Anthropic Claude",
  models: [
    {
      id: "claude-opus-4-20250514",
      name: "Claude Opus 4",
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 15.0,
      outputPricePerMToken: 75.0,
    },
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 3.0,
      outputPricePerMToken: 15.0,
    },
    {
      id: "claude-haiku-3-5-20241022",
      name: "Claude 3.5 Haiku",
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: true,
      inputPricePerMToken: 0.8,
      outputPricePerMToken: 4.0,
    },
  ],
};

interface AnthropicContent {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContent[];
}

function toAnthropicMessages(messages: AiMessage[]): AnthropicMessage[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string"
        ? m.content
        : m.content.map((block: AiContentBlock) => {
            if (block.type === "text") return { type: "text" as const, text: block.text };
            if (block.type === "tool_use") return { type: "tool_use" as const, id: block.id, name: block.name, input: block.input };
            if (block.type === "tool_result") return { type: "tool_result" as const, tool_use_id: block.tool_use_id, content: block.content };
            return { type: "text" as const, text: "" };
          }),
    }));
}

function toAnthropicTools(tools: AiToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

export function createAnthropicProvider(apiKey: string): AiProvider {
  return {
    config,

    async *chat(request: AiChatRequest): AsyncIterable<AiStreamChunk> {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: toAnthropicMessages(request.messages),
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
      };

      if (request.systemPrompt) {
        body.system = request.systemPrompt;
      }

      if (request.tools && request.tools.length > 0) {
        body.tools = toAnthropicTools(request.tools);
      }

      let response: Response;
      try {
        response = await fetch(ANTHROPIC_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": API_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
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
        yield { kind: "error", message: `Anthropic API error ${response.status}: ${text}` };
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

      // Track current tool_use being built from streaming deltas
      let currentToolId = "";
      let currentToolName = "";
      let toolInputJson = "";

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

            const eventType = event.type as string;

            if (eventType === "content_block_start") {
              const block = event.content_block as Record<string, unknown>;
              if (block?.type === "tool_use") {
                currentToolId = block.id as string;
                currentToolName = block.name as string;
                toolInputJson = "";
              }
            } else if (eventType === "content_block_delta") {
              const delta = event.delta as Record<string, unknown>;
              if (delta?.type === "text_delta") {
                yield { kind: "text_delta", text: delta.text as string };
              } else if (delta?.type === "input_json_delta") {
                toolInputJson += delta.partial_json as string;
              }
            } else if (eventType === "content_block_stop") {
              if (currentToolId) {
                let input: Record<string, unknown> = {};
                try {
                  input = JSON.parse(toolInputJson || "{}");
                } catch {
                  // malformed tool input
                }
                yield { kind: "tool_use", id: currentToolId, name: currentToolName, input };
                currentToolId = "";
                currentToolName = "";
                toolInputJson = "";
              }
            } else if (eventType === "message_start") {
              const usage = (event.message as Record<string, unknown>)?.usage as Record<string, number> | undefined;
              if (usage) {
                inputTokens = usage.input_tokens ?? 0;
              }
            } else if (eventType === "message_delta") {
              const usage = event.usage as Record<string, number> | undefined;
              if (usage) {
                outputTokens = usage.output_tokens ?? 0;
              }
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
        // Use models list endpoint for validation — cheaper than sending a message
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": key,
            "anthropic-version": API_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
          },
        });
        return res.ok;
      } catch {
        return false;
      }
    },

    async fetchModels(key: string): Promise<AiModelDef[]> {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": key,
          "anthropic-version": API_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });

      if (!res.ok) {
        throw new Error(`Anthropic API error ${res.status}`);
      }

      const data = await res.json() as {
        data: { id: string; display_name: string; type: string }[];
      };

      const models: AiModelDef[] = data.data
        .filter((m) => m.type === "model")
        .map((m) => {
          const staticMatch = config.models.find((s) => s.id === m.id);
          return {
            id: m.id,
            name: m.display_name || m.id,
            contextWindow: staticMatch?.contextWindow ?? 200_000,
            supportsTools: true,
            supportsStreaming: true,
            inputPricePerMToken: staticMatch?.inputPricePerMToken,
            outputPricePerMToken: staticMatch?.outputPricePerMToken,
          };
        });

      if (models.length === 0) {
        throw new Error("No models returned from Anthropic API");
      }

      return models;
    },
  };
}
