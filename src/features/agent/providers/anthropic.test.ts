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
  invokeMock.mockImplementationOnce(
    async (_cmd: string, args: { onEvent: ChannelLike }) => {
      for (const ev of events) {
        args.onEvent.send(ev);
      }
    },
  );
}

describe("createAnthropicProvider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns a provider with correct config", () => {
    const provider = createAnthropicProvider(async () => "sk-test");
    expect(provider.config.id).toBe("anthropic");
    expect(provider.config.name).toBe("Anthropic Claude");
    expect(provider.config.models.length).toBeGreaterThan(0);
  });

  it("config contains expected models", () => {
    const provider = createAnthropicProvider(async () => "sk-test");
    const modelIds = provider.config.models.map((m) => m.id);
    expect(modelIds).toContain("claude-opus-4-20250514");
    expect(modelIds).toContain("claude-sonnet-4-20250514");
    expect(modelIds).toContain("claude-haiku-3-5-20241022");
  });

  it("models have pricing info", () => {
    const provider = createAnthropicProvider(async () => "sk-test");
    for (const model of provider.config.models) {
      expect(model.inputPricePerMToken).toBeGreaterThan(0);
      expect(model.outputPricePerMToken).toBeGreaterThan(0);
      expect(model.supportsTools).toBe(true);
      expect(model.supportsStreaming).toBe(true);
    }
  });

  it("chat invokes agent_chat_completion with provider, model, api_key, and snake_case body", async () => {
    mockChatCompletion([{ kind: "done" }]);

    const provider = createAnthropicProvider(async () => "sk-my-key");
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];

    for await (const _ of provider.chat({
      model: "claude-sonnet-4-20250514",
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
    expect(req.model).toBe("claude-sonnet-4-20250514");
    expect(req.api_key).toBe("sk-my-key");
    expect(req.system_prompt).toBe("Be helpful");
    expect(req.max_tokens).toBe(4096);
  });

  it("chat omits system_prompt and tools when not provided", async () => {
    mockChatCompletion([{ kind: "done" }]);

    const provider = createAnthropicProvider(async () => "sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];

    for await (const _ of provider.chat({
      model: "claude-sonnet-4-20250514",
      messages,
    })) {
      // drain
    }

    const req = (invokeMock.mock.calls[0]![1] as { request: Record<string, unknown> })
      .request;
    expect(req).not.toHaveProperty("system_prompt");
    expect(req).not.toHaveProperty("tools");
  });

  it("chat translates AiToolDefinition[] to Anthropic tools shape", async () => {
    mockChatCompletion([{ kind: "done" }]);

    const provider = createAnthropicProvider(async () => "sk-test");
    const tools = [
      {
        name: "search",
        description: "Search things",
        input_schema: { type: "object", properties: {} },
      },
    ];

    for await (const _ of provider.chat({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "x" }],
      tools,
    })) {
      // drain
    }

    const req = (invokeMock.mock.calls[0]![1] as { request: Record<string, unknown> })
      .request;
    expect(req.tools).toEqual([
      { name: "search", description: "Search things", input_schema: { type: "object", properties: {} } },
    ]);
  });

  it("chat yields error on ChatStreamEvent::Error", async () => {
    mockChatCompletion([{ kind: "error", message: "provider 401: invalid_api_key" }]);

    const provider = createAnthropicProvider(async () => "sk-test");
    const chunks = [];
    for await (const c of provider.chat({
      model: "claude-sonnet-4-20250514",
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

    const provider = createAnthropicProvider(async () => "sk-test");
    const chunks = [];
    for await (const c of provider.chat({
      model: "claude-sonnet-4-20250514",
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

    const provider = createAnthropicProvider(async () => "sk-test");
    const chunks = [];
    for await (const c of provider.chat({
      model: "claude-sonnet-4-20250514",
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

    const provider = createAnthropicProvider(async () => "sk-test");
    const chunks = [];
    for await (const c of provider.chat({
      model: "claude-sonnet-4-20250514",
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

  describe("validateCredentials", () => {
    it("invokes agent_validate_credentials with provider+apiKey", async () => {
      invokeMock.mockResolvedValueOnce({ kind: "valid" });
      const provider = createAnthropicProvider(async () => "sk-test");
      const outcome = await provider.validateCredentials("sk-test");
      expect(outcome).toEqual({ kind: "valid" });
      const [cmd, args] = invokeMock.mock.calls[0]!;
      expect(cmd).toBe("agent_validate_credentials");
      expect(args).toEqual({ provider: "anthropic", apiKey: "sk-test" });
    });

    it("propagates invalid outcome from the proxy", async () => {
      invokeMock.mockResolvedValueOnce({ kind: "invalid" });
      const provider = createAnthropicProvider(async () => "sk-test");
      expect(await provider.validateCredentials("sk-test")).toEqual({
        kind: "invalid",
      });
    });

    it("maps invoke rejection onto network_error (not invalid)", async () => {
      // WARN #4 contract: a transport-level failure must NOT look like a
      // bad key to the UI. The proxy itself now returns `NetworkError`,
      // but if the IPC boundary itself rejects (proxy panic, serde error),
      // we still land in this fallback — the shape must stay network_error.
      invokeMock.mockRejectedValueOnce(new Error("network error: no route"));
      const provider = createAnthropicProvider(async () => "sk-test");
      expect(await provider.validateCredentials("sk-test")).toEqual({
        kind: "network_error",
        message: "network error: no route",
      });
    });

    it("propagates network_error from the proxy verbatim", async () => {
      invokeMock.mockResolvedValueOnce({
        kind: "network_error",
        message: "dns lookup failed",
      });
      const provider = createAnthropicProvider(async () => "sk-test");
      expect(await provider.validateCredentials("sk-test")).toEqual({
        kind: "network_error",
        message: "dns lookup failed",
      });
    });
  });

  describe("fetchModels", () => {
    it("invokes agent_list_models and parses Anthropic shape", async () => {
      invokeMock.mockResolvedValueOnce({
        data: [
          { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4", type: "model" },
          { id: "claude-opus-4-20250514", display_name: "Claude Opus 4", type: "model" },
        ],
      });

      const provider = createAnthropicProvider(async () => "sk-test");
      const models = await provider.fetchModels!("sk-test");

      const [cmd, args] = invokeMock.mock.calls[0]!;
      expect(cmd).toBe("agent_list_models");
      expect(args).toEqual({ provider: "anthropic", apiKey: "sk-test" });
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe("claude-sonnet-4-20250514");
      expect(models[0].supportsTools).toBe(true);
    });

    it("propagates ProxyError string when invoke rejects", async () => {
      invokeMock.mockRejectedValueOnce("provider returned error 500: boom");
      const provider = createAnthropicProvider(async () => "sk-test");
      await expect(provider.fetchModels!("sk-test")).rejects.toBe(
        "provider returned error 500: boom",
      );
    });

    it("throws when no models returned", async () => {
      invokeMock.mockResolvedValueOnce({ data: [] });
      const provider = createAnthropicProvider(async () => "sk-test");
      await expect(provider.fetchModels!("sk-test")).rejects.toThrow(
        "No models returned",
      );
    });

    it("filters out non-model entries", async () => {
      invokeMock.mockResolvedValueOnce({
        data: [
          { id: "claude-sonnet-4-20250514", display_name: "Sonnet", type: "model" },
          { id: "some-embedding", display_name: "Embedding", type: "embedding" },
        ],
      });
      const provider = createAnthropicProvider(async () => "sk-test");
      const models = await provider.fetchModels!("sk-test");
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe("claude-sonnet-4-20250514");
    });
  });
});
