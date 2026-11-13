import { useEffect, useId, useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import {
  WebhookPreviewOutcome,
  type WebhookFormatPreview,
} from "../../../core/graphql/generated/schema-types";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useShellStore } from "../../../shell/state/useShellStore";
import { Button } from "../../../shared/ui/Button";
import {
  NO_API_KEY,
  configuredProvider,
  providerKeyConfigured,
} from "../../agent/providers/configuredProvider";
import type { AiMessage } from "../../agent/providers/types";
import { useAgentStore } from "../../agent/state/useAgentStore";
import { previewWebhookFormat } from "../api/webhookFormatsApi";
import {
  copyablePrompt,
  formatUserPrompt,
  FORMAT_SYSTEM_PROMPT,
  parseFormatAnswer,
} from "../formats/aiPrompt";
import { formatToDraft, type DraftRule } from "../formats/draft";
import { linesToHeaders } from "../formats/sample";
import { PreviewOutcome } from "./PreviewOutcome";

/** The name a provider goes by in the notice before anything is sent. */
const PROVIDER_NAMES: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" };

/** Opens Settings > Assistant. */
function openAgentSettings() {
  useShellStore.getState().setMainSurface({ kind: "settings", tab: "agent" });
}

interface BuildWithAiProps {
  serverId: string;
  /** Try it's sample: its headers as `Name: value` lines and its body. */
  sample: { headers: string; body: string };
  /** Whether the editor already has rules someone wrote, so a draft asks before replacing them. */
  hasRules: boolean;
  /** Puts a draft in the editor. It is never saved here. */
  onDraft: (rules: DraftRule[]) => void;
}

/** A model's answer that passed the checks: the rules and Try it's result for the sample. */
interface Drafted {
  rules: DraftRule[];
  preview: WebhookFormatPreview;
  /** Whether it waits for the person to say it may replace their rules. */
  asking: boolean;
}

/**
 * Asks the person's own model for a format, from what the post should say and Try it's sample.
 * The model gets no tools, so it can only answer with text, and its answer is only a draft: it
 * is checked by a preview, sent back once with the reason when refused, and put in the editor for
 * the person to read and save. Where the app has no key, or on the web, it offers the same prompt
 * to copy into any AI instead. Nothing is sent without the notice saying where it goes on screen.
 */
