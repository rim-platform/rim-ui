import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Loader2,
  Trash2,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/toast/useToastStore";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useAgentStore } from "../state/useAgentStore";
import type { AiModelDef } from "../providers/types";
import { getProvider } from "../providers/registry";
import { createAnthropicProvider } from "../providers/anthropic";
import { createOpenAiProvider } from "../providers/openai";

// ──────────────────────────────────────────────────────────────
// Provider metadata
// ──────────────────────────────────────────────────────────────

interface ProviderMeta {
  id: "anthropic" | "openai";
  name: string;
  keyPlaceholder: string;
  apiKeyUrl: string;
}

/** All supported providers with their display metadata. */
const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    keyPlaceholder: "sk-ant-...",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    keyPlaceholder: "sk-...",
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
];

// ──────────────────────────────────────────────────────────────
// Tauri IPC helpers
// ──────────────────────────────────────────────────────────────

/**
 * Check whether a key is stored in the OS keyring for the given provider.
 * Returns false on any IPC error so the UI gracefully falls back to
 * "No key configured" instead of crashing.
 */
async function tauriIsProviderKeyConfigured(provider: string): Promise<boolean> {
  try {
    return await invoke<boolean>("is_provider_key_configured", { provider });
  } catch {
    return false;
  }
}

/**
 * Persist a validated API key to the OS keyring.
 * Only call this after `tauriValidateProvidedKey` returns `{ kind: "valid" }`.
 */
async function tauriSetProviderKey(provider: string, apiKey: string): Promise<void> {
  await invoke<void>("set_provider_key", { provider, apiKey });
}

/**
 * Remove the API key for `provider` from the OS keyring.
 */
async function tauriClearProviderKey(provider: string): Promise<void> {
  await invoke<void>("clear_provider_key", { provider });
}

/**
 * Validate `apiKey` against the live provider API without storing it.
 * The Rust command `agent_validate_provided_key` accepts the key directly
 * and does NOT write it to the keyring — safe to call before persisting.
 */
async function tauriValidateProvidedKey(
  provider: string,
  apiKey: string,
): Promise<ValidationOutcome> {
  return invoke<ValidationOutcome>("agent_validate_provided_key", {
    provider,
    apiKey,
  });
}

/**
 * Fetch the list of models for `provider` from the live API.
 * The Rust command reads the key from the OS keyring — only call this
 * after a key has been persisted via `tauriSetProviderKey`.
 */
async function tauriFetchModels(provider: string): Promise<AiModelDef[]> {
  if (provider === "anthropic") {
    const data = await invoke<{ data: { id: string; display_name: string; type: string }[] }>(
      "agent_list_models",
      { provider },
    );
    return data.data
      .filter((m) => m.type === "model")
      .map((m) => {
        const staticModels = getStaticModelsForProvider("anthropic");
        const staticMatch = staticModels.find((s) => s.id === m.id);
        return {
          id: m.id,
          name: m.display_name || m.id,
          contextWindow: staticMatch?.contextWindow ?? 200_000,
          supportsTools: true,
          supportsStreaming: true,
          inputPricePerMToken: staticMatch?.inputPricePerMToken,
          outputPricePerMToken: staticMatch?.outputPricePerMToken,
        };
      });
  }

  // openai
  const CHAT_PREFIXES = ["gpt", "o"];
  const data = await invoke<{ data: { id: string; owned_by: string }[] }>("agent_list_models", {
    provider,
  });
  const staticModels = getStaticModelsForProvider("openai");
  return data.data
    .filter((m) => CHAT_PREFIXES.some((p) => m.id.startsWith(p)))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((m) => {
      const staticMatch = staticModels.find((s) => s.id === m.id);
      return {
        id: m.id,
        name: m.id,
        contextWindow: staticMatch?.contextWindow ?? 128_000,
        supportsTools: true,
        supportsStreaming: true,
        inputPricePerMToken: staticMatch?.inputPricePerMToken,
        outputPricePerMToken: staticMatch?.outputPricePerMToken,
      };
    });
}

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

type ValidationOutcome =
  { kind: "valid" } | { kind: "invalid" } | { kind: "network_error"; message: string };

/** Transient verification state for the API key field. */
type VerifyState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "verified" }
  | { kind: "invalid" }
  | { kind: "network_error"; message: string }
  | { kind: "error"; message: string };

// ──────────────────────────────────────────────────────────────
// Static model fallback
// ──────────────────────────────────────────────────────────────

// Dummy loader used only for reading static `config.models`. Never invoked
// for `chat()` — the factory signature requires a thunk but the panel never
// calls `chat()`.
const NEVER_INVOKED_KEY_LOADER = async (): Promise<string> => {
  throw new Error("loader never invoked — static-models path must not call chat()");
};

/**
 * Return the static model list for the given provider ID.
 * Falls back to the globally-registered provider if present (avoids
 * allocating a second factory instance when the overlay already registered one).
 */
