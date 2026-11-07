import { invoke } from "@tauri-apps/api/core";

import { useAgentStore } from "../state/useAgentStore";
import { getProvider, registerProvider } from "./registry";
import type { AiProvider } from "./types";

/** The error message of a provider asked for while the settings name one with no key in the vault. */
export const NO_API_KEY = "no-api-key";

/** The provider the AI agent settings choose, and the model to ask. */
export interface ConfiguredProvider {
  provider: AiProvider;
  modelId: string;
}

/**
 * Whether the secret vault holds a key for the provider the AI agent settings choose. The vault
 * is the single source of truth for provider keys; this asks it without reading the key.
 */
export async function providerKeyConfigured(): Promise<boolean> {
  const { providerId } = useAgentStore.getState().settings;
  return invoke<boolean>("is_provider_key_configured", { provider: providerId });
}

/**
 * The provider the AI agent settings choose, registered here when nothing has registered it yet,
 * so a builder opened before the agent overlay still works.
 *
 * @returns The provider and the model to ask.
 * @throws An `Error` with the message {@link NO_API_KEY} when the vault holds no key, or one that
 *   names a provider this app does not support.
 */
export async function configuredProvider(): Promise<ConfiguredProvider> {
  const { providerId, modelId } = useAgentStore.getState().settings;
  if (!(await providerKeyConfigured())) throw new Error(NO_API_KEY);
  let provider = getProvider(providerId);
  if (!provider) {
    if (providerId === "anthropic") {
      const { createAnthropicProvider } = await import("./anthropic");
      provider = createAnthropicProvider();
    } else if (providerId === "openai") {
      const { createOpenAiProvider } = await import("./openai");
      provider = createOpenAiProvider();
    } else {
      throw new Error(
        `Provider "${providerId}" is not supported. Configure the AI agent in Settings.`,
      );
    }
    registerProvider(provider);
  }
  return { provider, modelId };
}
