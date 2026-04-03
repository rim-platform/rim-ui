/**
 * Secure key storage for AI agent API keys.
 * Uses Tauri Stronghold plugin (encrypted at rest) on desktop, falls back to localStorage on web.
 */

import type { Client, Stronghold } from "@tauri-apps/plugin-stronghold";

const STRONGHOLD_FILE = "rim-secrets.hold";
const STRONGHOLD_PASSWORD = "rim-agent-keys-v1";
const KEY_PREFIX = "api-key-";

let cachedStronghold: Stronghold | null = null;

async function getStronghold(): Promise<Stronghold> {
  if (cachedStronghold) return cachedStronghold;
  const { Stronghold } = await import("@tauri-apps/plugin-stronghold");
  const { appDataDir } = await import("@tauri-apps/api/path");
  const dir = await appDataDir();
  cachedStronghold = await Stronghold.load(`${dir}/${STRONGHOLD_FILE}`, STRONGHOLD_PASSWORD);
  return cachedStronghold;
}

async function getClient(): Promise<Client> {
  const stronghold = await getStronghold();
  try {
    return await stronghold.loadClient("rim-agent");
  } catch {
    return await stronghold.createClient("rim-agent");
  }
}

export async function saveApiKey(providerId: string, apiKey: string): Promise<void> {
  try {
    const client = await getClient();
    const store = client.getStore();
    await store.insert(KEY_PREFIX + providerId, Array.from(new TextEncoder().encode(apiKey)));
    await cachedStronghold?.save();
  } catch {
    console.warn("[keyStore] Stronghold unavailable, falling back to localStorage. API key storage is less secure.");
    try {
      localStorage.setItem(KEY_PREFIX + providerId, apiKey);
    } catch {
      // ignore
    }
  }
}

export async function loadApiKey(providerId: string): Promise<string | null> {
  try {
    const client = await getClient();
    const store = client.getStore();
    const bytes = await store.get(KEY_PREFIX + providerId);
    if (!bytes || bytes.length === 0) return null;
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    console.warn("[keyStore] Stronghold unavailable, falling back to localStorage.");
    try {
      return localStorage.getItem(KEY_PREFIX + providerId);
    } catch {
      return null;
    }
  }
}

export async function deleteApiKey(providerId: string): Promise<void> {
  try {
    const client = await getClient();
    const store = client.getStore();
    await store.remove(KEY_PREFIX + providerId);
    await cachedStronghold?.save();
  } catch {
    console.warn("[keyStore] Stronghold unavailable, falling back to localStorage.");
    try {
      localStorage.removeItem(KEY_PREFIX + providerId);
    } catch {
      // ignore
    }
  }
}
