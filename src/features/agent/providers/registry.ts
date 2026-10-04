import type { AiProvider, AiProviderConfig } from "./types";

const providers = new Map<string, AiProvider>();

export function registerProvider(provider: AiProvider): void {
  providers.set(provider.config.id, provider);
}

export function getProvider(id: string): AiProvider | undefined {
  return providers.get(id);
}

export function listProviders(): AiProviderConfig[] {
  return Array.from(providers.values()).map((p) => p.config);
}