export function BuildWithAi({ serverId, sample, hasRules, onDraft }: BuildWithAiProps) {
  const id = useId();
  const { platform } = useRuntime();
  const providerId = useAgentStore((s) => s.settings.providerId);
  const [description, setDescription] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(platform === "desktop" ? null : false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (platform !== "desktop") return;
    let live = true;
    providerKeyConfigured()
      .then((configured) => live && setHasKey(configured))
      .catch(() => live && setHasKey(false));
    return () => {
      live = false;
    };
  }, [platform, providerId]);

  const providerName = PROVIDER_NAMES[providerId] ?? providerId;
  const missing = !description.trim()
    ? "Write what it should post first."
    : !sample.body.trim()
      ? "Add a sample in Try it first: the answer is only as good as the sample."
      : null;

  /** The rules of `answer`, or why they won't do, checked by a preview with the sample. */
  async function check(answer: string): Promise<Drafted | { reason: string }> {
    const parsed = parseFormatAnswer(answer);
    if ("error" in parsed) return { reason: parsed.error };
    const draft = formatToDraft(parsed.json);
    if ("error" in draft) return { reason: draft.error };
    const preview = await previewWebhookFormat(
      serverId,
      parsed.json,
      linesToHeaders(sample.headers),
      sample.body,
    );
    if (preview.outcome === WebhookPreviewOutcome.FORMAT_REFUSED) {
      return {
        reason: preview.rule
          ? `Rule ${preview.rule}: ${preview.reason ?? ""}`
          : (preview.reason ?? "The format is refused."),
      };
    }
    return { rules: draft.rules, preview, asking: false };
  }

  async function build() {
    if (missing || working) return;
    setWorking(true);
    setError(null);
    setDrafted(null);
    try {
      const { provider, modelId } = await configuredProvider();
      const messages: AiMessage[] = [
        { role: "user", content: formatUserPrompt(description, sample) },
      ];
      const ask = async () => {
        let text = "";
        for await (const chunk of provider.chat({
          model: modelId,
          messages,
          systemPrompt: FORMAT_SYSTEM_PROMPT,
          maxTokens: 4096,
        })) {
          if (chunk.kind === "text_delta") text += chunk.text;
          else if (chunk.kind === "error") throw new Error(chunk.message);
        }
        return text;
      };
      let answer = await ask();
      let result = await check(answer);
      if ("reason" in result) {
        messages.push(
          { role: "assistant", content: answer },
          {
            role: "user",
            content: `That answer was refused: ${result.reason} Answer with only the corrected JSON.`,
          },
        );
        answer = await ask();
        result = await check(answer);
      }
      if ("reason" in result) {
        setError(`The answer didn't make a format: ${result.reason}`);
        return;
      }
      if (hasRules) setDrafted({ ...result, asking: true });
      else {
        onDraft(result.rules);
        setDrafted(result);
      }
    } catch (err) {
      if (err instanceof Error && err.message === NO_API_KEY) setHasKey(false);
      else setError(graphqlErrorMessage(err, "The model could not be asked"));
    } finally {
      setWorking(false);
    }
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(copyablePrompt(description, sample));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const canAsk = platform === "desktop" && hasKey === true;
  return (
    <section className="space-y-3" aria-labelledby={`${id}-heading`}>
      <h4 id={`${id}-heading`} className="text-sm font-semibold text-rim-text">
        Build with AI
      </h4>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-rim-text-faint">
          What should it post?
        </span>
        <textarea
          value={description}
          rows={3}
          placeholder="One line when a backup fails, with the host and the reason."
          onChange={(e) => setDescription(e.currentTarget.value)}
          className="w-full rounded-lg border border-rim-line bg-rim-void px-2.5 py-2 text-sm text-rim-text outline-none focus:border-rim-accent/40"
        />
      </label>
      {missing && <p className="text-xs text-rim-text-muted">{missing}</p>}
      {canAsk ? (
        <>
          <p className="text-xs text-rim-warm">
            This sends what you wrote and the sample to {providerName}.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={Boolean(missing)}
            isLoading={working}
            onClick={() => void build()}
          >
            Build with AI
          </Button>
          <p className="text-xs text-rim-text-faint">Uses the assistant&apos;s AI provider key.</p>
        </>
      ) : (
        <>
          <p className="text-xs text-rim-text-muted">
            Copy the prompt into any AI, then bring its answer back with Paste JSON. The prompt
            holds the sample, which goes wherever you paste it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(missing)}
              onClick={() => void copyPrompt()}
            >
              {copied ? "Copied" : "Copy prompt"}
            </Button>
            {platform === "desktop" && hasKey === false && (
              <Button type="button" size="sm" variant="ghost" onClick={openAgentSettings}>
                Add your AI provider key in Settings &gt; Assistant
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-rim-danger">
          {error}
        </p>
      )}
      {drafted && (
        <div className="space-y-2 rounded-lg border border-rim-line bg-rim-void p-3">
          {drafted.asking && (
            <div className="space-y-2">
              <p className="text-sm text-rim-text">
                The model wrote{" "}
                {drafted.rules.length === 1 ? "a rule" : `${drafted.rules.length} rules`}. Replace
                the rules you've written with them?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onDraft(drafted.rules);
                    setDrafted({ ...drafted, asking: false });
                  }}
                >
                  Replace my rules
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setDrafted(null)}>
                  Keep mine
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs text-rim-text-muted">
            A draft: read it, try it, and save it yourself. With the sample:
          </p>
          <PreviewOutcome preview={drafted.preview} />
        </div>
      )}
    </section>
  );
}
