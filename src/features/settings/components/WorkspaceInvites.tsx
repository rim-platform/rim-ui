import { useState } from "react";

import { graphqlErrorMessage } from "../../../core/graphql/errors";
import {
  ServerMemberRoleGql,
  WorkspaceInviteState,
} from "../../../core/graphql/generated/schema-types";
import { toast } from "../../../shared/toast";
import { Avatar } from "../../../shared/ui/Avatar";
import { Button } from "../../../shared/ui/Button";
import { cn } from "../../../shared/ui/cn";
import { formatRelativeTime, formatTime } from "../../../shared/utils/formatTime";
import { useIsDirectSpace } from "../../relay/state/useRelayStore";
import { useIsOwner } from "../../workspaces/api/useMyServerRole";
import { ModerationDialog } from "../../workspaces/components/ModerationDialog";
import { useRevokeInviteMutation } from "../api/useInviteMutations";
import { useWorkspaceInvites, type WorkspaceInviteRow } from "../api/useWorkspaceInvites";
import { InviteDialog } from "./InviteDialog";

interface WorkspaceInvitesProps {
  serverId: string | null;
}

/**
 * Settings → Workspace → Invites, owner only: every invite of the workspace, newest first, with
 * its role, uses, expiry, creator and state, a Revoke action on active ones, and a button that
 * opens the invite dialog. Hidden for everyone else and in the direct space.
 */
export function WorkspaceInvites({ serverId }: WorkspaceInvitesProps) {
  const isOwner = useIsOwner(serverId ?? undefined);
  const inDirectSpace = useIsDirectSpace(serverId);
  if (!serverId || !isOwner || inDirectSpace) return null;
  return <InvitesSection serverId={serverId} />;
}

const ERROR_BOX =
  "rounded-lg border border-rim-danger/20 bg-rim-danger/10 px-3 py-2 text-sm text-rim-danger";

const ROLE_LABEL: Record<ServerMemberRoleGql, string> = {
  [ServerMemberRoleGql.OWNER]: "Owner",
  [ServerMemberRoleGql.MODERATOR]: "Moderator",
  [ServerMemberRoleGql.MEMBER]: "Member",
  [ServerMemberRoleGql.GUEST]: "Guest",
};

const STATE_BADGE: Record<WorkspaceInviteState, { label: string; className: string }> = {
  [WorkspaceInviteState.ACTIVE]: {
    label: "Active",
    className: "border-rim-success/40 text-rim-success",
  },
  [WorkspaceInviteState.EXPIRED]: {
    label: "Expired",
    className: "border-rim-line text-rim-text-faint",
  },
  [WorkspaceInviteState.USED_UP]: {
    label: "Used up",
    className: "border-rim-warm/40 text-rim-warm",
  },
  [WorkspaceInviteState.REVOKED]: {
    label: "Revoked",
    className: "border-rim-danger/40 text-rim-danger",
  },
};

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * How long until `iso`, seen from `now`, in its largest whole unit.
 *
 * @returns For example "3 days", "1 hour" or "less than a minute".
 */
