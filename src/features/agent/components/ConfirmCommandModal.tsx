import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ShieldAlert, X } from "lucide-react";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { confirmShortcutLabel } from "../../../core/runtime/runtime";
import { cn } from "../../../shared/ui/cn";
import { Z } from "../../../shared/ui/zIndex";
import { useShellStore } from "../../../shell/state/useShellStore";
import {
  useConfirmationModalStore,
  type ConfirmationRequest,
} from "../state/confirmationModalStore";
import {
  formatArgValue,
  maskForDisplay,
  REDACTED_PLACEHOLDER,
} from "./ConfirmCommandModal/argsMasker";
import { detectCrossChannel } from "./ConfirmCommandModal/crossChannelDetector";
import { deriveConfirmationVerb, verbMatches } from "./ConfirmCommandModal/verbDeriver";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ARG_DISPLAY_LIMIT = 10;
const ARG_VALUE_TRUNCATE_AT = 200;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

interface SeverityVisuals {
  borderAccent: string;
  confirmBg: string;
  confirmHover: string;
  confirmLabel: string;
  srLabel: string;
  /** Block accidental dismiss (backdrop click) at MUTATING and above. */
  disableBackdropClose: boolean;
  /** Always require type-to-confirm at this sensitivity. */
  requireTypeToConfirm: boolean;
}

function severityVisuals(sev: CommandSensitivity | undefined): SeverityVisuals {
  switch (sev) {
    case CommandSensitivity.RESTRICTED:
      return {
        borderAccent: "border-l-rim-danger",
        confirmBg: "bg-rim-danger",
        confirmHover: "hover:bg-rim-danger/90",
        confirmLabel: "I understand — execute",
        srLabel: "Restricted action",
        disableBackdropClose: true,
        requireTypeToConfirm: true,
      };
    case CommandSensitivity.MUTATING:
      return {
        borderAccent: "border-l-rim-warm",
        confirmBg: "bg-rim-warm",
        confirmHover: "hover:bg-rim-warm/90",
        confirmLabel: "Run anyway",
        srLabel: "Mutating action",
        disableBackdropClose: true,
        requireTypeToConfirm: false,
      };
    case CommandSensitivity.SENSITIVE:
      return {
        borderAccent: "border-l-rim-accent",
        confirmBg: "bg-rim-accent",
        confirmHover: "hover:bg-rim-accent/90",
        confirmLabel: "Confirm",
        srLabel: "Sensitive action",
        disableBackdropClose: false,
        requireTypeToConfirm: false,
      };
    case CommandSensitivity.SAFE:
    default:
      return {
        borderAccent: "border-l-rim-success",
        confirmBg: "bg-rim-accent",
        confirmHover: "hover:bg-rim-accent/90",
        confirmLabel: "Confirm",
        srLabel: "Safe action",
        disableBackdropClose: false,
        requireTypeToConfirm: false,
      };
  }
}

interface ContainerProps {
  request: ConfirmationRequest;
  onApprove: () => void;
  onReject: () => void;
}

/**
 * Confirmation dialog for a command the server holds with `CONFIRMATION_REQUIRED`, whether
 * the AI agent or the user started it. A `RESTRICTED` command needs its verb typed first.
 */
export function ConfirmCommandModal() {
  const request = useConfirmationModalStore((s) => s.request);
  const approve = useConfirmationModalStore((s) => s.approve);
  const reject = useConfirmationModalStore((s) => s.reject);

  if (!request) return null;
  return <ConfirmCommandModalContent request={request} onApprove={approve} onReject={reject} />;
}

