import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAnthropicProvider } from "./anthropic";
import type { AiMessage } from "./types";

describe("createAnthropicProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a provider with correct config", () => {
    const provider = createAnthropicProvider("sk-test");
    expect(provider.config.id).toBe("anthropic");
    expect(provider.config.name).toBe("Anthropic Claude");
    expect(provider.config.models.length).toBeGreaterThan(0);
  });

  it("config contains expected models", () => {
    const provider = createAnthropicProvider("sk-test");
    const modelIds = provider.config.models.map((m) => m.id);
    expect(modelIds).toContain("claude-opus-4-20250514");
    expect(modelIds).toContain("claude-sonnet-4-20250514");
    expect(modelIds).toContain("claude-haiku-3-5-20241022");
  });

  it("models have pricing info", () => {
    const provider = createAnthropicProvider("sk-test");
    for (const model of provider.config.models) {
      expect(model.inputPricePerMToken).toBeGreaterThan(0);
      expect(model.outputPricePerMToken).toBeGreaterThan(0);
      expect(model.supportsTools).toBe(true);
      expect(model.supportsStreaming).toBe(true);
    }
  });

  it("chat yields error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network down"));

    const provider = createAnthropicProvider("sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];

    const chunks = [];
    for await (const chunk of provider.chat({ model: "claude-sonnet-4-20250514", messages })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("error");
    if (chunks[0].kind === "error") {
      expect(chunks[0].message).toBe("Network down");
    }
  });

  it("chat yields error on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const provider = createAnthropicProvider("sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];

    const chunks = [];
    for await (const chunk of provider.chat({ model: "claude-sonnet-4-20250514", messages })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("error");
    if (chunks[0].kind === "error") {
      expect(chunks[0].message).toContain("401");
    }
  });

  it("chat yields error when response has no body", async () => {
    const mockResponse = new Response(null, { status: 200 });
    Object.defineProperty(mockResponse, "body", { value: null });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse);

    const provider = createAnthropicProvider("sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];

    const chunks = [];
    for await (const chunk of provider.chat({ model: "claude-sonnet-4-20250514", messages })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("error");
    if (chunks[0].kind === "error") {
      expect(chunks[0].message).toBe("No response body");
    }
  });

  it("chat sends correct headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const provider = createAnthropicProvider("sk-my-key");
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];

    // Consume the stream
    for await (const _ of provider.chat({ model: "claude-sonnet-4-20250514", messages })) {
      // drain
    }

    expect(fetchSpy).toHaveBeenCalledOnce();
    const callArgs = fetchSpy.mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-my-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("chat includes system prompt in body when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("error", { status: 400 }),
    );

    const provider = createAnthropicProvider("sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];

    for await (const _ of provider.chat({
      model: "claude-sonnet-4-20250514",
      messages,
      systemPrompt: "You are helpful",
    })) {
      // drain
    }

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.system).toBe("You are helpful");
    expect(body.stream).toBe(true);
  });

  it("chat includes tools in body when provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("error", { status: 400 }),
    );

    const provider = createAnthropicProvider("sk-test");
    const messages: AiMessage[] = [{ role: "user", content: "Hello" }];
    const tools = [
      { name: "search", description: "Search things", input_schema: { type: "object", properties: {} } },
    ];

    for await (const _ of provider.chat({
      model: "claude-sonnet-4-20250514",
      messages,
      tools,
    })) {
      // drain
    }

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].name).toBe("search");
  });

  describe("validateCredentials", () => {
    it("returns true on ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("ok", { status: 200 }),
      );
      const provider = createAnthropicProvider("sk-test");
      expect(await provider.validateCredentials("sk-test")).toBe(true);
    });

    it("returns false on unauthorized response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401 }),
      );
      const provider = createAnthropicProvider("sk-test");
      expect(await provider.validateCredentials("sk-bad")).toBe(false);
    });

    it("returns false on network error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
      const provider = createAnthropicProvider("sk-test");
      expect(await provider.validateCredentials("sk-test")).toBe(false);
    });
  });

  describe("fetchModels", () => {
    it("parses models from API response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4", type: "model" },
              { id: "claude-opus-4-20250514", display_name: "Claude Opus 4", type: "model" },
            ],
          }),
          { status: 200 },
        ),
      );

      const provider = createAnthropicProvider("sk-test");
      const models = await provider.fetchModels!("sk-test");
      expect(models).toHaveLength(2);
      expect(models[0].id).toBe("claude-sonnet-4-20250514");
      expect(models[0].supportsTools).toBe(true);
    });

    it("throws on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("error", { status: 500 }),
      );

      const provider = createAnthropicProvider("sk-test");
      await expect(provider.fetchModels!("sk-test")).rejects.toThrow("Anthropic API error 500");
    });

    it("throws when no models returned", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );

      const provider = createAnthropicProvider("sk-test");
      await expect(provider.fetchModels!("sk-test")).rejects.toThrow("No models returned");
    });

    it("filters out non-model entries", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "claude-sonnet-4-20250514", display_name: "Sonnet", type: "model" },
              { id: "some-embedding", display_name: "Embedding", type: "embedding" },
            ],
          }),
          { status: 200 },
        ),
      );

      const provider = createAnthropicProvider("sk-test");
      const models = await provider.fetchModels!("sk-test");
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe("claude-sonnet-4-20250514");
    });
  });
});
