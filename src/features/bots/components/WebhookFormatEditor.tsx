import { useId, useMemo, useState } from "react";

import { graphqlErrorCode, graphqlErrorMessage } from "../../../core/graphql/errors";
import {
  WebhookPreset,
  WebhookPreviewOutcome,
  type IncomingWebhook,
  type WebhookFormatPreview,
} from "../../../core/graphql/generated/schema-types";
import { Button } from "../../../shared/ui/Button";
import { Dialog } from "../../../shared/ui/Dialog";
import { WEBHOOK_TEST_SESSIONS } from "../../updater/api/serverCapabilities";
import { useSpaceHasCapability } from "../../updater/hooks/useSpaceHasCapability";
import {
  createIncomingWebhookWithFormat,
  previewWebhookFormat,
  updateIncomingWebhookFormat,
  useWebhookFormats,
} from "../api/webhookFormatsApi";
import { parseFormatAnswer } from "../formats/aiPrompt";
import {
  blankRule,
  draftToFormat,
  formatToDraft,
  placeRefusal,
  type DraftRule,
} from "../formats/draft";
import { headersToLines, linesToHeaders, samplePaths } from "../formats/sample";
import { webhookUrl } from "../webhookUrl";
import { BuildWithAi } from "./BuildWithAi";
import { DeliveryLog, type OpenSession } from "./DeliveryLog";
import { PreviewOutcome } from "./PreviewOutcome";
import { RuleCard } from "./RuleCard";

const AREA_CLASS =
  "w-full rounded-lg border border-rim-line bg-rim-void px-2.5 py-2 font-mono text-xs text-rim-text outline-none focus:border-rim-accent/40";
const LABEL_CLASS = "mb-1 block text-xs font-medium text-rim-text-faint";

/** What the editor writes: a new webhook's format, or an existing webhook's. */
export type FormatEditorTarget =
  | { kind: "new"; conversationId: string; botUserId: string }
  | { kind: "edit"; webhook: IncomingWebhook };

/** What saving did. */
export type SavedFormat =
  | { kind: "updated" }
  /** A new webhook: its URL, which is the test URL already handed out when `keptTestUrl`. */
  | { kind: "created"; id: string; url: string; keptTestUrl: boolean };

interface WebhookFormatEditorProps {
  serverId: string;
  target: FormatEditorTarget;
  onSaved: (saved: SavedFormat) => void;
  onClose: () => void;
}

/** Why the server refuses the format: a reason per rule, counted from 1, and one for the whole. */
interface Refusals {
  byRule: Record<number, string>;
  whole: string | null;
}

const NO_REFUSALS: Refusals = { byRule: {}, whole: null };

function refusalsOf(message: string): Refusals {
  const { rule, reason } = placeRefusal(message);
  return rule ? { byRule: { [rule]: reason }, whole: null } : { byRule: {}, whole: reason };
}

/**
 * Writes the format of a webhook, opening an unedited GitHub webhook as a copy of RIM's GitHub
 * format once that has loaded: rules as cards, Try it on a sample, the deliveries a service
 * really sends where the host keeps them, a draft from the person's own AI, and JSON to copy and
 * paste. Saving creates the new webhook or changes an existing one's format, whose URL stays the
 * same; the server checks the format again and its refusals land beside their rule.
 */
export function WebhookFormatEditor(props: WebhookFormatEditorProps) {
  const { serverId, target, onClose } = props;
  const formats = useWebhookFormats(serverId, true);
  const editing = target.kind === "edit" ? target.webhook : null;
  const followsGithub = Boolean(
    editing && !editing.template && editing.preset === WebhookPreset.GITHUB,
  );
  const github = formats.data?.find((f) => f.key === "github");

  if (followsGithub && !github) {
    return (
      <Dialog open title="Webhook format" onClose={onClose} maxWidth="max-w-3xl">
        <p className="text-sm text-rim-text-muted">
          {formats.isError ? "Could not load RIM's GitHub format." : "Loading the format..."}
        </p>
      </Dialog>
    );
  }
  let start: Start = { rules: target.kind === "new" ? [blankRule()] : [], headers: "", body: "" };
  if (editing?.template) {
    const read = formatToDraft(editing.template);
    start = { ...start, rules: "rules" in read ? read.rules : [] };
  } else if (followsGithub && github) {
    const read = formatToDraft(github.format);
    start = {
      rules: "rules" in read ? read.rules : [],
      headers: headersToLines(github.sampleHeaders),
      body: github.sampleBody,
    };
  }
  return <FormatEditorBody {...props} start={start} followsGithub={followsGithub} />;
}

