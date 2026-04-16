import { useState, useCallback } from "react";
import { Loader2, Wand2, AlertCircle } from "lucide-react";

import { Dialog } from "../../../shared/ui/Dialog";
import { useCommands } from "../../commands/api/useCommands";
import { useMacroAgent } from "../runtime/useMacroAgent";
import type { MacroStep } from "../api/useMacros";
import type { GeneratedMacro } from "../runtime/useMacroAgent";

interface AiMacroBuilderProps {
  open: boolean;
  onClose: () => void;
  onStepsGenerated: (macro: GeneratedMacro) => void;
}

export function AiMacroBuilder({ open, onClose, onStepsGenerated }: AiMacroBuilderProps) {
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<GeneratedMacro | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const { data: commands } = useCommands("PALETTE");
  const { generate, isGenerating, error: agentError } = useMacroAgent();

  const error = localError ?? agentError;

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;

    setLocalError(null);
    setPreview(null);

    if (!commands || commands.length === 0) {
      setLocalError("Command catalog not loaded. Please try again.");
      return;
    }

    try {
      const result = await generate(trimmed, commands);
      setPreview(result);
    } catch (err) {
      if (err instanceof Error && err.message === "no-api-key") {
        setLocalError("no-api-key");
      }
      // agentError state is set by useMacroAgent
    }
  }, [prompt, isGenerating, commands, generate]);

  const handleUseSteps = useCallback(() => {
    if (!preview) return;
    onStepsGenerated(preview);
    onClose();
  }, [preview, onStepsGenerated, onClose]);

  const handleClose = useCallback(() => {
    if (isGenerating) return;
    setPrompt("");
    setPreview(null);
    setLocalError(null);
    onClose();
  }, [isGenerating, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        void handleGenerate();
      }
    },
    [handleGenerate],
  );

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Build Macro with AI"
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        {/* Prompt input */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-rim-text">
            Describe what you want the macro to do
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Mark all messages in the current channel as read, then switch to the next unread channel"
            rows={4}
            disabled={isGenerating}
            className="w-full resize-none rounded-lg border border-rim-line bg-rim-void px-3 py-2 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent disabled:opacity-60"
          />
          <p className="mt-1 text-xs text-rim-text-faint">
            Tip: Press Cmd/Ctrl+Enter to generate
          </p>
        </div>

        {/* No-API-key error */}
        {error === "no-api-key" && (
          <div className="flex items-start gap-2.5 rounded-lg border border-rim-warm/30 bg-rim-warm/5 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rim-warm" />
            <p className="text-sm text-rim-warm">
              No AI provider configured. Go to{" "}
              <strong>Settings &rsaquo; AI Agent</strong> to add your API key.
            </p>
          </div>
        )}

        {/* Other errors */}
        {error && error !== "no-api-key" && (
          <div className="flex items-start gap-2.5 rounded-lg border border-rim-danger/30 bg-rim-danger/5 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rim-danger" />
            <p className="text-sm text-rim-danger">{error}</p>
          </div>
        )}

        {/* Loading state */}
        {isGenerating && (
          <div className="flex items-center gap-2 text-sm text-rim-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Generating macro steps...</span>
          </div>
        )}

        {/* Preview */}
        {preview && !isGenerating && (
          <div className="rounded-lg border border-rim-line bg-rim-void p-4 space-y-3">
            <div>
              <div className="text-sm font-medium text-rim-text">{preview.name}</div>
              {preview.description && (
                <div className="mt-0.5 text-xs text-rim-text-muted">{preview.description}</div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-rim-text-muted uppercase tracking-wide">
                Steps ({preview.steps.length})
              </div>
              {preview.steps.map((step: MacroStep, i: number) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded border border-rim-line bg-rim-panel px-3 py-2"
                >
                  <span className="mt-0.5 shrink-0 text-xs font-mono text-rim-text-faint">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono text-rim-text">{step.commandId}</div>
                    {step.args != null &&
                      typeof step.args === "object" &&
                      Object.keys(step.args as Record<string, unknown>).length > 0 && (
                        <div className="mt-0.5 text-xs font-mono text-rim-text-faint">
                          {JSON.stringify(step.args as Record<string, unknown>)}
                        </div>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={isGenerating}
            className="rounded-lg border border-rim-line px-4 py-2 text-sm text-rim-text-muted transition hover:bg-rim-void/50 disabled:opacity-50"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            {preview && (
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setLocalError(null);
                }}
                disabled={isGenerating}
                className="rounded-lg border border-rim-line px-4 py-2 text-sm text-rim-text-muted transition hover:bg-rim-void/50 disabled:opacity-50"
              >
                Regenerate
              </button>
            )}

            {preview ? (
              <button
                type="button"
                onClick={handleUseSteps}
                className="flex items-center gap-1.5 rounded-lg bg-rim-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-rim-accent/90"
              >
                Use these steps
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!prompt.trim() || isGenerating}
                className="flex items-center gap-1.5 rounded-lg bg-rim-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-rim-accent/90 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    Generate
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
