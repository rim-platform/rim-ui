import { useEffect, useRef, useState } from "react";

import { graphqlErrorCode, graphqlErrorMessage } from "../../../core/graphql/errors";
import {
  WebhookPreviewOutcome,
  WebhookTestBodyState,
  type WebhookFormatPreview,
  type WebhookTestDelivery,
} from "../../../core/graphql/generated/schema-types";
import { Button } from "../../../shared/ui/Button";
import { MarkdownRenderer } from "../../../shared/ui/MarkdownRenderer";
import { formatTime } from "../../../shared/utils/formatTime";
import { showInvisibleCharacters } from "../../agents/runtime/invisibleCharacters";
import {
  endWebhookTestSession,
  previewWebhookFormat,
  startWebhookTestSession,
  webhookTestDeliveries,
} from "../api/webhookFormatsApi";
import { eventOf, isFormEncoded, readableBody } from "../formats/sample";
import { webhookUrl } from "../webhookUrl";
import { outcomeLabel, previewMessage } from "../formats/outcome";

/** How often an open session is read, in milliseconds. */
export const POLL_MS = 2000;
/** How long the draft must stay still before every row is worked out again, in milliseconds. */
export const OUTCOME_DEBOUNCE_MS = 600;
/** The most deliveries shown, newest first; a session holds no more. */
const MAX_ROWS = 20;

/** The test session open in a log: its id, and for a new webhook the URL it answers on. */
export interface OpenSession {
  id: string;
  /** The test URL of an unbound session; `null` while a bound one listens on its webhook. */
  url: string | null;
}

interface DeliveryLogProps {
  serverId: string;
  /** The webhook to listen on; none while a new webhook is made, which gets a test URL. */
  webhookId?: string;
  /** The format on screen, as JSON: every row's outcome is worked out under it. */
  format: unknown;
  /** Called with the open unbound session, or `null`, so saving can keep its URL. */
  onSession?: (session: OpenSession | null) => void;
  /** Fills Try it with a delivery. */
  onUseSample: (headers: { name: string; value: string }[], body: string) => void;
}

/** The outcome of a row under the draft, or why it has none. */
function rowOutcome(delivery: WebhookTestDelivery, preview: WebhookFormatPreview | undefined) {
  if (delivery.bodyState === WebhookTestBodyState.TOO_LARGE) return "Too large to keep";
  if (delivery.bodyState === WebhookTestBodyState.NOT_TEXT) return "Not text";
  return preview ? outcomeLabel(preview) : "…";
}

/**
 * What a service sends, shown as it arrives: for a new webhook on a test URL that posts nothing,
 * for an existing one beside its real posts. Each row says what it would come to under the
 * format on screen, worked out again when the format changes. The session ends when this
 * closes.
 */
