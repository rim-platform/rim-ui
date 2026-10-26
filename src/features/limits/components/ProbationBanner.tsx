import { Clock } from "lucide-react";

import { useProbationEnd } from "../api/useProbation";
import { probationText } from "../limits";

/** Across the top of the app while the account is on probation; gone once it ends. */
export function ProbationBanner() {
  const endsAt = useProbationEnd();
  if (!endsAt) return null;
  return (
    <div
      role="status"
      data-testid="probation-banner"
      className="flex items-center justify-center gap-2 bg-rim-accent/10 px-3 py-1.5 text-xs text-rim-text-muted"
    >
      <Clock className="h-3.5 w-3.5 shrink-0" />
      {probationText(
        "create workspaces, message strangers or set a profile picture, bio or status",
        endsAt,
      )}
    </div>
  );
}