function getStaticModelsForProvider(providerId: string): AiModelDef[] {
  const existing = getProvider(providerId);
  if (existing) return existing.config.models;

  if (providerId === "anthropic") {
    return createAnthropicProvider(NEVER_INVOKED_KEY_LOADER).config.models;
  }
  if (providerId === "openai") {
    return createOpenAiProvider(NEVER_INVOKED_KEY_LOADER).config.models;
  }
  return [];
}

// ──────────────────────────────────────────────────────────────
// Main panel
// ──────────────────────────────────────────────────────────────

/**
 * Consolidated "AI Agent" settings panel.
 *
 * Merges the old `AgentSettingsPanel` (Stronghold-backed, on-blur save,
 * optional test) and `AiProviderKeySettings` (keyring-backed, validate-first
 * save) into a single panel per the agent-settings-consolidation decision.
 *
 * Layout (top → bottom):
 *   1. Heading + subhead (keyring storage statement)
 *   2. Data-leakage warning banner (rim-warm/30)
 *   3. Provider selector
 *   4. API key field (input + show/hide + Verify & Save + Delete)
 *      └─ Status pill: "Key set" / "No key configured"
 *      └─ Inline result line after verify: verified / invalid / network_error
 *   5. Model picker (gated on keyConfigured)
 *   6. Custom system prompt textarea (gated on keyConfigured)
 *
 * State contract:
 *   - Transient key/verify state is local (never stored in zustand).
 *   - `settings.providerId`, `settings.modelId`, `settings.systemPrompt`
 *     live in `useAgentStore` (zustand, persisted to localStorage).
 *   - `hasApiKey` in the store is updated on mount, on successful save, and
 *     on delete so `AgentOverlay` can gate its presence check without its own
 *     keyring round-trip.
 */
