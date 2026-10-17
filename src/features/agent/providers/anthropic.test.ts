import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiMessage } from "./types";

// Local Tauri mock — overrides the bare `invoke` mock from src/test/mocks/tauri.ts
// to also expose a Channel class. Each test grabs the mocked module with
// `await import(...)` to wire `invoke.mockImplementation(...)` per case.
vi.mock("@tauri-apps/api/core", () => {
  class MockChannel<T> {
    onmessage: ((msg: T) => void) | null = null;
    send(msg: T): void {
      this.onmessage?.(msg);
    }
  }
  return {
    Channel: MockChannel,
    invoke: vi.fn(),
  };
});

import { invoke } from "@tauri-apps/api/core";

import { createAnthropicProvider } from "./anthropic";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

interface ChannelLike {
  send(ev: unknown): void;
}

/**
 * Drive a fake `agent_chat_completion` invocation: when the test calls
 * `invokeMock`, fire the supplied SSE events on the channel and resolve
 * the invoke promise. Mirrors the real Tauri proxy's contract — events
 * arrive on the Channel; the invoke promise resolves once `Done` flushes.
 */
function mockChatCompletion(events: unknown[]): void {
  invokeMock.mockImplementationOnce(async (_cmd: string, args: { onEvent: ChannelLike }) => {
    for (const ev of events) {
      args.onEvent.send(ev);
    }
  });
}

