import { cn } from "../../../../shared/ui/cn";
import type { AgentSessionStatus } from "../../acp/agentSession";
import { STATUS_LABELS } from "./sessionText";

const STATUS_CLASSES: Record<AgentSessionStatus, string> = {
  starting: "border-rim-line text-rim-text-muted",
  ready: "border-rim-success/30 text-rim-success",
  working: "border-rim-accent/30 text-rim-accent",
  waiting: "border-rim-warm/30 text-rim-warm",
  ended: "border-rim-line text-rim-text-faint",
  failed: "border-rim-danger/30 text-rim-danger",
};

/** A session's status as a small chip. */
export function SessionStatusChip({ status }: { status: AgentSessionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 text-xs",
        STATUS_CLASSES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
