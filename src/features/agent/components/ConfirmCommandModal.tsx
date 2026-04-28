import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, ShieldAlert, X } from "lucide-react";

import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
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
import {
  deriveConfirmationVerb,
  verbMatches,
} from "./ConfirmCommandModal/verbDeriver";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ARG_DISPLAY_LIMIT = 10;
const ARG_VALUE_TRUNCATE_AT = 200;

interface SeverityVisuals {
  borderAccent: string;
  chipBg: string;
  chipText: string;
  confirmBg: string;
  confirmHover: string;
  confirmLabel: string;
  srLabel: string;
  /** Block accidental dismiss (backdrop click) at MUTATING and above. */
  disableBackdropClose: boolean;
  /** Always require type-to-confirm at the wire. */
  requireTypeToConfirm: boolean;
}

function severityVisuals(
  sev: CommandSensitivity | undefined,
): SeverityVisuals {
  switch (sev) {
    case CommandSensitivity.RESTRICTED:
      return {
        borderAccent: "border-l-rim-danger",
        chipBg: "bg-rim-danger/20",
        chipText: "text-rim-danger",
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
        chipBg: "bg-rim-warm/20",
        chipText: "text-rim-warm",
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
        chipBg: "bg-rim-accent/20",
        chipText: "text-rim-accent",
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
        chipBg: "bg-rim-success/20",
        chipText: "text-rim-success",
        confirmBg: "bg-rim-accent",
        confirmHover: "hover:bg-rim-accent/90",
        confirmLabel: "Confirm",
        srLabel: "Safe action",
        disableBackdropClose: false,
        requireTypeToConfirm: false,
      };
  }
}

function severityWireLabel(sev: CommandSensitivity | undefined): string {
  return (sev ?? CommandSensitivity.SAFE).toString();
}

interface ContainerProps {
  request: ConfirmationRequest;
  onApprove: () => void;
  onReject: () => void;
}

export function ConfirmCommandModal() {
  const request = useConfirmationModalStore((s) => s.request);
  const approve = useConfirmationModalStore((s) => s.approve);
  const reject = useConfirmationModalStore((s) => s.reject);

  if (!request) return null;
  return (
    <ConfirmCommandModalContent
      request={request}
      onApprove={approve}
      onReject={reject}
    />
  );
}

