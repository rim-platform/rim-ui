import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { useShellStore, type DirectDraft } from "../../../shell/state/useShellStore";
import { LockMark } from "../../e2ee/components/LockMark";
import { useDeviceReadyForEncryption } from "../../e2ee/hooks/useE2eeConversation";
import { Composer } from "../../messages/components/Composer";
import { directMemberReady } from "../../relay/conversations/startDirect";
import { draftSpaceId } from "../hooks/useDraftPeer";
import { directDraftKey } from "../state/openDirect";

/**
 * Whether the draft's first message will be end-to-end encrypted: in a workspace whenever this
 * device is ready, in a direct space when the other person is ready too. Null until known.
 */
function useDraftEncrypted(draft: DirectDraft): boolean | null {
  const deviceReady = useDeviceReadyForEncryption();
  const member = "spaceId" in draft ? draft.member : null;
  const { data: memberReady } = useQuery({
    queryKey: ["directMemberReady", member?.principalId, member?.relayUrls],
    enabled: deviceReady && member !== null,
    staleTime: 60_000,
    queryFn: () => directMemberReady(member!),
  });
  if (!deviceReady) return false;
  if (!member) return true;
  return memberReady ?? null;
}

/** The main area of a draft direct message: an empty timeline and the composer. */
export function DraftDirectView({ draft }: { draft: DirectDraft }) {
  const encrypted = useDraftEncrypted(draft);
  const key = directDraftKey(draft);

  // A draft opens ready to type.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [key]);

  return (
    <div
      data-panel="mainSurface"
      tabIndex={-1}
      onFocus={() => useShellStore.getState().setFocusedSurface("mainSurface")}
      className="relative flex flex-1 flex-col overflow-hidden outline-none"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
        <p className="text-sm text-rim-text-muted">
          No messages yet. Your first message starts the conversation.
        </p>
        {encrypted && (
          <p
            data-testid="draft-direct-encrypted"
            className="flex items-center gap-1 text-xs text-rim-text-faint"
          >
            <LockMark />
            This conversation will be end-to-end encrypted.
          </p>
        )}
      </div>
      <Composer
        workspaceId={draftSpaceId(draft)}
        draft={{ target: draft, encrypted: encrypted === true }}
      />
    </div>
  );
}