describe("createAnthropicProvider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns a provider with correct config", () => {
    const provider = createAnthropicProvider();
    expect(provider.config.id).toBe("anthropic");
    expect(provider.config.name).toBe("Anthropic Claude");
    expect(provider.config.models.length).toBeGreaterThan(0);
  });

  it("falls back to the current Claude models, newest tier first", () => {
    const provider = createAnthropicProvider();
    expect(provider.config.models.map((m) => m.id)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
  });

  it("chat invokes agent_chat_completion with provider, model, and snake_case body — no api_key field", async () => {
    // Contract: ChatCompletionRequest on the Rust side uses
    // #[serde(deny_unknown_fields)] and has no api_key field. The key is
    // read from the OS keyring by the proxy inline. Any payload that
    // includes api_key is rejected.
    mockChatCompletion([{ kind: "done" }]);

    const provider = createAnthropicProvider();
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];

    for await (const _ of provider.chat({
      model: "claude-sonnet-5-5",
      messages,
      systemPrompt: "Be helpful",
    })) {
      // drain
    }

    expect(invokeMock).toHaveBeenCalledOnce();
    const [cmd, args] = invokeMock.mock.calls[0]!;
    expect(cmd).toBe("agent_chat_completion");
    const req = (args as { request: Record<string, unknown> }).request;
    expect(req.provider).toBe("anthropic");
    expect(req.model).toBe("claude-sonnet-5-5");
    // api_key must not be present — deny_unknown_fields on the Rust side
    // would reject any payload containing this field.
    expect(req).not.toHaveProperty("api_key");
    expect(req.system_prompt).toBe("Be helpful");
    expect(req.max_tokens).toBe(4096);
  });

  it("chat omits system_prompt and tools when not provided", async () => {
    mockChatCompletion([{ kind: "done" }]);

    const provider = createAnthropicProvider();
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];

    for await (const _ of provider.chat({
      model: "claude-sonnet-5-5",
      messages,
    })) {
      // drain
    }

    const req = (invokeMock.mock.calls[0]![1] as { request: Record<string, unknown> }).request;
    expect(req).not.toHaveProperty("system_prompt");
    expect(req).not.toHaveProperty("tools");
  });

  it("chat translates AiToolDefinition[] to Anthropic tools shape", async () => {
    mockChatCompletion([{ kind: "done" }]);

    const provider = createAnthropicProvider();
    const tools = [
      {
        name: "search",
        description: "Search things",
        input_schema: { type: "object", properties: {} },
      },
    ];

    for await (const _ of provider.chat({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "x" }],
      tools,
    })) {
      // drain
    }

    const req = (invokeMock.mock.calls[0]![1] as { request: Record<string, unknown> }).request;
    expect(req.tools).toEqual([
      {
        name: "search",
        description: "Search things",
        input_schema: { type: "object", properties: {} },
      },
    ]);
  });

  it("chat yields error on ChatStreamEvent::Error", async () => {
    mockChatCompletion([{ kind: "error", message: "provider 401: invalid_api_key" }]);

    const provider = createAnthropicProvider();
    const chunks = [];
    for await (const c of provider.chat({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "x" }],
    })) {
      chunks.push(c);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      kind: "error",
      message: "provider 401: invalid_api_key",
    });
  });

  it("chat yields error when invoke promise rejects without firing channel events", async () => {
    invokeMock.mockRejectedValueOnce(new Error("IPC layer refused"));

    const provider = createAnthropicProvider();
    const chunks = [];
    for await (const c of provider.chat({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "x" }],
    })) {
      chunks.push(c);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      kind: "error",
      message: "IPC layer refused",
    });
  });

  it("chat reassembles SSE text_delta events into text_delta chunks", async () => {
    mockChatCompletion([
      {
        kind: "sse_event",
        event_type: "message_start",
        data: { type: "message_start", message: { usage: { input_tokens: 12 } } },
      },
      {
        kind: "sse_event",
        event_type: "content_block_delta",
        data: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi " } },
      },
      {
        kind: "sse_event",
        event_type: "content_block_delta",
        data: { type: "content_block_delta", delta: { type: "text_delta", text: "there" } },
      },
      {
        kind: "sse_event",
        event_type: "message_delta",
        data: { type: "message_delta", usage: { output_tokens: 5 } },
      },
      { kind: "done" },
    ]);

    const provider = createAnthropicProvider();
    const chunks = [];
    for await (const c of provider.chat({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(c);
    }

    expect(chunks).toEqual([
      { kind: "text_delta", text: "Hi " },
      { kind: "text_delta", text: "there" },
      { kind: "done", usage: { inputTokens: 12, outputTokens: 5 } },
    ]);
  });

  it("chat reassembles tool_use across content_block_start/delta/stop", async () => {
    mockChatCompletion([
      {
        kind: "sse_event",
        event_type: "content_block_start",
        data: {
          type: "content_block_start",
          content_block: { type: "tool_use", id: "tool-7", name: "search" },
        },
      },
      {
        kind: "sse_event",
        event_type: "content_block_delta",
        data: {
          type: "content_block_delta",
          delta: { type: "input_json_delta", partial_json: '{"q":' },
        },
      },
      {
        kind: "sse_event",
        event_type: "content_block_delta",
        data: {
          type: "content_block_delta",
          delta: { type: "input_json_delta", partial_json: '"hello"}' },
        },
      },
      {
        kind: "sse_event",
        event_type: "content_block_stop",
        data: { type: "content_block_stop" },
      },
      { kind: "done" },
    ]);

    const provider = createAnthropicProvider();
    const chunks = [];
    for await (const c of provider.chat({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(c);
    }

    expect(chunks[0]).toEqual({
      kind: "tool_use",
      id: "tool-7",
      name: "search",
      input: { q: "hello" },
    });
    expect(chunks.at(-1)).toMatchObject({ kind: "done" });
  });

  it("sends command ids as API-safe tool names and maps tool calls back to the id", async () => {
    mockChatCompletion([
      {
        kind: "sse_event",
        event_type: "content_block_start",
        data: {
          type: "content_block_start",
          content_block: { type: "tool_use", id: "tool-8", name: "chat_send_message_2" },
        },
      },
      {
        kind: "sse_event",
        event_type: "content_block_delta",
        data: {
          type: "content_block_delta",
          delta: { type: "input_json_delta", partial_json: '{"text":"hi"}' },
        },
      },
      {
        kind: "sse_event",
        event_type: "content_block_stop",
        data: { type: "content_block_stop" },
      },
      { kind: "done" },
    ]);

    const provider = createAnthropicProvider();
    const schema = { type: "object", properties: {} };
    const messages: AiMessage[] = [
      { role: "user", content: "list channels" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-1", name: "chat.list_channels", input: {} }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "[]" }] },
    ];
    const chunks = [];
    for await (const c of provider.chat({
      model: "claude-sonnet-5-5",
      messages,
      tools: [
        { name: "chat.send_message", description: "Send", input_schema: schema },
        { name: "chat_send_message", description: "Other", input_schema: schema },
        { name: "chat.list_channels", description: "List", input_schema: schema },
        { name: "plugin__chat_rim_k8s-pods__refresh", description: "Pods", input_schema: schema },
      ],
    })) {
      chunks.push(c);
    }

    const req = (invokeMock.mock.calls[0]![1] as { request: Record<string, unknown> }).request;
    expect((req.tools as { name: string }[]).map((t) => t.name)).toEqual([
      "chat_send_message_2",
      "chat_send_message",
      "chat_list_channels",
      "plugin__chat_rim_k8s-pods__refresh",
    ]);
    const history = req.messages as { content: { type: string; name?: string }[] | string }[];
    expect(history[1]!.content).toEqual([
      { type: "tool_use", id: "tool-1", name: "chat_list_channels", input: {} },
    ]);
    expect(chunks[0]).toEqual({
      kind: "tool_use",
      id: "tool-8",
      name: "chat.send_message",
      input: { text: "hi" },
    });
  });
});
