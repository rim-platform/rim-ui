import { useState, useEffect } from "react";
import { Eye, EyeOff, CheckCircle, XCircle, Loader2, RefreshCw, ExternalLink } from "lucide-react";

import type { AiModelDef } from "../providers/types";
import { useAgentStore } from "../state/useAgentStore";
import { getProvider } from "../providers/registry";
import { createAnthropicProvider } from "../providers/anthropic";
import { createOpenAiProvider } from "../providers/openai";
import { saveApiKey, loadApiKey } from "../runtime/keyStore";

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic (Claude)" },
  { id: "openai", name: "OpenAI (GPT)" },
] as const;

const API_KEY_URLS: Record<string, string> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};

// Trivial placeholder loader used only when we need to synthesise a provider
// instance to read its static `config.models` list. The loader is never
// invoked because this path does not call `chat()`. Post-#59 the factory
// signature expects a thunk, not a key — passing a no-op satisfies the
// type without handing it any secret material.
const NEVER_INVOKED_KEY_LOADER = async (): Promise<string> => {
  throw new Error(
    "loader never invoked — static-models path must not call chat()",
  );
};

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

export function AgentSettingsPanel() {
  const settings = useAgentStore((s) => s.settings);
  const hasApiKey = useAgentStore((s) => s.hasApiKey);
  const updateSettings = useAgentStore((s) => s.updateSettings);

  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  // `null` = not yet tested. Otherwise a discriminated result from the
  // provider (post-#59: distinguish "invalid" from "network_error" so the
  // user doesn't blame their key for a DNS hiccup — Hawkeye WARN #4).
  const [validationResult, setValidationResult] = useState<
    | { kind: "valid" }
    | { kind: "invalid" }
    | { kind: "network_error"; message: string }
    | null
  >(null);
  const [keyInput, setKeyInput] = useState("");
  const [dynamicModels, setDynamicModels] = useState<AiModelDef[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const models = dynamicModels ?? getStaticModelsForProvider(settings.providerId);

  // Check if API key exists on mount / provider change
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      useAgentStore.getState().setLoadApiKeyStatus("loading");
      const key = await loadApiKey(settings.providerId);
      if (cancelled) return;
      useAgentStore.getState().setHasApiKey(!!key);
      useAgentStore.getState().setLoadApiKeyStatus("loaded");
      // Show masked placeholder if key exists, but don't expose the actual key
      setKeyInput(key ? key : "");
    })();
    return () => { cancelled = true; };
  }, [settings.providerId]);

  const handleProviderChange = (providerId: string) => {
    const newModels = getStaticModelsForProvider(providerId);
    updateSettings({
      providerId,
      modelId: newModels[0]?.id ?? "",
    });
    setValidationResult(null);
    setKeyInput("");
    setDynamicModels(null);
  };

  const handleFetchModels = async () => {
    const apiKey = keyInput.trim() || (await loadApiKey(settings.providerId));
    if (!apiKey) return;

    setFetchingModels(true);
    setModelsError(null);
    try {
      // Local-scope loader for one-shot fetchModels. Deliberately NOT
      // registered against the global provider registry — that's
      // AgentOverlay's responsibility, and its loader reads Stronghold
      // fresh per chat-request. Registering here would pin an unsaved
      // key into the registry's closure for the lifetime of the session,
      // violating the #59 invariant.
      const loader = async () => apiKey;
      let provider;
      if (settings.providerId === "anthropic") {
        provider = createAnthropicProvider(loader);
      } else if (settings.providerId === "openai") {
        provider = createOpenAiProvider(loader);
      }

      if (provider?.fetchModels) {
        const fetched = await provider.fetchModels(apiKey);
        setDynamicModels(fetched);
        if (fetched.length > 0 && !fetched.find((m) => m.id === settings.modelId)) {
          updateSettings({ modelId: fetched[0].id });
        }
      }
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setFetchingModels(false);
    }
  };

  const handleKeyBlur = () => {
    if (keyInput.trim()) {
      void saveApiKey(settings.providerId, keyInput.trim()).then(() => {
        useAgentStore.getState().setHasApiKey(true);
      });
    }
  };

  const handleValidate = async () => {
    // Load the actual key from secure storage
    const apiKey = keyInput.trim() || (await loadApiKey(settings.providerId));
    if (!apiKey) return;

    setValidating(true);
    setValidationResult(null);

    try {
      // Same rationale as handleFetchModels: local-scope provider only.
      // We DO NOT register this instance globally — AgentOverlay will
      // re-register with a Stronghold-reading loader on its first chat()
      // call. That's the registry's source of truth for run-time dispatch.
      const loader = async () => apiKey;
      let provider;
      if (settings.providerId === "anthropic") {
        provider = createAnthropicProvider(loader);
      } else if (settings.providerId === "openai") {
        provider = createOpenAiProvider(loader);
      }

      if (provider) {
        const outcome = await provider.validateCredentials(apiKey);
        setValidationResult(outcome);

        // On valid credentials, auto-fetch models. On invalid / network
        // error we skip the fetch — it would fail with the same cause and
        // spam a second error line.
        if (outcome.kind === "valid" && provider.fetchModels) {
          setFetchingModels(true);
          setModelsError(null);
          try {
            const fetched = await provider.fetchModels(apiKey);
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
      }
    } catch (err) {
      // The provider wrapper already catches invoke errors and maps them
      // to `network_error`. This outer catch only fires on an unexpected
      // synchronous throw (e.g. provider factory blew up) — surface it as
      // a network_error too rather than silently flipping to "Invalid".
      const message = err instanceof Error ? err.message : "validation failed";
      setValidationResult({ kind: "network_error", message });
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-medium text-rim-text">AI Agent</h3>
        <p className="text-xs text-rim-text-muted">
          Configure an AI provider to use the agent assistant. Your API key is stored locally and never sent to the RIM server.
        </p>
      </div>

      {/* Data leakage warning */}
      <div className="rounded-lg border border-rim-warm/30 bg-rim-warm/5 px-4 py-3">
        <p className="text-xs text-rim-warm">
          When you use the AI Agent, workspace data (messages, channel names, member usernames)
          is sent to the selected AI provider for processing. Do not use the agent if your
          workspace contains sensitive data that should not be shared with third parties.
        </p>
      </div>

      {/* Provider */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-rim-text-muted">Provider</label>
        <select
          value={settings.providerId}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="w-full rounded border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none focus:border-rim-accent"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* API Key */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs font-medium text-rim-text-muted">API Key</label>
          {API_KEY_URLS[settings.providerId] && (
            <a
              href={API_KEY_URLS[settings.providerId]}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-rim-accent transition hover:text-rim-accent-strong"
            >
              Get API key
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setValidationResult(null);
              }}
              onBlur={handleKeyBlur}
              placeholder={settings.providerId === "anthropic" ? "sk-ant-..." : "sk-..."}
              className="w-full rounded border border-rim-line bg-rim-void px-3 py-2 pr-9 text-sm text-rim-text outline-none focus:border-rim-accent"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-rim-text-faint transition hover:text-rim-text"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <button
            type="button"
            onClick={handleValidate}
            disabled={(!keyInput.trim() && !hasApiKey) || validating}
            className="rounded border border-rim-line bg-rim-void px-3 py-2 text-xs text-rim-text-muted transition hover:text-rim-text disabled:opacity-40"
          >
            {validating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Test"
            )}
          </button>
        </div>
        {validationResult !== null && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            {validationResult.kind === "valid" && (
              <>
                <CheckCircle className="h-3 w-3 text-rim-success" />
                <span className="text-rim-success">API key is valid</span>
              </>
            )}
            {validationResult.kind === "invalid" && (
              <>
                <XCircle className="h-3 w-3 text-rim-danger" />
                <span className="text-rim-danger">Invalid API key</span>
              </>
            )}
            {validationResult.kind === "network_error" && (
              <>
                <XCircle className="h-3 w-3 text-rim-warm" />
                <span className="text-rim-warm">
                  Could not reach provider. Check your network and try again.
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Model — visible only after API key is set */}
      {(hasApiKey || validationResult?.kind === "valid") && (
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
                  {m.inputPricePerMToken ? ` ($${m.inputPricePerMToken}/${m.outputPricePerMToken} per MT)` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleFetchModels}
              disabled={fetchingModels}
              className="rounded border border-rim-line bg-rim-void px-3 py-2 text-xs text-rim-text-muted transition hover:text-rim-text disabled:opacity-40"
              title="Fetch latest models from provider"
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
          {modelsError && (
            <p className="mt-1 text-[10px] text-rim-danger">
              {modelsError}
            </p>
          )}
        </div>
      )}

      {/* System Prompt — visible only after API key is set */}
      {(hasApiKey || validationResult?.kind === "valid") && (
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
    </div>
  );
}
