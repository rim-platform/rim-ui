import { Clock, CloudOff, Timer } from "lucide-react";

import { timedOutMessage } from "../../../core/graphql/errors";
import { formatSlowModeInterval } from "../../conversations/api/useSlowMode";
import { cn } from "../../../shared/ui/cn";
import { useCountdown } from "../hooks/useCountdown";

/** Above the composer while the viewer is timed out; the composer is disabled meanwhile. */
export function TimedOutBanner({ until }: { until: string }) {
  return (
    <div
      role="status"
      data-testid="timed-out-banner"
      className="mb-2 flex items-center gap-2 rounded-lg border border-rim-warm/40 bg-rim-warm/10 px-3 py-2 text-sm text-rim-warm"
    >
      <Clock className="h-4 w-4 shrink-0" />
      <span>{timedOutMessage(until)}</span>
    </div>
  );
}

/** Above the composer while the app runs offline; typing works, sending waits for the server. */
export function OfflineComposerNotice() {
  return (
    <div
      role="status"
      data-testid="offline-composer-notice"
      className="mb-2 flex items-center gap-2 rounded-lg border border-rim-warm/40 bg-rim-warm/10 px-3 py-2 text-sm text-rim-warm"
    >
      <CloudOff className="h-4 w-4 shrink-0" />
      <span>You are offline. You can send again once the server is back.</span>
    </div>
  );
}

/**
 * A small slow-mode line near the composer: the interval, a countdown after the viewer sends
 * (counted locally; the server is the authority) or the exemption for Owner/Moderator.
 */
export function SlowModeIndicator({
  seconds,
  blockedUntil,
  exempt,
}: {
  seconds: number;
  blockedUntil: number | undefined;
  exempt: boolean;
}) {
  const remaining = useCountdown(exempt ? undefined : blockedUntil);
  if (seconds <= 0) return null;

  const interval = formatSlowModeInterval(seconds);
  let text = `Slow mode: ${interval}`;
  if (exempt) text = `Slow mode: ${interval} (you are exempt)`;
  else if (remaining > 0) text = `Slow mode: wait ${remaining} s`;

  return (
    <p
      data-testid="slow-mode-indicator"
      aria-live="polite"
      className="mb-1 flex items-center gap-1 text-[11px] text-rim-text-faint"
    >
      <Timer className="h-3 w-3" />
      {text}
    </p>
  );
}

/** The share of the byte cap from which the composer shows the counter. */
const NEAR_CAP = 0.9;

/**
 * The message's length in UTF-8 bytes against the instance's cap, shown once it nears the cap;
 * over it, the message is refused before it is sent.
 */
export function MessageBytesCounter({ bytes, cap }: { bytes: number; cap: number | null }) {
  if (cap === null || bytes < cap * NEAR_CAP) return null;
  const over = bytes > cap;
  return (
    <p
      data-testid="message-bytes-counter"
      aria-live="polite"
      className={cn(
        "mt-1 self-end text-[11px] tabular-nums",
        over ? "text-rim-danger" : "text-rim-text-faint",
      )}
    >
      {over ? `${bytes} of ${cap} bytes: too long to send` : `${bytes} of ${cap} bytes`}
    </p>
  );
}
