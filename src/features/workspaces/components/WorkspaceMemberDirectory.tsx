import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { Avatar } from "../../../shared/ui/Avatar";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import { AddContactButton } from "../../relay/components/AddContactButton";
import { useServerMembers, type ServerMember } from "../api/useServerMembers";
import { ServerMemberRoleGql } from "../role";
import { useUserContextMenu } from "../hooks/useUserContextMenu";
import { RoleBadge, TimeoutMarker } from "./MemberBadges";
import { MemberMenuButton } from "./MemberMenuButton";

const ROLE_RANK: Record<ServerMemberRoleGql, number> = {
  [ServerMemberRoleGql.OWNER]: 0,
  [ServerMemberRoleGql.MODERATOR]: 1,
  [ServerMemberRoleGql.MEMBER]: 2,
  [ServerMemberRoleGql.GUEST]: 3,
};

function memberName(member: ServerMember): string {
  return member.displayName || member.username || member.userId.slice(0, 8);
}

interface WorkspaceMemberDirectoryProps {
  workspaceId: string;
  onClose: () => void;
}

/**
 * Every member of the workspace, in the tool panel: role badge, timeout marker, and the
 * person's menu on a right click, the ContextMenu key, a long press or their actions button.
 * Not offered to guests (the server also narrows a guest's `serverMembers` to people they
 * share a conversation with).
 */
export function WorkspaceMemberDirectory({ workspaceId, onClose }: WorkspaceMemberDirectoryProps) {
  const { data: members, isPending, isError } = useServerMembers(workspaceId);
  const currentUserId = useAuthStore((s) => s.session?.userId);
  const [filter, setFilter] = useState("");
  const userMenu = useUserContextMenu({ workspaceId });

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (members ?? [])
      .filter(
        (m) =>
          !needle ||
          memberName(m).toLowerCase().includes(needle) ||
          m.username.toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          ROLE_RANK[a.memberRole] - ROLE_RANK[b.memberRole] ||
          memberName(a).localeCompare(memberName(b)),
      );
  }, [members, filter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-rim-line px-4 py-3">
        <h2 className="truncate text-sm font-medium text-rim-text">
          Workspace members
          {members && <span className="ml-1 text-rim-text-faint">&middot; {members.length}</span>}
        </h2>
        <button
          type="button"
          onClick={onClose}
          title="Close workspace members"
          aria-label="Close workspace members"
          className="rounded-lg p-1 text-rim-text-muted transition hover:bg-white/5 hover:text-rim-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="border-b border-rim-line p-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find members..."
          aria-label="Find members"
          className="w-full rounded-lg border border-rim-line bg-rim-void px-2 py-1.5 text-sm text-rim-text outline-none placeholder:text-rim-text-faint focus:border-rim-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {isPending && <p className="px-2 py-4 text-sm text-rim-text-muted">Loading members...</p>}
        {isError && <p className="px-2 py-4 text-sm text-rim-danger">Failed to load members.</p>}
        <ul className="space-y-0.5" aria-label="Workspace members">
          {rows.map((member) => {
            const name = memberName(member);
            const target = { userId: member.userId, displayName: name };
            return (
              <li
                key={member.userId}
                data-testid={`directory-row-${member.userId}`}
                {...userMenu.bind(target)}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
              >
                <DirectoryAvatar userId={member.userId} name={name} avatarUrl={member.avatarUrl} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-sm text-rim-text">{name}</span>
                    {member.userId === currentUserId && (
                      <span className="text-xs text-rim-text-faint">(you)</span>
                    )}
                    <RoleBadge role={member.memberRole} />
                  </span>
                  <TimeoutMarker until={member.timeoutUntil} />
                </span>
                <AddContactButton principalId={member.principalId} name={name} />
                <MemberMenuButton
                  name={name}
                  onOpen={(button) => userMenu.openUnder(button, target)}
                />
              </li>
            );
          })}
        </ul>
        {userMenu.element}
      </div>
    </div>
  );
}

function DirectoryAvatar({
  userId,
  name,
  avatarUrl,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
}) {
  const status = usePresenceStore((s) => s.presenceMap[userId]);
  return (
    <Avatar
      url={avatarUrl}
      name={name}
      userId={userId}
      size="sm"
      presenceStatus={status === "ONLINE" || status === "AWAY" ? status : "OFFLINE"}
    />
  );
}
