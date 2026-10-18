import { MailQuestionMark } from "lucide-react";

import { useShellStore } from "../../../shell/state/useShellStore";
import { cn } from "../../../shared/ui/cn";
import { useNotificationsPanelStore } from "../../notifications/state/useNotificationsPanelStore";

interface DmRequestsRowProps {
  /** The workspace whose requests the row opens; `null` for those from outside every workspace. */
  workspaceId: string | null;
  count: number;
}

/** "Requests (n)" at the top of a sidebar's conversations; opens them in the main area. */
export function DmRequestsRow({ workspaceId, count }: DmRequestsRowProps) {
  const active = useShellStore(
    (s) => s.mainSurface.kind === "dm-requests" && s.mainSurface.workspaceId === workspaceId,
  );
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => {
        useNotificationsPanelStore.getState().setOpen(false);
        useShellStore.getState().setMainSurface({ kind: "dm-requests", workspaceId });
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition",
        active
          ? "bg-rim-accent/15 text-rim-accent"
          : "text-rim-text-muted hover:bg-white/5 hover:text-rim-text",
      )}
    >
      <MailQuestionMark className="h-4 w-4 shrink-0" />
      <span className="flex-1">Requests ({count})</span>
    </button>
  );
}
