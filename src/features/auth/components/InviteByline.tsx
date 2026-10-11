interface InviteBylineProps {
  /** Who sent the invite. */
  invitedBy?: string;
  /** The workspace owner's name as shown; absent or null when it has none. */
  ownerName?: string | null;
}

/** One muted line under a workspace invite's header: who invited and whose workspace it is. */
export function InviteByline({ invitedBy, ownerName }: InviteBylineProps) {
  const parts = [
    ...(invitedBy ? [`Invited by ${invitedBy}`] : []),
    ...(ownerName ? [`Owned by ${ownerName}`] : []),
  ];
  if (parts.length === 0) return null;
  return <p className="mt-1 text-xs text-rim-text-faint">{parts.join(" · ")}</p>;
}
