import { cn } from "../../../shared/ui/cn";
import type { TrustLevel } from "../types";

const trustStyles: Record<TrustLevel, string> = {
  official: "bg-rim-accent/15 text-rim-accent",
  verified: "bg-rim-warm/15 text-rim-warm",
  community: "bg-white/10 text-rim-text-muted",
  unverified: "bg-rim-danger/15 text-rim-danger",
};

const trustLabels: Record<TrustLevel, string> = {
  official: "Official",
  verified: "Verified",
  community: "Community",
  unverified: "Unverified",
};

export function TrustBadge({ level }: { level: TrustLevel }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        trustStyles[level],
      )}
    >
      {trustLabels[level]}
    </span>
  );
}
