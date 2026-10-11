import { Channel, invoke } from "@tauri-apps/api/core";

import type {
  AiProvider,
  AiProviderConfig,
  AiModelDef,
  AiChatRequest,
  AiStreamChunk,
  AiMessage,
  AiToolDefinition,
} from "./types";
import { buildRequestToolNameMap, type ToolNameMap } from "./toolNames";

/** Static fallback — used until the live model list loads. */
const STATIC_MODELS: AiModelDef[] = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: "gpt-5.4-nano",
    name: "GPT-5.4 Nano",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
  },
];

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

function toOpenAiMessages(
  messages: AiMessage[],
  toolNames: ToolNameMap,
  systemPrompt?: string,
): OpenAiMessage[] {
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
        const toolCalls: {
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }[] = [];

        for (const block of m.content) {
          if (block.type === "text") {
            textContent += block.text;
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: toolNames.toApi(block.name),
                arguments: JSON.stringify(block.input),
              },
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

function toOpenAiTools(tools: AiToolDefinition[], toolNames: ToolNameMap) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: toolNames.toApi(t.name),
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Wire shape exposed by `agent_proxy::ChatStreamEvent` (snake_case, tag = "kind").
 * The proxy is a dumb passthrough for SSE — `data` is the parsed JSON of the
 * provider's `data:` line; the per-event switch below is the same logic that
 * used to run inline against a fetch+ReadableStream.
 */
type ChatStreamEvent =
  | { kind: "sse_event"; event_type: string | null; data: Record<string, unknown> }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Construct an OpenAI provider that dispatches `chat()` calls to the
 * Tauri `agent_chat_completion` command. The API key is read directly from
 * the secret vault by the Rust proxy on every request — the JS side never
 * holds or transmits the key bytes (Phase 5 / Option B). See
 * `anthropic.ts::createAnthropicProvider` for the full rationale.
 */
export function createOpenAiProvider(): AiProvider {
  return {
    config,

    async *chat(request: AiChatRequest): AsyncIterable<AiStreamChunk> {
      // The Rust proxy reads the API key from the secret vault on every request.
      // Do NOT send api_key — ChatCompletionRequest uses deny_unknown_fields.
      // Command ids contain dots, which the API refuses in function names;
      // tool calls come back under the API name and are translated back below.
      const toolNames = buildRequestToolNameMap(request.tools, request.messages);
      const proxyRequest = {
        provider: "openai" as const,
        model: request.model,
        messages: toOpenAiMessages(request.messages, toolNames, request.systemPrompt),
        ...(request.tools && request.tools.length > 0
          ? { tools: toOpenAiTools(request.tools, toolNames) }
          : {}),
        max_tokens: request.maxTokens ?? 4096,
      };

      const queue: ChatStreamEvent[] = [];
      let waiter: ((ev: ChatStreamEvent) => void) | null = null;

      const onEvent = new Channel<ChatStreamEvent>();
      onEvent.onmessage = (msg) => {
        if (waiter) {
          const w = waiter;
          waiter = null;
          w(msg);
        } else {
          queue.push(msg);
        }
      };

      void invoke("agent_chat_completion", {
        request: proxyRequest,
        onEvent,
      }).catch((err: unknown) => {
        const message =
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : "agent_chat_completion failed";
        if (waiter) {
          const w = waiter;
          waiter = null;
          w({ kind: "error", message });
        } else {
          queue.push({ kind: "error", message });
        }
      });

      let inputTokens = 0;
      let outputTokens = 0;

      // Track tool calls being built across SSE chunks (OpenAI fragments
      // tool_calls.function.arguments across many delta frames).
      const toolCalls = new Map<number, { id: string; name: string; args: string }>();

      while (true) {
        const event =
          queue.shift() ??
          (await new Promise<ChatStreamEvent>((resolve) => {
            waiter = resolve;
          }));

        if (event.kind === "error") {
          yield { kind: "error", message: event.message };
          return;
        }

        if (event.kind === "done") {
          yield { kind: "done", usage: { inputTokens, outputTokens } };
          return;
        }

        const payload = event.data;
        const choices = payload.choices as
          { delta?: Record<string, unknown>; finish_reason?: string }[] | undefined;
        const usage = payload.usage as Record<string, number> | undefined;

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
        const tc = delta.tool_calls as
          | { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
          | undefined;
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
            yield { kind: "tool_use", id: call.id, name: toolNames.fromApi(call.name), input };
          }
          toolCalls.clear();
        }
      }
    },
  };
}