/** What the editor opens with: its rules and Try it's sample. */
interface Start {
  rules: DraftRule[];
  headers: string;
  body: string;
}

function FormatEditorBody({
  serverId,
  target,
  onSaved,
  onClose,
  start,
  followsGithub,
}: WebhookFormatEditorProps & { start: Start; followsGithub: boolean }) {
  const pathsListId = useId();
  const formats = useWebhookFormats(serverId, true);
  const withLog = useSpaceHasCapability(serverId, WEBHOOK_TEST_SESSIONS);
  const editing = target.kind === "edit" ? target.webhook : null;

  const [rules, setRules] = useState<DraftRule[]>(start.rules);
  const [startFrom, setStartFrom] = useState("");
  const [headers, setHeaders] = useState(start.headers);
  const [body, setBody] = useState(start.body);
  const [tried, setTried] = useState<WebhookFormatPreview | null>(null);
  const [trying, setTrying] = useState(false);
  const [refusals, setRefusals] = useState<Refusals>(NO_REFUSALS);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [session, setSession] = useState<OpenSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const format = useMemo(() => draftToFormat(rules), [rules]);
  const paths = useMemo(() => samplePaths(body), [body]);
  const hasWrittenRules = rules.some((r) => r.post.trim() || r.conditions.length > 0);

  function changeRules(next: DraftRule[]) {
    setRules(next);
    setRefusals(NO_REFUSALS);
  }

  function useStart() {
    if (!startFrom) {
      changeRules([blankRule()]);
      return;
    }
    const chosen = formats.data?.find((f) => f.key === startFrom);
    if (!chosen) return;
    const read = formatToDraft(chosen.format);
    if ("rules" in read) changeRules(read.rules);
    setHeaders(headersToLines(chosen.sampleHeaders));
    setBody(chosen.sampleBody);
    setTried(null);
  }

  async function tryIt() {
    setTrying(true);
    setError(null);
    try {
      const preview = await previewWebhookFormat(serverId, format, linesToHeaders(headers), body);
      setTried(preview);
      if (preview.outcome === WebhookPreviewOutcome.FORMAT_REFUSED) {
        setRefusals(
          preview.rule
            ? { byRule: { [preview.rule]: preview.reason ?? "" }, whole: null }
            : { byRule: {}, whole: preview.reason ?? null },
        );
      } else {
        setRefusals(NO_REFUSALS);
      }
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not try the format"));
    } finally {
      setTrying(false);
    }
  }

  function usePasted() {
    const parsed = parseFormatAnswer(pasted);
    if ("error" in parsed) {
      setPasteError(parsed.error);
      return;
    }
    const read = formatToDraft(parsed.json);
    if ("error" in read) {
      setPasteError(read.error);
      return;
    }
    changeRules(read.rules);
    setPasted("");
    setPasteError(null);
    setPasting(false);
  }

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(format, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (target.kind === "edit") {
        await updateIncomingWebhookFormat(serverId, target.webhook.id, WebhookPreset.PLAIN, format);
        onSaved({ kind: "updated" });
        return;
      }
      const created = await createIncomingWebhookWithFormat({
        conversationId: target.conversationId,
        botUserId: target.botUserId,
        preset: WebhookPreset.PLAIN,
        template: format,
        ...(session ? { testSessionId: session.id } : {}),
      });
      const kept = Boolean(created.keptTestUrl && session?.url);
      onSaved({
        kind: "created",
        id: created.webhook.id,
        url: kept ? session!.url! : await webhookUrl(created.token),
        keptTestUrl: kept,
      });
    } catch (err) {
      if (graphqlErrorCode(err) === "VALIDATION") {
        const message = graphqlErrorMessage(err, "The format is refused");
        const placed = refusalsOf(message);
        setRefusals(placed);
        if (placed.whole) setError(placed.whole);
        else setError("The format is refused: see the rule it names.");
      } else {
        setError(graphqlErrorMessage(err, "Could not save the format"));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open title="Webhook format" onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-5">
        <datalist id={pathsListId}>
          {paths.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <p className="text-sm text-rim-text-muted">
          Rules say when a delivery posts and what. The first rule that holds decides. Anyone with
          the URL can post to that channel as the bot, so a rule chooses what to post, and keeps
          nobody out.
        </p>
        {followsGithub && (
          <p className="rounded-lg border border-rim-warm/30 bg-rim-warm/5 px-3 py-2 text-sm text-rim-warm">
            This webhook follows RIM's GitHub format. Saving makes it a copy of its own, which then
            stops getting RIM's updates to that format.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className={LABEL_CLASS}>Start from</span>
            <select
              value={startFrom}
              onChange={(e) => setStartFrom(e.currentTarget.value)}
              className="w-full rounded-lg border border-rim-line bg-rim-void px-2.5 py-2 text-sm text-rim-text outline-none focus:border-rim-accent/40"
            >
              <option value="">Blank</option>
              {formats.data?.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" size="sm" variant="secondary" onClick={useStart}>
            {hasWrittenRules ? "Replace the rules with this" : "Start from this"}
          </Button>
        </div>

        <section className="space-y-3" aria-label="Rules">
          {rules.length === 0 && (
            <p className="text-sm text-rim-text-muted">No rules: nothing would ever post.</p>
          )}
          <ol className="space-y-3">
            {rules.map((rule, at) => (
              <RuleCard
                key={rule.key}
                rule={rule}
                number={at + 1}
                count={rules.length}
                pathsListId={pathsListId}
                refusal={refusals.byRule[at + 1]}
                onChange={(changed) =>
                  changeRules(rules.map((r) => (r.key === rule.key ? changed : r)))
                }
                onMove={(by) => {
                  const next = [...rules];
                  const [moved] = next.splice(at, 1);
                  next.splice(at + by, 0, moved);
                  changeRules(next);
                }}
                onRemove={() => changeRules(rules.filter((r) => r.key !== rule.key))}
              />
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={rules.length >= 20}
              onClick={() => changeRules([...rules, blankRule()])}
            >
              Add rule
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void copyJson()}>
              {copied ? "Copied" : "Copy as JSON"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={pasting}
              onClick={() => setPasting((open) => !open)}
            >
              Paste JSON
            </Button>
          </div>
          {pasting && (
            <div className="space-y-2">
              <label className="block">
                <span className={LABEL_CLASS}>A format's JSON</span>
                <textarea
                  value={pasted}
                  rows={6}
                  onChange={(e) => setPasted(e.currentTarget.value)}
                  className={AREA_CLASS}
                />
              </label>
              {pasteError && (
                <p role="alert" className="text-sm text-rim-danger">
                  {pasteError}
                </p>
              )}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!pasted.trim()}
                onClick={usePasted}
              >
                Replace the rules with this JSON
              </Button>
            </div>
          )}
          {refusals.whole && (
            <p role="alert" className="text-sm text-rim-danger">
              {refusals.whole}
            </p>
          )}
        </section>

        <section className="space-y-3" aria-labelledby={`${pathsListId}-try`}>
          <h4 id={`${pathsListId}-try`} className="text-sm font-semibold text-rim-text">
            Try it
          </h4>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <label className="block min-w-0">
              <span className={LABEL_CLASS}>Headers, one Name: value a line</span>
              <textarea
                value={headers}
                rows={4}
                placeholder="X-GitHub-Event: pull_request"
                onChange={(e) => setHeaders(e.currentTarget.value)}
                className={AREA_CLASS}
              />
            </label>
            <label className="block min-w-0">
              <span className={LABEL_CLASS}>Body</span>
              <textarea
                value={body}
                rows={4}
                placeholder='{"action": "opened"}'
                onChange={(e) => setBody(e.currentTarget.value)}
                className={AREA_CLASS}
              />
            </label>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            isLoading={trying}
            onClick={() => void tryIt()}
          >
            Try
          </Button>
          <div aria-live="polite">{tried && <PreviewOutcome preview={tried} />}</div>
        </section>

        {withLog && (
          <DeliveryLog
            serverId={serverId}
            webhookId={editing?.id}
            format={format}
            onSession={target.kind === "new" ? setSession : undefined}
            onUseSample={(h, b) => {
              setHeaders(headersToLines(h));
              setBody(b);
              setTried(null);
            }}
          />
        )}

        <BuildWithAi
          serverId={serverId}
          sample={{ headers, body }}
          hasRules={hasWrittenRules}
          onDraft={changeRules}
        />

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {target.kind === "edit" && (
            <p className="mr-auto text-xs text-rim-text-muted">The URL stays the same.</p>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" isLoading={saving} onClick={() => void save()}>
            {target.kind === "edit" ? "Save format" : "Create webhook"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
