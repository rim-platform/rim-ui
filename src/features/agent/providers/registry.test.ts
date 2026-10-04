import { describe, it, expect, beforeEach } from "vitest";
import { registerProvider, getProvider, listProviders } from "./registry";
import type { AiProvider, AiProviderConfig } from "./types";

function makeProvider(id: string, name: string): AiProvider {
  const config: AiProviderConfig = {
    id,
    name,
    models: [
      {
        id: `${id}-model-1`,
        name: `${name} Model 1`,
        contextWindow: 128_000,
        supportsTools: true,
        supportsStreaming: true,
      },
    ],
  };

  return {
    config,
    async *chat() {
      yield { kind: "done" as const, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

describe("provider registry", () => {
  beforeEach(() => {
    // Clear existing providers by re-registering known ones isn't ideal,
    // but the registry doesn't expose a clear function. We test incrementally.
  });

  it("registers and retrieves a provider", () => {
    const provider = makeProvider("test-provider", "Test Provider");
    registerProvider(provider);
    const found = getProvider("test-provider");
    expect(found).toBeDefined();
    expect(found?.config.name).toBe("Test Provider");
  });

  it("returns undefined for unregistered provider", () => {
    expect(getProvider("nonexistent-provider-xyz")).toBeUndefined();
  });

  it("overwrites a provider on re-registration", () => {
    const p1 = makeProvider("overwrite-test", "Original");
    const p2 = makeProvider("overwrite-test", "Replacement");
    registerProvider(p1);
    registerProvider(p2);
    expect(getProvider("overwrite-test")?.config.name).toBe("Replacement");
  });

  it("listProviders returns all registered configs", () => {
    registerProvider(makeProvider("list-a", "Provider A"));
    registerProvider(makeProvider("list-b", "Provider B"));
    const configs = listProviders();
    expect(configs.some((c) => c.id === "list-a")).toBe(true);
    expect(configs.some((c) => c.id === "list-b")).toBe(true);
  });

  it("listProviders returns configs with models", () => {
    registerProvider(makeProvider("with-models", "With Models"));
    const configs = listProviders();
    const cfg = configs.find((c) => c.id === "with-models");
    expect(cfg?.models).toHaveLength(1);
    expect(cfg?.models[0].id).toBe("with-models-model-1");
  });
});
