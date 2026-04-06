import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOpenAiProvider } from "./openai";
import type { AiMessage } from "./types";

describe("createOpenAiProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a provider with correct config", () => {
    const provider = createOpenAiProvider("sk-test");
    expect(provider.config.id).toBe("openai");
    expect(provider.config.name).toBe("OpenAI");
    expect(provider.config.models.length).toBeGreaterThan(0);
  });

  it("config contains expected models", () => {
    const provider = createOpenAiProvider("sk-test");
    const modelIds = provider.config.models.map((m) => m.id);
    expect(modelIds).toContain("gpt-4.1");
    expect(modelIds).toContain("gpt-4o");
    expect(modelIds).toContain("gpt-4o-mini");
  });

  it("chat yields error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Offline"));

    const provider = createOpenAiProvider("sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hi" }];

    const chunks = [];
    for await (const chunk of provider.chat({ model: "gpt-4o", messages })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("error");
    if (chunks[0].kind === "error") {
      expect(chunks[0].message).toBe("Offline");
    }
  });

  it("chat yields error on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Rate limited", { status: 429 }),
    );

    const provider = createOpenAiProvider("sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hi" }];

    const chunks = [];
    for await (const chunk of provider.chat({ model: "gpt-4o", messages })) {
      chunks.push(chunk);
    }

    expect(chunks[0].kind).toBe("error");
    if (chunks[0].kind === "error") {
      expect(chunks[0].message).toContain("429");
    }
  });

  it("chat sends correct authorization header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("error", { status: 401 }),
    );

    const provider = createOpenAiProvider("sk-my-key");
    const messages: AiMessage[] = [{ role: "user", content: "Hi" }];

    for await (const _ of provider.chat({ model: "gpt-4o", messages })) {
      // drain
    }

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-my-key");
  });

  it("chat includes system message when systemPrompt provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("error", { status: 400 }),
    );

    const provider = createOpenAiProvider("sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hi" }];

    for await (const _ of provider.chat({
      model: "gpt-4o",
      messages,
      systemPrompt: "Be helpful",
    })) {
      // drain
    }

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe("Be helpful");
    expect(body.stream).toBe(true);
  });

  it("chat includes tools when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("error", { status: 400 }),
    );

    const provider = createOpenAiProvider("sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hi" }];
    const tools = [
      { name: "search", description: "Search", input_schema: { type: "object", properties: {} } },
    ];

    for await (const _ of provider.chat({ model: "gpt-4o", messages, tools })) {
      // drain
    }

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("search");
  });

  it("chat converts assistant tool_use blocks to OpenAI format", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("error", { status: 400 }),
    );

    const provider = createOpenAiProvider("sk-test");
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
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: "Found X" },
        ],
      },
    ];

    for await (const _ of provider.chat({ model: "gpt-4o", messages })) {
      // drain
    }

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    // Assistant message should have tool_calls
    const assistantMsg = body.messages.find((m: Record<string, unknown>) => m.role === "assistant");
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls[0].function.name).toBe("search");

    // Tool result should be a "tool" role message
    const toolMsg = body.messages.find((m: Record<string, unknown>) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe("tool-1");
    expect(toolMsg.content).toBe("Found X");
  });

  describe("validateCredentials", () => {
    it("returns true on ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("ok", { status: 200 }),
      );
      const provider = createOpenAiProvider("sk-test");
      expect(await provider.validateCredentials("sk-test")).toBe(true);
    });

    it("returns false on error response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("nope", { status: 401 }),
      );
      const provider = createOpenAiProvider("sk-test");
      expect(await provider.validateCredentials("sk-bad")).toBe(false);
    });

    it("returns false on network error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("fail"));
      const provider = createOpenAiProvider("sk-test");
      expect(await provider.validateCredentials("sk-test")).toBe(false);
    });
  });

  describe("fetchModels", () => {
    it("parses and filters chat models", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o", owned_by: "openai" },
              { id: "gpt-4o-mini", owned_by: "openai" },
              { id: "o3-mini", owned_by: "openai" },
              { id: "dall-e-3", owned_by: "openai" },
              { id: "whisper-1", owned_by: "openai" },
              { id: "tts-1", owned_by: "openai" },
            ],
          }),
          { status: 200 },
        ),
      );

      const provider = createOpenAiProvider("sk-test");
      const models = await provider.fetchModels!("sk-test");
      const ids = models.map((m) => m.id);

      expect(ids).toContain("gpt-4o");
      expect(ids).toContain("gpt-4o-mini");
      expect(ids).toContain("o3-mini");
      expect(ids).not.toContain("dall-e-3");
      expect(ids).not.toContain("whisper-1");
      expect(ids).not.toContain("tts-1");
    });

    it("throws on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("error", { status: 500 }),
      );

      const provider = createOpenAiProvider("sk-test");
      await expect(provider.fetchModels!("sk-test")).rejects.toThrow("OpenAI API error 500");
    });

    it("throws when no chat models returned", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "dall-e-3", owned_by: "openai" }] }),
          { status: 200 },
        ),
      );

      const provider = createOpenAiProvider("sk-test");
      await expect(provider.fetchModels!("sk-test")).rejects.toThrow("No chat models returned");
    });
  });
});
