import { formatTime } from "../../../shared/utils/formatTime";
import { cn } from "../../../shared/ui/cn";
import { ServerMemberRoleGql, roleLabel } from "../role";
import { isTimeoutActive } from "../timeout";

const ROLE_BADGE: Partial<Record<ServerMemberRoleGql, string>> = {
  [ServerMemberRoleGql.OWNER]: "border-rim-warm/40 text-rim-warm",
  [ServerMemberRoleGql.MODERATOR]: "border-rim-accent/40 text-rim-accent",
  [ServerMemberRoleGql.GUEST]: "border-rim-line text-rim-text-muted",
};

/** Owner, Moderator and Guest get a badge; ordinary members get none. */
export function RoleBadge({ role }: { role: ServerMemberRoleGql | null | undefined }) {
  const style = role ? ROLE_BADGE[role] : undefined;
  if (!role || !style) return null;
  return (
    <span
      data-testid="role-badge"
      className={cn(
        "shrink-0 rounded border px-1 text-[10px] uppercase tracking-wider leading-4",
        style,
      )}
    >
      {roleLabel(role)}
    </span>
  );
}

/** "Timed out until …" while a member's timeout is in force. */
export function TimeoutMarker({ until }: { until: string | null | undefined }) {
  if (!isTimeoutActive(until)) return null;
  return (
    <span data-testid="timeout-marker" className="block truncate text-[10px] text-rim-warm">
      Timed out until {formatTime(until)}
    </span>
  );
}
