/**
 * Secure key storage for AI agent API keys.
 * Uses Tauri Stronghold plugin (encrypted at rest) on desktop, falls back to localStorage on web.
 *
 * The Stronghold master password is derived from the OS keychain (macOS Keychain,
 * Windows Credential Manager, Linux Secret Service) — unique per installation.
 */

import type { Client, Stronghold } from "@tauri-apps/plugin-stronghold";

const STRONGHOLD_FILE = "rim-secrets.hold";
const KEY_PREFIX = "api-key-";

/** In-memory fallback store for web mode — keys persist only for the session. */
const memoryKeyStore = new Map<string, string>();

let cachedStronghold: Stronghold | null = null;

/** Retrieve the per-installation Stronghold password from the OS keychain via Tauri command. */
async function getStrongholdPassword(): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("get_stronghold_password");
}

async function getStronghold(): Promise<Stronghold> {
  if (cachedStronghold) return cachedStronghold;
  const { Stronghold } = await import("@tauri-apps/plugin-stronghold");
  const { appDataDir } = await import("@tauri-apps/api/path");
  const dir = await appDataDir();
  const password = await getStrongholdPassword();
  cachedStronghold = await Stronghold.load(`${dir}/${STRONGHOLD_FILE}`, password);
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
    console.warn("[keyStore] Stronghold unavailable, falling back to in-memory store. Keys will not persist across sessions.");
    memoryKeyStore.set(KEY_PREFIX + providerId, apiKey);
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
    console.warn("[keyStore] Stronghold unavailable, falling back to in-memory store.");
    return memoryKeyStore.get(KEY_PREFIX + providerId) ?? null;
  }
}

export async function deleteApiKey(providerId: string): Promise<void> {
  try {
    const client = await getClient();
    const store = client.getStore();
    await store.remove(KEY_PREFIX + providerId);
    await cachedStronghold?.save();
  } catch {
    console.warn("[keyStore] Stronghold unavailable, falling back to in-memory store.");
    memoryKeyStore.delete(KEY_PREFIX + providerId);
  }
}
