import { Crown, Shield } from "lucide-react";

import { formatTime } from "../../../shared/utils/formatTime";
import { cn } from "../../../shared/ui/cn";
import { ServerMemberRoleGql, roleLabel } from "../role";
import { isTimeoutActive } from "../timeout";

const ROLE_BADGE: Partial<Record<ServerMemberRoleGql, string>> = {
  [ServerMemberRoleGql.OWNER]: "border-rim-warm/40 text-rim-warm",
  [ServerMemberRoleGql.MODERATOR]: "border-rim-accent/40 text-rim-accent",
  [ServerMemberRoleGql.GUEST]: "border-rim-line text-rim-text-muted",
};

const ROLE_TITLE: Partial<Record<ServerMemberRoleGql, string>> = {
  [ServerMemberRoleGql.OWNER]: "Owner of this workspace",
  [ServerMemberRoleGql.MODERATOR]: "Moderator of this workspace",
  [ServerMemberRoleGql.GUEST]: "Guest in this workspace",
};

const ROLE_ICON: Partial<Record<ServerMemberRoleGql, typeof Crown>> = {
  [ServerMemberRoleGql.OWNER]: Crown,
  [ServerMemberRoleGql.MODERATOR]: Shield,
};

/**
 * Owner, Moderator and Guest get a badge; ordinary members get none. Owners carry a crown and
 * moderators a shield before the label.
 */
export function RoleBadge({
  role,
  className,
}: {
  role: ServerMemberRoleGql | null | undefined;
  className?: string;
}) {
  const style = role ? ROLE_BADGE[role] : undefined;
  if (!role || !style) return null;
  const Icon = ROLE_ICON[role];
  return (
    <span
      data-testid="role-badge"
      title={ROLE_TITLE[role]}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded border px-1 text-[10px] uppercase tracking-wider leading-4",
        style,
        className,
      )}
    >
      {Icon && <Icon data-testid="role-badge-icon" aria-hidden className="h-2.5 w-2.5" />}
      {roleLabel(role)}
    </span>
  );
}

/**
 * The role badge for owners, moderators and guests, for a role that arrives as free text.
 * Anything else, including members and unknown values, renders nothing.
 */
export function MessageRoleBadge({
  role,
  className,
}: {
  role: string | null | undefined;
  className?: string;
}) {
  if (
    role !== ServerMemberRoleGql.OWNER &&
    role !== ServerMemberRoleGql.MODERATOR &&
    role !== ServerMemberRoleGql.GUEST
  ) {
    return null;
  }
  return <RoleBadge role={role} className={className} />;
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
