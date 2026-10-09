import { Lock } from "lucide-react";

import { cn } from "../../../shared/ui/cn";

/** The small lock beside an end-to-end encrypted message or conversation. */
export function LockMark({
  className,
  label = "End-to-end encrypted",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      title={label}
      aria-label={label}
      className={cn("inline-flex text-rim-text-faint", className)}
    >
      <Lock className="h-3 w-3" aria-hidden />
    </span>
  );
}
