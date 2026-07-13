/**
 * Secure key storage for AI agent API keys.
 * Uses Tauri Stronghold plugin (encrypted at rest) on desktop, falls back to localStorage on web.
 *
 * The Stronghold master password is derived from the OS keychain (macOS Keychain,
 * Windows Credential Manager, Linux Secret Service) — unique per installation.
 *
 * # Invariant: JS holds the key only for IPC transit duration
 *
 * Phase 4 closed C2 (webview-direct-to-provider) by routing all chat/validate/
 * model-list calls through `agent_chat_completion` / `agent_validate_credentials`
 * / `agent_list_models` Tauri commands. The CSP block in `tauri.conf.json` now
 * forbids `connect-src` to the provider origins outright.
 *
 * The remaining key-handling rule for callers (`AgentOverlay`, `AgentSettingsPanel`,
 * `useMacroAgent`):
 *
 *   1. Call `loadApiKey(providerId)` immediately before constructing a provider
 *      or sending a chat request — never cache the returned string at module scope.
 *   2. Pass it to the provider factory or invoke arg, then drop the local
 *      reference once the IPC call resolves or rejects.
 *   3. The next request re-reads from Stronghold; the OS keychain unlock is
 *      cheap (sub-millisecond on warm cache) and the per-request transit window
 *      is what Black Widow's §7 GREEN bar accepts for Phase 4.
 *
 * Phase 5+ (#56 P5-S1) moves key custody fully to Rust (OS keyring), so JS
 * never sees the bytes at all. Until then, treat any place the key sits in
 * a JS-side variable for longer than one IPC round-trip as a regression and
 * file the cleanup.
 */

import type { Client, Stronghold } from "@tauri-apps/plugin-stronghold";
import { logger } from "../../../core/logger";
import { toast } from "../../../shared/toast/useToastStore";

const STRONGHOLD_FILE = "rim-secrets.hold";
const KEY_PREFIX = "api-key-";

/** In-memory fallback store for web mode — keys persist only for the session. */
const memoryKeyStore = new Map<string, string>();

let cachedStronghold: Stronghold | null = null;

// Emit the security-degradation toast at most once per session so it doesn't
// spam on every key operation after Stronghold has already failed.
let strongholdWarningEmitted = false;

function emitStrongholdFallbackWarning(err: unknown): void {
  logger.error(
    "[keyStore] Stronghold unavailable — falling back to in-memory key store. Keys will NOT persist across sessions.",
    { target: "security", error: err },
  );
  if (!strongholdWarningEmitted) {
    strongholdWarningEmitted = true;
    toast.warning("Secure storage unavailable — credentials are in-memory only this session");
  }
}

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
  } catch (err) {
    emitStrongholdFallbackWarning(err);
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
  } catch (err) {
    emitStrongholdFallbackWarning(err);
    return memoryKeyStore.get(KEY_PREFIX + providerId) ?? null;
  }
}

/**
 * Load-use-discard helper. Reads the key from Stronghold, hands it to `fn`,
 * and lets the reference go out of scope when the function resolves. Callers
 * (`AgentOverlay`, `useMacroAgent`, the provider factories) must use this
 * helper instead of capturing the key in a longer-lived closure. Phase 4's
 * invariant (see module header) is that the key lives in JS only for the
 * single IPC round-trip inside `fn` — not for the lifetime of a provider
 * instance or React component.
 *
 * Throws `ProviderKeyMissingError` if Stronghold has no entry for the
 * provider so callers can distinguish "not configured yet" from arbitrary
 * IPC failures inside `fn`.
 */
export class ProviderKeyMissingError extends Error {
  readonly providerId: string;
  constructor(providerId: string) {
    super(`No API key configured for provider "${providerId}"`);
    this.name = "ProviderKeyMissingError";
    this.providerId = providerId;
  }
}

export async function withKey<T>(providerId: string, fn: (key: string) => Promise<T>): Promise<T> {
  const key = await loadApiKey(providerId);
  if (!key) throw new ProviderKeyMissingError(providerId);
  try {
    return await fn(key);
  } finally {
    // No explicit clearing — `key` is a primitive string on the stack frame
    // of this function and becomes GC-eligible when this frame pops. The
    // contract is structural: `fn` MUST NOT capture `key` in any outer
    // closure, module variable, or instance field. The refactored provider
    // factories consume `key` directly inside the one `invoke()` call.
  }
}

export async function deleteApiKey(providerId: string): Promise<void> {
  try {
    const client = await getClient();
    const store = client.getStore();
    await store.remove(KEY_PREFIX + providerId);
    await cachedStronghold?.save();
  } catch (err) {
    emitStrongholdFallbackWarning(err);
    memoryKeyStore.delete(KEY_PREFIX + providerId);
  }
}
