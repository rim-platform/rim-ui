import { Clock, Timer } from "lucide-react";

import { timedOutMessage } from "../../../core/graphql/errors";
import { formatSlowModeInterval } from "../../conversations/api/useSlowMode";
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