function timeUntil(iso: string, now: number): string {
  const minutes = Math.floor((new Date(iso).getTime() - now) / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

/**
 * The expiry line of an invite: when it expires or expired, when it was revoked, or that it
 * never expires (an invite stored before invites had to expire).
 *
 * @param now When the list was read, so the line agrees with the invite's `state`.
 */
export function inviteExpiryLabel(invite: WorkspaceInviteRow, now: number): string {
  if (invite.state === WorkspaceInviteState.REVOKED && invite.revokedAt) {
    return `Revoked ${formatRelativeTime(invite.revokedAt)}`;
  }
  if (!invite.expiresAt) return "Never expires";
  if (new Date(invite.expiresAt).getTime() <= now) {
    return `Expired ${formatRelativeTime(invite.expiresAt)}`;
  }
  return `Expires in ${timeUntil(invite.expiresAt, now)}`;
}

function creatorName(invite: WorkspaceInviteRow): string {
  return invite.createdBy?.displayName || invite.createdBy?.username || "a deleted account";
}

function InvitesSection({ serverId }: { serverId: string }) {
  const {
    data,
    dataUpdatedAt,
    isPending,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useWorkspaceInvites(serverId);
  const revoke = useRevokeInviteMutation();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<WorkspaceInviteRow | null>(null);
  const invites = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-4" aria-labelledby="invites-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="invites-heading" className="text-base font-semibold text-rim-text">
            Invites
          </h2>
          <p className="mt-1 text-sm text-rim-text-muted">
            Links that let people join this workspace. Each expires within 30 days. Only the owner
            sees them.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setCreating(true)}>
          Create invite
        </Button>
      </div>
      <div className="rounded-lg border border-rim-line bg-rim-panel p-4">
        <p className="text-xs text-rim-text-faint">Newest first.</p>
        {isPending && <p className="mt-2 text-sm text-rim-text-muted">Loading invites…</p>}
        {isError && (
          <p role="alert" className={`mt-2 ${ERROR_BOX}`}>
            {graphqlErrorMessage(error, "Failed to load invites.")}
          </p>
        )}
        {data && invites.length === 0 && (
          <p className="mt-2 text-sm text-rim-text-muted">No invites yet.</p>
        )}
        {invites.length > 0 && (
          <ul className="mt-2 divide-y divide-rim-line" aria-label="Invites">
            {invites.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                now={dataUpdatedAt}
                onRevoke={() => setRevoking(invite)}
              />
            ))}
          </ul>
        )}
        {hasNextPage && (
          <div className="mt-2 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              isLoading={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
      {creating && <InviteDialog open workspaceId={serverId} onClose={() => setCreating(false)} />}
      {revoking && (
        <ModerationDialog
          title="Revoke this invite?"
          description={`Nobody can join with this ${ROLE_LABEL[revoking.role].toLowerCase()} invite link any more. ${
            revoking.useCount === 1
              ? "The person who already joined with it stays."
              : revoking.useCount > 1
                ? `The ${revoking.useCount} people who already joined with it stay.`
                : "Nobody has joined with it yet."
          }`}
          tone="danger"
          confirmLabel="Revoke invite"
          errorFallback="Could not revoke the invite"
          onConfirm={() => revoke.mutateAsync({ serverId, inviteId: revoking.id })}
          onDone={() => {
            setRevoking(null);
            toast.success("Invite revoked");
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </section>
  );
}

function InviteRow({
  invite,
  now,
  onRevoke,
}: {
  invite: WorkspaceInviteRow;
  now: number;
  onRevoke: () => void;
}) {
  const creator = creatorName(invite);
  const badge = STATE_BADGE[invite.state];
  const role = ROLE_LABEL[invite.role];

  return (
    <li data-testid={`invite-row-${invite.id}`} className="flex items-center gap-3 py-2">
      <Avatar
        url={invite.createdBy?.avatarUrl}
        name={creator}
        userId={invite.createdById}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm text-rim-text">
          <span>{role} invite</span>
          <span
            className={cn(
              "rounded border px-1 text-[10px] uppercase tracking-wider",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        </p>
        <p className="truncate text-xs text-rim-text-muted">
          {invite.useCount} of {plural(invite.maxUses, "use")}
          {" · "}
          <span title={invite.expiresAt ? formatTime(invite.expiresAt) : undefined}>
            {inviteExpiryLabel(invite, now)}
          </span>
          {" · "}
          Created by {creator} {formatRelativeTime(invite.createdAt)}
        </p>
      </div>
      {invite.state === WorkspaceInviteState.ACTIVE && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRevoke}
          aria-label={`Revoke the ${role.toLowerCase()} invite created ${formatTime(invite.createdAt)}`}
        >
          Revoke
        </Button>
      )}
    </li>
  );
}
