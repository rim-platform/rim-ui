import { Channel, invoke } from "@tauri-apps/api/core";

import type {
  AiProvider,
  AiProviderConfig,
  AiChatRequest,
  AiStreamChunk,
  AiMessage,
  AiContentBlock,
  AiToolDefinition,
} from "./types";
import { buildRequestToolNameMap, type ToolNameMap } from "./toolNames";

const config: AiProviderConfig = {
  id: "anthropic",
  name: "Anthropic Claude",
  models: [
    {
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: true,
    },
    {
      id: "claude-haiku-5-5",
      name: "Claude Haiku 5.5",
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: true,
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

function toAnthropicMessages(messages: AiMessage[], toolNames: ToolNameMap): AnthropicMessage[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((block: AiContentBlock) => {
              if (block.type === "text") return { type: "text" as const, text: block.text };
              if (block.type === "tool_use")
                return {
                  type: "tool_use" as const,
                  id: block.id,
                  name: toolNames.toApi(block.name),
                  input: block.input,
                };
              if (block.type === "tool_result")
                return {
                  type: "tool_result" as const,
                  tool_use_id: block.tool_use_id,
                  content: block.content,
                };
              return { type: "text" as const, text: "" };
            }),
    }));
}

function toAnthropicTools(tools: AiToolDefinition[], toolNames: ToolNameMap) {
  return tools.map((t) => ({
    name: toolNames.toApi(t.name),
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/**
 * Wire shape exposed by `agent_proxy::ChatStreamEvent` (snake_case, tag = "kind").
 * `data` is the parsed JSON payload of the SSE `data:` line, handled by the
 * event-type switch in `chat`.
 */
type ChatStreamEvent =
  | { kind: "sse_event"; event_type: string | null; data: Record<string, unknown> }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Construct an Anthropic provider that dispatches `chat()` calls to the
 * Tauri `agent_chat_completion` command. The API key is read directly from
 * the secret vault by the Rust proxy on every request — the JS side never
 * holds or transmits the key bytes.
 */
export function createAnthropicProvider(): AiProvider {
  return {
    config,

    async *chat(request: AiChatRequest): AsyncIterable<AiStreamChunk> {
      // The Rust proxy reads the API key from the secret vault on every request.
      // No api_key is sent: ChatCompletionRequest uses
      // #[serde(deny_unknown_fields)] and has no api_key field, so it would
      // reject the request.
      // Command ids contain dots, which the API refuses in tool names; tool
      // calls come back under the API name and are translated back below.
      const toolNames = buildRequestToolNameMap(request.tools, request.messages);
      const proxyRequest = {
        provider: "anthropic" as const,
        model: request.model,
        messages: toAnthropicMessages(request.messages, toolNames),
        ...(request.systemPrompt ? { system_prompt: request.systemPrompt } : {}),
        ...(request.tools && request.tools.length > 0
          ? { tools: toAnthropicTools(request.tools, toolNames) }
          : {}),
        max_tokens: request.maxTokens ?? 4096,
      };

      // Bounded queue of stream events drained by the async iterator below.
      // The Tauri Channel callback fires synchronously off the IPC bridge and
      // cannot `await` the consumer, so events are buffered here and the
      // iterator pulls at its own pace.
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
        // The proxy emits ChatStreamEvent::Error on the channel before
        // rejecting, so the queue path normally surfaces the message.
        // This path runs only if the channel never fired (e.g. IPC layer
        // refused the call) — synthesize a terminal error so the iterator
        // has something to drain on.
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

      // Track current tool_use being built from streaming deltas
      let currentToolId = "";
      let currentToolName = "";
      let toolInputJson = "";

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

        // event.kind === "sse_event" — the IPC proxy forwards the parsed
        // JSON payload of the provider's `data:` line.
        const payload = event.data;
        const eventType = payload.type as string;

        if (eventType === "content_block_start") {
          const block = payload.content_block as Record<string, unknown>;
          if (block?.type === "tool_use") {
            currentToolId = block.id as string;
            currentToolName = block.name as string;
            toolInputJson = "";
          }
        } else if (eventType === "content_block_delta") {
          const delta = payload.delta as Record<string, unknown>;
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
            yield {
              kind: "tool_use",
              id: currentToolId,
              name: toolNames.fromApi(currentToolName),
              input,
            };
            currentToolId = "";
            currentToolName = "";
            toolInputJson = "";
          }
        } else if (eventType === "message_start") {
          const usage = (payload.message as Record<string, unknown>)?.usage as
            Record<string, number> | undefined;
          if (usage) {
            inputTokens = usage.input_tokens ?? 0;
          }
        } else if (eventType === "message_delta") {
          const usage = payload.usage as Record<string, number> | undefined;
          if (usage) {
            outputTokens = usage.output_tokens ?? 0;
          }
        }
      }
    },
  };
}
