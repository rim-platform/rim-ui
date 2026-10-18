import { UserHoverCardPortal } from "../../../shared/ui/UserHoverCardPortal";
import { openDirectWithMember } from "../../conversations/state/openDirect";
import { useAuthorPresence } from "../../messages/components/message-item/useAuthorPresence";
import { useMemberLookup } from "../hooks/useMemberLookup";

/** A person's profile card, opened from their menu, until Escape or a press outside it. */
export function ProfileCard({
  workspaceId,
  userId,
  anchorRect,
  onClose,
}: {
  workspaceId: string | null;
  userId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}) {
  const info = useMemberLookup(workspaceId ?? undefined).resolve(userId);
  const presence = useAuthorPresence(userId, null);
  return (
    <UserHoverCardPortal
      userId={userId}
      username={info.username ?? info.displayName}
      displayName={info.displayName}
      avatarUrl={info.avatarUrl}
      statusText={info.statusText}
      role={info.role}
      joinedAt={info.joinedAt}
      bio={info.bio}
      presenceStatus={presence}
      isCurrentUser={info.isCurrentUser}
      onSendDm={() => {
        onClose();
        void openDirectWithMember(userId);
      }}
      anchorRect={anchorRect}
      onDismiss={onClose}
    />
  );
}