function ConfirmCommandModalContent({
  request,
  onApprove,
  onReject,
}: ContainerProps) {
  const currentConversationId = useShellStore(
    (s) => s.selectedConversationId,
  );

  const visuals = useMemo(
    () => severityVisuals(request.sensitivity),
    [request.sensitivity],
  );
  const sameTurn = !!request.sameTurnAfterToolResult;
  // Tier-4 trigger per §4.8: RESTRICTED, OR same-turn-after-tool-result +
  // sensitivity ≥ MUTATING.
  const requireType =
    visuals.requireTypeToConfirm ||
    (sameTurn && request.sensitivity === CommandSensitivity.MUTATING);

  const expectedVerb = useMemo(
    () => deriveConfirmationVerb(request.commandId),
    [request.commandId],
  );

  const crossChannel = useMemo(
    () => detectCrossChannel(request.args, currentConversationId),
    [request.args, currentConversationId],
  );

  const maskedArgs = useMemo(
    () => maskForDisplay(request.args),
    [request.args],
  );

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

  // Initial focus → Cancel button (spec §6.1, §5.2). Defer one frame so
  // the panel is in the DOM.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      cancelButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // STALE handler: auto-close + reject when expiresAt passes while the
  // modal is open. Per §5.6 a stale modal must not silently extend.
  useEffect(() => {
    const expiry = Date.parse(request.expiresAt);
    if (!Number.isFinite(expiry)) return;
    const ms = expiry - Date.now();
    if (ms <= 0) {
      onReject();
      return;
    }
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
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTOR,
      );
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

  const sensitivityLabel = severityWireLabel(request.sensitivity);
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
          className={cn(
            "w-full max-w-lg rounded-xl border border-rim-line border-l-4 bg-rim-panel",
            visuals.borderAccent,
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
              <h2
                id={titleId}
                className="text-xl font-medium text-rim-text"
              >
                {titlePrefix(request)} <span className="text-rim-accent">{request.toolName}</span>
              </h2>
              {request.nlDescription && (
                <p className="mt-1 line-clamp-2 text-sm text-rim-text-muted">
                  {request.nlDescription}
                </p>
              )}
            </div>

            {/* Hidden SR description, read in order per §6.2 */}
            <span id={descId} className="sr-only">
              {visuals.srLabel}. Initiated by AI agent.
              {crossChannel
                ? ` Destination differs from active conversation; will post in conversation ${crossChannel.targetId.slice(0, 8)}.`
                : ""}
              {sameTurn
                ? " This action was suggested while the agent was reading external content."
                : ""}
              {requireType
                ? ` Type the word ${expectedVerb} to confirm.`
                : ""}
            </span>

            {/* Chips row */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  visuals.chipBg,
                  visuals.chipText,
                )}
                data-testid="sensitivity-chip"
              >
                {sensitivityLabel}
              </span>
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

            {/* Cross-channel warning chip (§4.5).
              * Phase 4 renders the raw conversation id (first 8 chars). The
              * spec's full hover card (channel name, topic, member count) +
              * hyperlink is a Phase 5+ follow-up that needs the channel
              * metadata layer. Deliberate: H2 mitigation here is "did the
              * destination differ, yes/no" — name resolution is nice-to-have,
              * not load-bearing for the security property. */}
            {crossChannel && (
              <div
                className="flex items-start gap-2 rounded border border-rim-warm/40 bg-rim-warm/10 px-3 py-2 text-xs text-rim-warm"
                data-testid="cross-channel-chip"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <div className="font-medium">
                    Destination differs from active conversation
                  </div>
                  <div className="text-rim-text-muted">
                    Will post in conversation {crossChannel.targetId.slice(0, 8)}…
                  </div>
                </div>
              </div>
            )}

            {/* Tool-result-origin warning banner (§4.6) */}
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

            {/* Arguments block (§4.7) */}
            <ArgsBlock args={maskedArgs} />

            {/* Tier-4 input (§4.8) */}
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
                  // Bare Enter inside this input is a no-op (per §6.3).
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !(e.metaKey || e.ctrlKey)
                    ) {
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
                visuals.confirmBg,
                visuals.confirmHover,
                !confirmEnabled && "cursor-not-allowed opacity-50",
              )}
              data-testid="confirm-button"
            >
              {submitting ? (
                <span>Executing…</span>
              ) : (
                <>
                  <span>{visuals.confirmLabel}</span>
                  <span className="text-rim-void/70">⌘↵</span>
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
 * Per-install hashed `[RIM]` system badge (Skill Macros §3.5.1).
 *
 * Phase 4 placeholder: we render a static label with a tooltip explaining
 * provenance. The real per-install hash glyph wiring lands in Phase 5+
 * alongside the install-id infrastructure. The component lives in this
 * file as a private subcomponent so any future move to a shared
 * `<RimSystemBadge />` is a single grep.
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

function titlePrefix(request: ConfirmationRequest): string {
  // Phase 4 only ever opens this modal from the AGENT initiator (the gate
  // is wired into the agent runtime). Keep the prefix table for when
  // human-initiated dispatchers route through here too (Phase 5+).
  void request;
  return "Agent wants to:";
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
        <div className="text-xs italic text-rim-text-faint">
          (no arguments)
        </div>
      ) : (
        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1">
          {visible.map(([k, v]) => {
            const formatted = formatArgValue(v);
            const truncated =
              formatted.length > ARG_VALUE_TRUNCATE_AT
                ? formatted.slice(0, ARG_VALUE_TRUNCATE_AT) + "…"
                : formatted;
            const isRedacted = formatted === REDACTED_PLACEHOLDER;
            return (
              <ArgRow key={k} keyName={k} display={truncated} redacted={isRedacted} />
            );
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
      <dt className="break-words font-mono text-xs text-rim-text-muted">
        {keyName}
      </dt>
      <dd
        className="break-words font-mono text-xs text-rim-text"
        aria-label={redacted ? "redacted" : undefined}
      >
        {display}
      </dd>
    </>
  );
}
