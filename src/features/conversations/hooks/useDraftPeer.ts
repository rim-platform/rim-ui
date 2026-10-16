import type { DirectDraft } from "../../../shell/state/useShellStore";
import type { PresenceStatus } from "../../../shared/ui/Avatar";
import { usePresenceStore } from "../../presence/state/usePresenceStore";
import { useServerMembers } from "../../workspaces/api/useServerMembers";
import { useMemberLookup } from "../../workspaces/hooks/useMemberLookup";

/** The person a draft direct message is to, as the side rail and header show them. */
export interface DraftPeer {
  name: string;
  avatarUrl: string | null | undefined;
  /** What the avatar is keyed by: their user id when known, else their principal id. */
  avatarKey: string;
  presence: PresenceStatus | null;
}

/** The space a draft lives in: its workspace, or its direct space. */
export function draftSpaceId(draft: DirectDraft): string {
  return "spaceId" in draft ? draft.spaceId : draft.workspaceId;
}

export function useDraftPeer(draft: DirectDraft): DraftPeer {
  const spaceId = draftSpaceId(draft);
  const lookup = useMemberLookup(spaceId);
  const { data: members } = useServerMembers(spaceId);
  const userId =
    "spaceId" in draft
      ? members?.find((m) => m.principalId === draft.member.principalId)?.userId
      : draft.otherUserId;
  const info = userId ? lookup.resolve(userId) : undefined;
  const presence = usePresenceStore((s) => (userId ? s.presenceMap[userId] : undefined));
  return {
    name: "spaceId" in draft ? draft.member.name : (info?.displayName ?? ""),
    avatarUrl: info?.avatarUrl,
    avatarKey: userId ?? ("spaceId" in draft ? draft.member.principalId : ""),
    presence:
      presence === "ONLINE" || presence === "AWAY" || presence === "OFFLINE" ? presence : null,
  };
}