export function AgentSettingsPanel() {
  const { capabilities } = useRuntime();
  const settings = useAgentStore((s) => s.settings);
  const updateSettings = useAgentStore((s) => s.updateSettings);

  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>({ kind: "idle" });
  const [deleting, setDeleting] = useState(false);
  const [dynamicModels, setDynamicModels] = useState<AiModelDef[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const currentMeta = PROVIDERS.find((p) => p.id === settings.providerId) ?? PROVIDERS[0]!;
  const models = dynamicModels ?? getStaticModelsForProvider(settings.providerId);
  const canVerifyAndSave = keyInput.trim().length > 0 && verifyState.kind !== "verifying";

  // ── On mount / provider change: check keyring presence ─────────────────────
  useEffect(() => {
    if (!capabilities.agent) return;
    let cancelled = false;
    void tauriIsProviderKeyConfigured(settings.providerId).then((configured) => {
      if (cancelled) return;
      setKeyConfigured(configured);
      useAgentStore.getState().setHasApiKey(configured);
      // Reset transient state on provider switch
      setKeyInput("");
      setVerifyState({ kind: "idle" });
      setDynamicModels(null);
      setModelsError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.providerId, capabilities.agent]);

  // ── Provider switch ─────────────────────────────────────────────────────────
  function handleProviderChange(providerId: string) {
    const meta = PROVIDERS.find((p) => p.id === providerId);
    if (!meta) return;
    const newModels = getStaticModelsForProvider(providerId);
    updateSettings({
      providerId,
      modelId: newModels[0]?.id ?? "",
    });
    // keyring presence check will fire via the useEffect above on providerId change
  }

  // ── Verify & Save ───────────────────────────────────────────────────────────
  async function handleVerifyAndSave() {
    const key = keyInput.trim();
    if (!key) return;

    setVerifyState({ kind: "verifying" });

    try {
      // Step 1: validate without writing to keyring (existing key is untouched).
      const outcome = await tauriValidateProvidedKey(currentMeta.id, key);

      if (outcome.kind === "valid") {
        // Step 2: only persist after confirmation.
        await tauriSetProviderKey(currentMeta.id, key);
        setVerifyState({ kind: "verified" });
        setKeyConfigured(true);
        setKeyInput("");
        useAgentStore.getState().setHasApiKey(true);
        toast.success(`${currentMeta.name} key verified and saved.`);
      } else if (outcome.kind === "invalid") {
        // Invalid key — keyring untouched; existing key preserved.
        setVerifyState({ kind: "invalid" });
      } else {
        // Network error — cannot confirm key; do NOT store.
        setVerifyState({ kind: "network_error", message: outcome.message });
        toast.warning("Cannot reach provider — key not saved", {
          description: `${currentMeta.name} was unreachable. The key was not stored. Check your network and try again.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setVerifyState({ kind: "error", message });
      toast.error("Verification failed", { description: message });
    }
  }

  // ── Delete key ──────────────────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true);
    try {
      await tauriClearProviderKey(currentMeta.id);
      setKeyConfigured(false);
      setKeyInput("");
      setVerifyState({ kind: "idle" });
      useAgentStore.getState().setHasApiKey(false);
      toast.success(`${currentMeta.name} key removed.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to remove key", { description: message });
    } finally {
      setDeleting(false);
    }
  }

  // ── Refresh models ──────────────────────────────────────────────────────────
  async function handleFetchModels() {
    if (!keyConfigured) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      const fetched = await tauriFetchModels(settings.providerId);
      setDynamicModels(fetched);
      if (fetched.length > 0 && !fetched.find((m) => m.id === settings.modelId)) {
        updateSettings({ modelId: fetched[0].id });
      }
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setFetchingModels(false);
    }
  }

  return (
    <div data-testid="agent-settings" className="space-y-6">
      {/* Heading */}
      <div>
        <h2 className="text-base font-semibold text-rim-text">AI Agent</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          Configure an AI provider to use the agent. Keys are stored in your OS keyring and never
          leave your device.
        </p>
      </div>

      {/* Data-leakage warning — must be first thing after the heading */}
      <div className="rounded-lg border border-rim-warm/30 bg-rim-warm/5 px-4 py-3">
        <p className="text-xs text-rim-warm">
          When you use the AI Agent, workspace data (messages, channel names, member usernames) is
          sent to the selected AI provider for processing. Do not use the agent if your workspace
          contains sensitive data that should not be shared with third parties.
        </p>
      </div>

      {!capabilities.agent ? (
        <p className="text-sm text-rim-text-muted">
          Keyring-backed key storage is only available in the desktop app.
        </p>
      ) : (
        <>
          {/* Provider selector */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-rim-text-muted">Provider</label>
            <select
              value={settings.providerId}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full rounded border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* API Key field */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-rim-text-muted">API Key</label>
                {/* Status pill */}
                <span
                  className={
                    keyConfigured
                      ? "flex items-center gap-1 text-[10px] text-rim-success"
                      : "flex items-center gap-1 text-[10px] text-rim-text-faint"
                  }
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${keyConfigured ? "bg-rim-success" : "bg-rim-text-faint"}`}
                  />
                  {keyConfigured ? "Key set" : "No key configured"}
                </span>
              </div>
              <a
                href={currentMeta.apiKeyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-rim-accent transition hover:text-rim-accent/70"
              >
                Get API key
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? "text" : "password"}
                  value={keyInput}
                  onChange={(e) => {
                    setKeyInput(e.target.value);
                    setVerifyState({ kind: "idle" });
                  }}
                  placeholder={
                    keyConfigured ? "Enter new key to replace..." : currentMeta.keyPlaceholder
                  }
                  className="w-full rounded border border-rim-line bg-rim-void px-3 py-2 pr-9 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent/40"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-rim-text-faint transition hover:text-rim-text"
                  aria-label={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>

              <Button
                size="sm"
                disabled={!canVerifyAndSave}
                isLoading={verifyState.kind === "verifying"}
                onClick={() => void handleVerifyAndSave()}
              >
                Verify &amp; Save
              </Button>

              {keyConfigured && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  title="Remove stored key"
                  aria-label="Delete key"
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4 text-rim-danger" />
                  )}
                </Button>
              )}
            </div>

            {/* Inline verification status */}
            {verifyState.kind !== "idle" && verifyState.kind !== "verifying" && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                {verifyState.kind === "verified" && (
                  <>
                    <CheckCircle className="h-3.5 w-3.5 text-rim-success" />
                    <span className="text-rim-success">Key verified and saved.</span>
                  </>
                )}
                {verifyState.kind === "invalid" && (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-rim-danger" />
                    <span className="text-rim-danger">
                      Invalid key — not saved. Check and try again.
                    </span>
                  </>
                )}
                {verifyState.kind === "network_error" && (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-rim-warm" />
                    <span className="text-rim-warm">
                      Could not reach {currentMeta.name}. Key not saved — check your network and
                      retry.
                    </span>
                  </>
                )}
                {verifyState.kind === "error" && (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-rim-danger" />
                    <span className="text-rim-danger">{verifyState.message}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Model picker — gated on keyConfigured */}
          {keyConfigured && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-rim-text-muted">Model</label>
              <div className="flex gap-2">
                <select
                  value={settings.modelId}
                  onChange={(e) => updateSettings({ modelId: e.target.value })}
                  className="flex-1 rounded border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.inputPricePerMToken
                        ? ` ($${m.inputPricePerMToken}/${m.outputPricePerMToken} per MT)`
                        : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleFetchModels()}
                  disabled={fetchingModels}
                  className="rounded border border-rim-line bg-rim-void px-3 py-2 text-xs text-rim-text-muted transition hover:text-rim-text disabled:opacity-40"
                  title="Fetch latest models from provider"
                  aria-label="Refresh models"
                >
                  {fetchingModels ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              {dynamicModels && (
                <p className="mt-1 text-[10px] text-rim-text-faint">
                  {dynamicModels.length} models loaded from API
                </p>
              )}
              {modelsError && <p className="mt-1 text-[10px] text-rim-danger">{modelsError}</p>}
            </div>
          )}

          {/* System prompt — gated on keyConfigured */}
          {keyConfigured && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-rim-text-muted">
                Custom System Prompt <span className="text-rim-text-faint">(optional)</span>
              </label>
              <textarea
                value={settings.systemPrompt}
                onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
                placeholder="Leave empty to use the default system prompt..."
                rows={3}
                className="w-full resize-none rounded border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
