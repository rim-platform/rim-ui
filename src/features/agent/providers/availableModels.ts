import { invoke } from "@tauri-apps/api/core";

import { loadProvider } from "./configuredProvider";
import type { AiModelDef } from "./types";

/** The providers the agent talks to, in the order the model picker lists them. */
export const AGENT_PROVIDER_IDS = ["anthropic", "openai"] as const;

/** The models one set-up provider offers. */
export interface ProviderModels {
  providerId: string;
  providerName: string;
  models: AiModelDef[];
}

/** Whether the secret vault holds a key for `providerId`; an IPC failure counts as no key. */
async function keyConfigured(providerId: string): Promise<boolean> {
  try {
    return await invoke<boolean>("is_provider_key_configured", { provider: providerId });
  } catch {
    return false;
  }
}

/**
 * The models the agent can use now: those of each provider with a key in the secret vault, from
 * the provider's live list when there is one, else its built-in list.
 *
 * @param byProvider - The live model lists, by provider id.
 * @returns One entry per set-up provider, in {@link AGENT_PROVIDER_IDS} order.
 */
export async function availableModels(
  byProvider: Record<string, AiModelDef[]>,
): Promise<ProviderModels[]> {
  const entries = await Promise.all(
    AGENT_PROVIDER_IDS.map(async (providerId): Promise<ProviderModels | null> => {
      if (!(await keyConfigured(providerId))) return null;
      const provider = await loadProvider(providerId);
      const live = byProvider[providerId];
      return {
        providerId,
        providerName: provider.config.name,
        models: live && live.length > 0 ? live : provider.config.models,
      };
    }),
  );
  return entries.filter((entry) => entry !== null);
}
