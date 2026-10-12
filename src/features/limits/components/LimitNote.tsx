import { cn } from "../../../shared/ui/cn";
import type { LimitView } from "../limits";

/** A cap next to where people create things: the count, and the reason once it is reached. */
export function LimitNote({ limit, className }: { limit: LimitView | null; className?: string }) {
  if (!limit) return null;
  return (
    <p
      data-testid="limit-note"
      className={cn("text-xs", limit.full ? "text-rim-warm" : "text-rim-text-muted", className)}
    >
      {limit.full ? `${limit.text}. ${limit.reason}` : limit.text}
    </p>
  );
}
