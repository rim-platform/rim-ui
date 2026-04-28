import { useState, useEffect } from "react";
import { Eye, EyeOff, CheckCircle, XCircle, Loader2, Trash2, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

import { Button } from "../../../shared/ui/Button";
import { toast } from "../../../shared/toast/useToastStore";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";

// ──────────────────────────────────────────────────────────────
// Provider metadata
// ──────────────────────────────────────────────────────────────

interface ProviderMeta {
  id: "anthropic" | "openai";
  name: string;
  keyPlaceholder: string;
  apiKeyUrl: string;
}

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
// Tauri IPC helpers — typed, not raw invoke at call-sites
// ──────────────────────────────────────────────────────────────

type ValidationOutcome =
  | { kind: "valid" }
  | { kind: "invalid" }
  | { kind: "network_error"; message: string };

async function tauriIsProviderKeyConfigured(provider: string): Promise<boolean> {
  try {
    return await invoke<boolean>("is_provider_key_configured", { provider });
  } catch {
    return false;
  }
}

async function tauriSetProviderKey(provider: string, apiKey: string): Promise<void> {
  await invoke<void>("set_provider_key", { provider, apiKey });
}

async function tauriClearProviderKey(provider: string): Promise<void> {
  await invoke<void>("clear_provider_key", { provider });
}

async function tauriValidateProvidedKey(
  provider: string,
  apiKey: string,
): Promise<ValidationOutcome> {
  return invoke<ValidationOutcome>("agent_validate_provided_key", {
    provider,
    apiKey,
  });
}

// ──────────────────────────────────────────────────────────────
// Per-provider row
// ──────────────────────────────────────────────────────────────

type VerifyState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "verified" }
  | { kind: "invalid" }
  | { kind: "network_error"; message: string }
  | { kind: "error"; message: string };

interface ProviderKeyRowProps {
  meta: ProviderMeta;
}

function ProviderKeyRow({ meta }: ProviderKeyRowProps) {
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>({ kind: "idle" });
  const [deleting, setDeleting] = useState(false);

  // Check on mount whether a key is already stored
  useEffect(() => {
    let cancelled = false;
    void tauriIsProviderKeyConfigured(meta.id).then((configured) => {
      if (!cancelled) setKeyConfigured(configured);
    });
    return () => {
      cancelled = true;
    };
  }, [meta.id]);

  const canVerifyAndSave =
    keyInput.trim().length > 0 && verifyState.kind !== "verifying";

  async function handleVerifyAndSave() {
    const key = keyInput.trim();
    if (!key) return;

    setVerifyState({ kind: "verifying" });

    try {
      // Step 1: validate FIRST — Rust accepts the key directly without writing
      // it to the keyring. The existing stored key is untouched at this point.
      const outcome = await tauriValidateProvidedKey(meta.id, key);

      if (outcome.kind === "valid") {
        // Step 2 (valid path): validation passed — now safe to persist.
        await tauriSetProviderKey(meta.id, key);
        setVerifyState({ kind: "verified" });
        setKeyConfigured(true);
        setKeyInput("");
        toast.success(`${meta.name} key verified and saved.`);
      } else if (outcome.kind === "invalid") {
        // Invalid key — never touched the keyring; existing key is preserved.
        setVerifyState({ kind: "invalid" });
      } else {
        // network_error — we cannot reach the provider so we cannot confirm
        // the key. Do NOT store an unverified key; surface the failure and
        // let the user retry when connectivity is restored.
        setVerifyState({ kind: "network_error", message: outcome.message });
        toast.warning("Cannot reach provider — key not saved", {
          description: `${meta.name} was unreachable. The key was not stored. Check your network and try again.`,
        });
      }
    } catch (err) {
      // Unexpected IPC failure — no keyring write has occurred.
      const message = err instanceof Error ? err.message : String(err);
      setVerifyState({ kind: "error", message });
      toast.error("Verification failed", { description: message });
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await tauriClearProviderKey(meta.id);
      setKeyConfigured(false);
      setKeyInput("");
      setVerifyState({ kind: "idle" });
      toast.success(`${meta.name} key removed.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to remove key", { description: message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-lg border border-rim-line bg-rim-panel p-4 space-y-3">
      {/* Provider header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-rim-text">{meta.name}</p>
          <p className="text-xs text-rim-text-muted mt-0.5">
            {keyConfigured ? (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-rim-success" />
                Key set
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-rim-text-faint" />
                No key configured
              </span>
            )}
          </p>
        </div>
        <a
          href={meta.apiKeyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-rim-accent transition hover:text-rim-accent/70"
        >
          Get API key
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* Key input + Verify & Save */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={showKey ? "text" : "password"}
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value);
              setVerifyState({ kind: "idle" });
            }}
            placeholder={keyConfigured ? "Enter new key to replace..." : meta.keyPlaceholder}
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
        <div className="flex items-center gap-1.5 text-xs">
          {verifyState.kind === "verified" && (
            <>
              <CheckCircle className="h-3.5 w-3.5 text-rim-success" />
              <span className="text-rim-success">Key verified and saved.</span>
            </>
          )}
          {verifyState.kind === "invalid" && (
            <>
              <XCircle className="h-3.5 w-3.5 text-rim-danger" />
              <span className="text-rim-danger">Invalid key — not saved. Check and try again.</span>
            </>
          )}
          {verifyState.kind === "network_error" && (
            <>
              <XCircle className="h-3.5 w-3.5 text-rim-warm" />
              <span className="text-rim-warm">
                Could not reach {meta.name}. Key not saved — check your network and retry.
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
  );
}

// ──────────────────────────────────────────────────────────────
// Main panel
// ──────────────────────────────────────────────────────────────

export function AiProviderKeySettings() {
  const { capabilities } = useRuntime();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-rim-text">AI Provider Keys</h2>
        <p className="mt-1 text-sm text-rim-text-muted">
          API keys are stored in the OS keyring and never leave your device. The AI
          agent reads them directly from secure storage — they are not exposed to the
          webview.
        </p>
      </div>

      {/* Security note */}
      <div className="rounded-lg border border-rim-warm/30 bg-rim-warm/5 px-4 py-3">
        <p className="text-xs text-rim-warm">
          When you use the AI agent, workspace data (messages, channel names, member
          usernames) is sent to the selected provider for processing. Do not use the
          agent if your workspace contains data that should not leave your organisation.
        </p>
      </div>

      {/* Per-provider rows */}
      {capabilities.agent ? (
        <div className="space-y-3">
          {PROVIDERS.map((meta) => (
            <ProviderKeyRow key={meta.id} meta={meta} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-rim-text-muted">
          Keyring-backed key storage is only available in the desktop app.
        </p>
      )}
    </div>
  );
}