export function DeliveryLog({
  serverId,
  webhookId,
  format,
  onSession,
  onUseSample,
}: DeliveryLogProps) {
  const [session, setSession] = useState<OpenSession | null>(null);
  const [ended, setEnded] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WebhookTestDelivery[]>([]);
  const [outcomes, setOutcomes] = useState<Record<number, WebhookFormatPreview>>({});
  const [announced, setAnnounced] = useState("");
  const [copied, setCopied] = useState(false);
  const lastId = useRef(0);
  const sessionRef = useRef<OpenSession | null>(null);
  const onSessionRef = useRef(onSession);
  useEffect(() => {
    onSessionRef.current = onSession;
  }, [onSession]);

  // The session ends when the log closes, and the URL with it unless saving kept it.
  useEffect(
    () => () => {
      const open = sessionRef.current;
      if (open) void endWebhookTestSession(serverId, open.id).catch(() => undefined);
    },
    [serverId],
  );

  useEffect(() => {
    if (!session) return;
    let live = true;
    const read = async () => {
      try {
        const page = await webhookTestDeliveries(serverId, session.id, lastId.current);
        if (!live || page.deliveries.length === 0) return;
        lastId.current = page.deliveries[page.deliveries.length - 1].id;
        const fresh = [...page.deliveries].reverse();
        setRows((held) => [...fresh, ...held].slice(0, MAX_ROWS));
        setAnnounced(
          page.deliveries.length === 1
            ? "1 new delivery"
            : `${page.deliveries.length} new deliveries`,
        );
      } catch (err) {
        if (!live) return;
        if (graphqlErrorCode(err) === "NOT_FOUND") {
          sessionRef.current = null;
          setSession(null);
          setEnded(true);
          onSessionRef.current?.(null);
        }
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [session, serverId]);

  const formatKey = JSON.stringify(format);
  useEffect(() => {
    const texts = rows.filter((r) => r.bodyState === WebhookTestBodyState.TEXT);
    if (texts.length === 0) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void Promise.all(
        texts.map(async (r) => {
          try {
            const preview = await previewWebhookFormat(
              serverId,
              JSON.parse(formatKey) as unknown,
              r.headers.map((h) => ({ name: h.name, value: h.value })),
              r.body ?? "",
            );
            return [r.id, preview] as const;
          } catch {
            return null;
          }
        }),
      ).then((done) => {
        if (!live) return;
        const next: Record<number, WebhookFormatPreview> = {};
        for (const entry of done) if (entry) next[entry[0]] = entry[1];
        setOutcomes(next);
      });
    }, OUTCOME_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [rows, formatKey, serverId]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const started = await startWebhookTestSession(serverId, webhookId);
      const url = started.token ? await webhookUrl(started.token) : null;
      const open = { id: started.id, url };
      lastId.current = 0;
      setRows([]);
      setOutcomes({});
      setEnded(false);
      sessionRef.current = open;
      setSession(open);
      onSessionRef.current?.(url ? open : null);
    } catch (err) {
      setError(graphqlErrorMessage(err, "Could not start listening"));
    } finally {
      setStarting(false);
    }
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="space-y-3" aria-labelledby="delivery-log-heading">
      <h4 id="delivery-log-heading" className="text-sm font-semibold text-rim-text">
        What arrives
      </h4>
      <p className="text-xs text-rim-text-muted">
        What arrives is held in memory for up to an hour, and only you can see it.
      </p>
      {!session && (
        <div className="space-y-2">
          {ended && (
            <p className="text-sm text-rim-text">
              {webhookId
                ? "Listening has ended."
                : "This test URL has ended. Starting again gives a new URL."}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            isLoading={starting}
            onClick={() => void start()}
          >
            {webhookId
              ? ended
                ? "Listen again"
                : "Listen"
              : ended
                ? "Start a new test URL"
                : "Start test URL"}
          </Button>
        </div>
      )}
      {session?.url && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-rim-line bg-rim-void px-2.5 py-2 text-xs text-rim-text">
              {session.url}
            </code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void copyUrl(session.url!)}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-rim-text-muted">
            Nothing posts to the channel yet. When you save, this URL starts posting, so you won't
            need to change it in the service.
          </p>
        </div>
      )}
      {session && !session.url && (
        <p className="text-xs text-rim-text-muted">
          Listening. Deliveries keep posting under the saved format while you listen.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rim-danger">
          {error}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {announced}
      </p>
      {session && rows.length === 0 && (
        <p className="text-sm text-rim-text-muted">Nothing has arrived yet.</p>
      )}
      {rows.length > 0 && (
        <ul className="space-y-2" aria-label="Deliveries, newest first">
          {rows.map((r) => {
            const preview = outcomes[r.id];
            const event = eventOf(r.headers);
            return (
              <li key={r.id} className="rounded-lg border border-rim-line bg-rim-panel">
                <details>
                  <summary className="cursor-pointer px-3 py-2 text-sm text-rim-text">
                    {formatTime(r.receivedAt)}
                    {event ? ` · ${showInvisibleCharacters(event)}` : ""} · {rowOutcome(r, preview)}
                  </summary>
                  <div className="space-y-2 border-t border-rim-line px-3 py-2 text-xs">
                    <p className="text-rim-text-muted">
                      Content-Type:{" "}
                      {r.contentType ? showInvisibleCharacters(r.contentType) : "none"}
                    </p>
                    {isFormEncoded(r.contentType) && (
                      <p className="text-rim-warm">
                        This is form-encoded. In the service's settings, choose{" "}
                        <code>application/json</code>.
                      </p>
                    )}
                    {r.headers.length > 0 && (
                      <ul className="space-y-0.5 text-rim-text-muted" aria-label="Headers">
                        {r.headers.map((h) => (
                          <li key={h.name} className="break-all font-mono">
                            {showInvisibleCharacters(h.name)}: {showInvisibleCharacters(h.value)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.bodyState === WebhookTestBodyState.TEXT ? (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-rim-line bg-rim-void p-2 font-mono text-rim-text">
                        {showInvisibleCharacters(readableBody(r.body ?? ""))}
                      </pre>
                    ) : (
                      <p className="text-rim-text-muted">
                        {r.bodyState === WebhookTestBodyState.TOO_LARGE
                          ? "The body was over 256 KiB, so it wasn't kept."
                          : "The body isn't text, so it wasn't kept."}
                      </p>
                    )}
                    {preview?.outcome === WebhookPreviewOutcome.POSTS && (
                      <div className="space-y-1">
                        <p className="text-rim-text">Rule {preview.rule} decides. It would post:</p>
                        <div className="rounded border border-rim-line bg-rim-void px-2 py-1.5">
                          <MarkdownRenderer content={previewMessage(preview)} />
                        </div>
                      </div>
                    )}
                    {r.bodyState === WebhookTestBodyState.TEXT && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          onUseSample(
                            r.headers.map((h) => ({ name: h.name, value: h.value })),
                            r.body ?? "",
                          )
                        }
                      >
                        Use as sample
                      </Button>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
