import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiMessage } from "./types";

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

import { createOpenAiProvider } from "./openai";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

interface ChannelLike {
  send(ev: unknown): void;
}

function mockChatCompletion(events: unknown[]): void {
  invokeMock.mockImplementationOnce(
    async (_cmd: string, args: { onEvent: ChannelLike }) => {
      for (const ev of events) {
        args.onEvent.send(ev);
      }
    },
  );
}

describe("createOpenAiProvider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns a provider with correct config", () => {
    const provider = createOpenAiProvider(async () => "sk-test");
    expect(provider.config.id).toBe("openai");
    expect(provider.config.name).toBe("OpenAI");
    expect(provider.config.models.length).toBeGreaterThan(0);
  });

  it("config contains expected models", () => {
    const provider = createOpenAiProvider(async () => "sk-test");
    const modelIds = provider.config.models.map((m) => m.id);
    expect(modelIds).toContain("gpt-4.1");
    expect(modelIds).toContain("gpt-4o");
    expect(modelIds).toContain("gpt-4o-mini");
  });

  it("chat invokes agent_chat_completion with provider=openai, api_key, snake_case body", async () => {
    mockChatCompletion([{ kind: "done" }]);

    const provider = createOpenAiProvider(async () => "sk-my-key");
    const messages: AiMessage[] = [{ role: "user", content: "Hi" }];

    for await (const _ of provider.chat({
      model: "gpt-4o",
      messages,
      systemPrompt: "Be helpful",
    })) {
      // drain
    }

    expect(invokeMock).toHaveBeenCalledOnce();
    const [cmd, args] = invokeMock.mock.calls[0]!;
    expect(cmd).toBe("agent_chat_completion");
    const req = (args as { request: Record<string, unknown> }).request;
    expect(req.provider).toBe("openai");
    expect(req.model).toBe("gpt-4o");
    expect(req.api_key).toBe("sk-my-key");
    expect(req.max_tokens).toBe(4096);
    // System prompt is folded into messages, NOT a separate field for OpenAI
    const msgs = req.messages as { role: string; content?: string }[];
    expect(msgs[0]).toEqual({ role: "system", content: "Be helpful" });
  });

  it("chat omits tools when not provided", async () => {
    mockChatCompletion([{ kind: "done" }]);

    const provider = createOpenAiProvider(async () => "sk-test");
    for await (const _ of provider.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      // drain
    }
    const req = (invokeMock.mock.calls[0]![1] as { request: Record<string, unknown> })
      .request;
    expect(req).not.toHaveProperty("tools");
  });

  it("chat translates AiToolDefinition[] to OpenAI function-tool shape", async () => {
    mockChatCompletion([{ kind: "done" }]);

    const provider = createOpenAiProvider(async () => "sk-test");
    const tools = [
      {
        name: "search",
        description: "Search",
        input_schema: { type: "object", properties: {} },
      },
    ];

    for await (const _ of provider.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
      tools,
    })) {
      // drain
    }

    const req = (invokeMock.mock.calls[0]![1] as { request: Record<string, unknown> })
      .request;
    expect(req.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search",
          description: "Search",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });

  it("chat converts assistant tool_use blocks to OpenAI tool_calls format", async () => {
    mockChatCompletion([{ kind: "done" }]);

    const provider = createOpenAiProvider(async () => "sk-test");
    const messages: AiMessage[] = [
      { role: "user", content: "Search for X" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me search" },
          { type: "tool_use", id: "tool-1", name: "search", input: { query: "X" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "Found X" }],
      },
    ];

    for await (const _ of provider.chat({ model: "gpt-4o", messages })) {
      // drain
    }

    const req = (invokeMock.mock.calls[0]![1] as { request: Record<string, unknown> })
      .request;
    const msgs = req.messages as Record<string, unknown>[];
    const assistant = msgs.find((m) => m.role === "assistant")!;
    expect(assistant.tool_calls).toHaveLength(1);
    expect((assistant.tool_calls as { function: { name: string } }[])[0].function.name).toBe(
      "search",
    );
    const tool = msgs.find((m) => m.role === "tool")!;
    expect(tool.tool_call_id).toBe("tool-1");
    expect(tool.content).toBe("Found X");
  });

  it("chat yields error on ChatStreamEvent::Error", async () => {
    mockChatCompletion([{ kind: "error", message: "provider 429: rate_limit" }]);

    const provider = createOpenAiProvider(async () => "sk-test");
    const chunks = [];
    for await (const c of provider.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([
      { kind: "error", message: "provider 429: rate_limit" },
    ]);
  });

  it("chat yields error when invoke rejects without firing channel events", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Offline"));

    const provider = createOpenAiProvider(async () => "sk-test");
    const chunks = [];
    for await (const c of provider.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toMatchObject([{ kind: "error", message: "Offline" }]);
  });

  it("chat reassembles streaming text deltas + token usage", async () => {
    mockChatCompletion([
      {
        kind: "sse_event",
        event_type: null,
        data: { choices: [{ delta: { content: "Hello " } }] },
      },
      {
        kind: "sse_event",
        event_type: null,
        data: { choices: [{ delta: { content: "world" } }] },
      },
      {
        kind: "sse_event",
        event_type: null,
        data: {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        },
      },
      { kind: "done" },
    ]);

    const provider = createOpenAiProvider(async () => "sk-test");
    const chunks = [];
    for await (const c of provider.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([
      { kind: "text_delta", text: "Hello " },
      { kind: "text_delta", text: "world" },
      { kind: "done", usage: { inputTokens: 7, outputTokens: 3 } },
    ]);
  });

  it("chat reassembles tool_calls across delta frames and emits on finish_reason=tool_calls", async () => {
    mockChatCompletion([
      {
        kind: "sse_event",
        event_type: null,
        data: {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    function: { name: "search", arguments: '{"q":' },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        kind: "sse_event",
        event_type: null,
        data: {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }],
              },
            },
          ],
        },
      },
      {
        kind: "sse_event",
        event_type: null,
        data: { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      },
      { kind: "done" },
    ]);

    const provider = createOpenAiProvider(async () => "sk-test");
    const chunks = [];
    for await (const c of provider.chat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      chunks.push(c);
    }
    expect(chunks[0]).toEqual({
      kind: "tool_use",
      id: "call-1",
      name: "search",
      input: { q: "hi" },
    });
    expect(chunks.at(-1)).toMatchObject({ kind: "done" });
  });

  describe("validateCredentials", () => {
    it("invokes agent_validate_credentials with provider=openai", async () => {
      invokeMock.mockResolvedValueOnce({ kind: "valid" });
      const provider = createOpenAiProvider(async () => "sk-test");
      expect(await provider.validateCredentials("sk-test")).toEqual({
        kind: "valid",
      });
      const [cmd, args] = invokeMock.mock.calls[0]!;
      expect(cmd).toBe("agent_validate_credentials");
      expect(args).toEqual({ provider: "openai", apiKey: "sk-test" });
    });

    it("propagates invalid outcome from the proxy", async () => {
      invokeMock.mockResolvedValueOnce({ kind: "invalid" });
      const provider = createOpenAiProvider(async () => "sk-test");
      expect(await provider.validateCredentials("sk-test")).toEqual({
        kind: "invalid",
      });
    });

    it("maps invoke rejection onto network_error", async () => {
      // WARN #4 contract — same as anthropic: bad plumbing != bad key.
      invokeMock.mockRejectedValueOnce(new Error("fail"));
      const provider = createOpenAiProvider(async () => "sk-test");
      expect(await provider.validateCredentials("sk-test")).toEqual({
        kind: "network_error",
        message: "fail",
      });
    });
  });

  describe("fetchModels", () => {
    it("invokes agent_list_models and filters chat models by prefix", async () => {
      invokeMock.mockResolvedValueOnce({
        data: [
          { id: "gpt-4o", owned_by: "openai" },
          { id: "gpt-4o-mini", owned_by: "openai" },
          { id: "o3-mini", owned_by: "openai" },
          { id: "dall-e-3", owned_by: "openai" },
          { id: "whisper-1", owned_by: "openai" },
          { id: "tts-1", owned_by: "openai" },
        ],
      });

      const provider = createOpenAiProvider(async () => "sk-test");
      const models = await provider.fetchModels!("sk-test");
      const [cmd, args] = invokeMock.mock.calls[0]!;
      expect(cmd).toBe("agent_list_models");
      expect(args).toEqual({ provider: "openai", apiKey: "sk-test" });
      const ids = models.map((m) => m.id);
      expect(ids).toContain("gpt-4o");
      expect(ids).toContain("gpt-4o-mini");
      expect(ids).toContain("o3-mini");
      expect(ids).not.toContain("dall-e-3");
      expect(ids).not.toContain("whisper-1");
      expect(ids).not.toContain("tts-1");
    });

    it("propagates ProxyError string on rejection", async () => {
      invokeMock.mockRejectedValueOnce("provider returned error 500: boom");
      const provider = createOpenAiProvider(async () => "sk-test");
      await expect(provider.fetchModels!("sk-test")).rejects.toBe(
        "provider returned error 500: boom",
      );
    });

    it("throws when no chat models returned", async () => {
      invokeMock.mockResolvedValueOnce({
        data: [{ id: "dall-e-3", owned_by: "openai" }],
      });
      const provider = createOpenAiProvider(async () => "sk-test");
      await expect(provider.fetchModels!("sk-test")).rejects.toThrow(
        "No chat models returned",
      );
    });
  });
});