function ConfirmCommandModalContent({ request, onApprove, onReject }: ContainerProps) {
  const currentConversationId = useShellStore((s) => s.selectedConversationId);

  const byUser = request.initiator === "user";
  // The server holds a user's command only when it is dangerous or stricter, so an unknown
  // sensitivity is shown as MUTATING.
  const sensitivity = request.sensitivity ?? (byUser ? CommandSensitivity.MUTATING : undefined);
  const visuals = useMemo(() => severityVisuals(sensitivity), [sensitivity]);
  const sameTurn = !!request.sameTurnAfterToolResult;
  // Type-to-confirm applies to RESTRICTED, and to MUTATING when the challenge
  // came in the same turn as a tool result; a `null` verb turns it off.
  const requireType =
    request.verb !== null &&
    (visuals.requireTypeToConfirm || (sameTurn && sensitivity === CommandSensitivity.MUTATING));

  const expectedVerb = useMemo(
    () => request.verb ?? deriveConfirmationVerb(request.commandId),
    [request.verb, request.commandId],
  );

  const crossChannel = useMemo(
    () => detectCrossChannel(request.args, currentConversationId),
    [request.args, currentConversationId],
  );

  const maskedArgs = useMemo(() => maskForDisplay(request.args), [request.args]);

  const [typedVerb, setTypedVerb] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const verbOk = !requireType || verbMatches(typedVerb, expectedVerb);
  const confirmEnabled = !submitting && verbOk;

  // Refs for focus management.
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const requestIdRef = useRef(request.token);

  // Reset typed verb if the request changes (token is the natural key).
  useEffect(() => {
    if (requestIdRef.current !== request.token) {
      setTypedVerb("");
      setSubmitting(false);
      requestIdRef.current = request.token;
    }
  }, [request.token]);

  // Body scroll lock + focus restoration on unmount. Mirrors Dialog.
  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      const prev = previousFocusRef.current as HTMLElement | null;
      if (prev && typeof prev.focus === "function") prev.focus();
      previousFocusRef.current = null;
    };
  }, []);

  // Initial focus → the header's close button, which cancels. Defer one
  // frame so the panel is in the DOM.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      cancelButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Expiry handler: auto-close + reject when expiresAt passes while the
  // modal is open, so a stale modal never silently extends the window.
  useEffect(() => {
    const expiry = Date.parse(request.expiresAt);
    if (!Number.isFinite(expiry)) return;
    const ms = expiry - Date.now();
    if (ms <= 0) {
      onReject();
      return;
    }
    // A delay past the timer's 32-bit limit would fire at once.
    if (ms > MAX_TIMER_DELAY_MS) return;
    const t = setTimeout(() => onReject(), ms);
    return () => clearTimeout(t);
  }, [request.expiresAt, onReject]);

  // Document-level Esc handler (always cancels). Document-level so it works
  // even if focus has escaped the panel for any reason.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onReject();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onReject]);

  function handleConfirm() {
    if (!confirmEnabled) return;
    setSubmitting(true);
    onApprove();
  }

  // Keydown handler on the panel: focus trap + ⌘↵ / Ctrl+↵ submit.
  function onPanelKeyDown(e: React.KeyboardEvent) {
    if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) === true) {
      e.preventDefault();
      handleConfirm();
      return;
    }
    if (e.key === "Tab" && panelRef.current) {
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // A dangerous command without a consequence line of its own is said to be dangerous.
  const subtitle =
    request.description ??
    (request.dangerous ? "This is a dangerous command." : request.nlDescription);
  const titleId = `confirm-cmd-title-${request.token}`;
  const descId = `confirm-cmd-desc-${request.token}`;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50"
        style={{ zIndex: Z.OVERLAY_BACKDROP }}
        onClick={visuals.disableBackdropClose ? undefined : onReject}
        data-testid="confirm-cmd-backdrop"
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex: Z.OVERLAY_CONTENT }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          onKeyDown={onPanelKeyDown}
          data-dangerous={request.dangerous ? "true" : undefined}
          className={cn(
            "w-full max-w-lg rounded-xl border border-rim-line border-l-4 bg-rim-panel",
            request.dangerous ? "border-l-rim-danger" : visuals.borderAccent,
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-rim-line px-6 py-3">
            <div className="flex items-center gap-2">
              <RimSystemBadge />
              <span className="text-[10px] font-medium uppercase tracking-wide text-rim-text-muted">
                Confirm command
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded border border-rim-line px-1.5 py-0.5 text-[10px] uppercase text-rim-text-faint">
                Esc
              </span>
              <button
                ref={cancelButtonRef}
                type="button"
                aria-label="Close"
                onClick={onReject}
                className="rounded p-1 text-rim-text-muted transition hover:text-rim-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="space-y-4 px-6 py-5">
            {/* Title + subtitle */}
            <div>
              <h2 id={titleId} className="text-xl font-medium text-rim-text">
                {byUser ? "Confirm:" : "Agent wants to:"}{" "}
                <span className="text-rim-accent">{request.toolName}</span>
              </h2>
              {/* `description` is the human-facing consequence line, written
                  for humans and not clamp-prone the way `nlDescription` (model-facing, tuned for
                  the LLM) can be. `nlDescription` remains the fallback for
                  commands without a `description`. */}
              {subtitle && (
                <p className="mt-1 line-clamp-2 text-sm text-rim-text-muted">{subtitle}</p>
              )}
            </div>

            {/* Hidden screen-reader description: severity, initiator, destination,
                tool-result origin, then the word to type */}
            <span id={descId} className="sr-only">
              {request.dangerous ? "Dangerous command. " : ""}
              {visuals.srLabel}. {byUser ? "Initiated by you." : "Initiated by AI agent."}
              {crossChannel
                ? ` Destination differs from active conversation; will post in conversation ${crossChannel.targetId.slice(0, 8)}.`
                : ""}
              {sameTurn
                ? " This action was suggested while the agent was reading external content."
                : ""}
              {requireType ? ` Type the word ${expectedVerb} to confirm.` : ""}
            </span>

            {/* Chips row: who proposed the command, when the agent did */}
            {!byUser && (
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    "bg-rim-accent-strong/30 text-rim-accent-strong",
                  )}
                  data-testid="initiator-chip"
                >
                  <Bot className="h-3 w-3" /> AGENT
                </span>
              </div>
            )}

            {/* Cross-channel warning chip. Shows the first 8 chars of the raw
             * conversation id: it guards against a command reaching another
             * conversation than the one in view, so whether the destination
             * differs is what matters, not the channel's name. */}
            {crossChannel && (
              <div
                className="flex items-start gap-2 rounded border border-rim-warm/40 bg-rim-warm/10 px-3 py-2 text-xs text-rim-warm"
                data-testid="cross-channel-chip"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <div className="font-medium">Destination differs from active conversation</div>
                  <div className="text-rim-text-muted">
                    Will post in conversation {crossChannel.targetId.slice(0, 8)}…
                  </div>
                </div>
              </div>
            )}

            {/* Tool-result-origin warning banner */}
            {sameTurn && (
              <div
                className="flex items-start gap-2 rounded border border-rim-danger/40 bg-rim-danger/10 px-3 py-2 text-xs text-rim-danger"
                data-testid="tool-result-warning"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  This action was suggested while the agent was reading external content.{" "}
                  <strong>Verify it matches your intent.</strong>
                </div>
              </div>
            )}

            {/* Arguments block */}
            <ArgsBlock args={maskedArgs} />

            {/* Type-to-confirm input */}
            {requireType && (
              <div data-testid="type-to-confirm-block">
                <div className="my-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-rim-text-faint">
                  <span className="h-px flex-1 bg-rim-line" />
                  <span>Type &quot;{expectedVerb}&quot; to confirm</span>
                  <span className="h-px flex-1 bg-rim-line" />
                </div>
                <input
                  type="text"
                  value={typedVerb}
                  onChange={(e) => setTypedVerb(e.target.value)}
                  className={cn(
                    "w-full rounded border bg-rim-void px-3 py-2 font-mono text-sm text-rim-text focus:outline-none",
                    verbOk
                      ? "border-rim-success focus:border-rim-success"
                      : "border-rim-line focus:border-rim-accent",
                  )}
                  // Bare Enter inside this input is a no-op; ⌘/Ctrl+Enter confirms.
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                    }
                  }}
                  aria-label={`Type ${expectedVerb} to enable confirm`}
                  data-testid="verb-input"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-rim-line px-6 py-3">
            <button
              type="button"
              onClick={onReject}
              className="rounded border border-rim-line bg-rim-void px-4 py-2 text-xs text-rim-text-muted transition hover:text-rim-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              aria-disabled={!confirmEnabled}
              disabled={!confirmEnabled}
              className={cn(
                "inline-flex items-center gap-2 rounded px-4 py-2 text-xs font-medium text-rim-void transition",
                request.dangerous ? "bg-rim-danger hover:bg-rim-danger/90" : visuals.confirmBg,
                !request.dangerous && visuals.confirmHover,
                !confirmEnabled && "cursor-not-allowed opacity-50",
              )}
              data-testid="confirm-button"
            >
              {submitting ? (
                <span>Executing…</span>
              ) : (
                <>
                  <span>{visuals.confirmLabel}</span>
                  <span className="text-rim-void/70">{confirmShortcutLabel()}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Static `[RIM]` system badge marking the dialog as RIM's own, with a
 * tooltip explaining its provenance.
 */
function RimSystemBadge() {
  return (
    <span
      title="Verified RIM system dialog"
      className="rounded border border-rim-accent/40 bg-rim-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-rim-accent"
      data-testid="rim-system-badge"
    >
      RIM
    </span>
  );
}

function ArgsBlock({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args);
  const visible = entries.slice(0, ARG_DISPLAY_LIMIT);
  const overflow = entries.length - visible.length;

  return (
    <div data-testid="args-block">
      <div className="my-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-rim-text-faint">
        <span className="h-px flex-1 bg-rim-line" />
        <span>Arguments</span>
        <span className="h-px flex-1 bg-rim-line" />
      </div>
      {entries.length === 0 ? (
        <div className="text-xs italic text-rim-text-faint">(no arguments)</div>
      ) : (
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1">
          {visible.map(([k, v]) => {
            const formatted = formatArgValue(v);
            const truncated =
              formatted.length > ARG_VALUE_TRUNCATE_AT
                ? formatted.slice(0, ARG_VALUE_TRUNCATE_AT) + "…"
                : formatted;
            const isRedacted = formatted === REDACTED_PLACEHOLDER;
            return <ArgRow key={k} keyName={k} display={truncated} redacted={isRedacted} />;
          })}
          {overflow > 0 && (
            <>
              <dt className="font-mono text-xs text-rim-text-muted">…</dt>
              <dd className="font-mono text-xs text-rim-text-faint">
                +{overflow} more argument{overflow === 1 ? "" : "s"}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function ArgRow({
  keyName,
  display,
  redacted,
}: {
  keyName: string;
  display: string;
  redacted: boolean;
}) {
  return (
    <>
      <dt className="break-words font-mono text-xs text-rim-text-muted">{keyName}</dt>
      <dd
        className="break-words font-mono text-xs text-rim-text"
        aria-label={redacted ? "redacted" : undefined}
      >
        {display}
      </dd>
    </>
  );
}
