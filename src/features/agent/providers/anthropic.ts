import { Channel, invoke } from "@tauri-apps/api/core";

import type {
  AiProvider,
  AiProviderConfig,
  AiModelDef,
  AiChatRequest,
  AiStreamChunk,
  AiMessage,
  AiContentBlock,
  AiToolDefinition,
  ValidationOutcome,
} from "./types";

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

/**
 * Wire shape exposed by `agent_proxy::ChatStreamEvent` (snake_case, tag = "kind").
 * `data` is the parsed JSON payload of the SSE `data:` line — we forward it
 * straight to the existing event-type switch below, preserving the prior
 * fetch+ReadableStream behaviour without rewriting any reassembly logic.
 */
type ChatStreamEvent =
  | { kind: "sse_event"; event_type: string | null; data: Record<string, unknown> }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * Construct an Anthropic provider that loads the API key on every `chat()`
 * call via `loadKey` and drops the local reference once the IPC invoke
 * settles. The loader thunk is the only long-lived key-adjacent object the
 * registry holds — the key bytes themselves are never captured by this
 * factory's closure. See `runtime/keyStore.ts` module header for the full
 * invariant (Phase 4 #59 closure).
 *
 * `validateCredentials` and `fetchModels` retain their existing
 * explicit-key parameter because they are invoked from the settings panel
 * with the user's in-form value (not yet saved to Stronghold); those paths
 * are already per-call and do not need loader indirection.
 */
export function createAnthropicProvider(
  loadKey: () => Promise<string>,
): AiProvider {
  return {
    config,

    async *chat(request: AiChatRequest): AsyncIterable<AiStreamChunk> {
      // Load per-request: the returned string lives only in the
      // `proxyRequest` object passed to `invoke`. Once `invoke` serialises
      // the arg across the Tauri bridge, we drop the reference by letting
      // `proxyRequest` fall out of scope at function end.
      const apiKey = await loadKey();
      const proxyRequest = {
        provider: "anthropic" as const,
        model: request.model,
        messages: toAnthropicMessages(request.messages),
        ...(request.systemPrompt ? { system_prompt: request.systemPrompt } : {}),
        ...(request.tools && request.tools.length > 0
          ? { tools: toAnthropicTools(request.tools) }
          : {}),
        max_tokens: request.maxTokens ?? 4096,
        api_key: apiKey,
      };

      // Bounded queue of stream events drained by the async iterator below.
      // The Tauri Channel callback fires synchronously off the IPC bridge;
      // we cannot make it `await` the consumer, so we buffer here and let
      // the iterator pull at its own pace.
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
        // We only land here if the channel never fired (e.g. IPC layer
        // refused the call) — synthesize a terminal error so the iterator
        // has something to drain on.
        const message = typeof err === "string" ? err : err instanceof Error ? err.message : "agent_chat_completion failed";
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
        const event = queue.shift() ?? (await new Promise<ChatStreamEvent>((resolve) => {
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
        // JSON payload of the provider's `data:` line; the per-event type
        // switch below is the same logic that used to run after JSON.parse
        // on a manual TextDecoder buffer.
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
            yield { kind: "tool_use", id: currentToolId, name: currentToolName, input };
            currentToolId = "";
            currentToolName = "";
            toolInputJson = "";
          }
        } else if (eventType === "message_start") {
          const usage = (payload.message as Record<string, unknown>)?.usage as Record<string, number> | undefined;
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

    async validateCredentials(key: string): Promise<ValidationOutcome> {
      try {
        // The Rust proxy returns a tagged `ValidationOutcome` (see
        // `agent_proxy::ValidationOutcome`). An invoke-level reject here
        // means the IPC boundary itself failed (command not registered,
        // deserialization mismatch) — surface that as a network_error so
        // the UI doesn't flash "Invalid API key" for what's really an
        // internal plumbing issue.
        return await invoke<ValidationOutcome>("agent_validate_credentials", {
          provider: "anthropic",
          apiKey: key,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "network_error", message };
      }
    },

    async fetchModels(key: string): Promise<AiModelDef[]> {
      const data = await invoke<{
        data: { id: string; display_name: string; type: string }[];
      }>("agent_list_models", {
        provider: "anthropic",
        apiKey: key,
      });

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

