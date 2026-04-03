import { usePresenceStore, type PresenceStatus } from "../state/usePresenceStore";
import { cn } from "../../../shared/ui/cn";

const statusColor: Record<PresenceStatus, string> = {
  ONLINE: "bg-emerald-400",
  AWAY: "bg-amber-400",
  OFFLINE: "bg-rim-text-faint/40",
};

const statusLabel: Record<PresenceStatus, string> = {
  ONLINE: "Online",
  AWAY: "Away",
  OFFLINE: "Offline",
};

interface PresenceDotProps {
  userId: string;
  className?: string;
}

export function PresenceDot({ userId, className }: PresenceDotProps) {
  const status = usePresenceStore((s) => s.presenceMap[userId] ?? "OFFLINE");

  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", statusColor[status], className)}
      title={statusLabel[status]}
      aria-label={statusLabel[status]}
    />
  );
}
