import { useEffect } from "react";

import { useJoinedChannels } from "../../features/conversations/api/useChannels";
import { sidebarChannels } from "../../features/conversations/utils";
import { useIsDirectSpace } from "../../features/relay/state/useRelayStore";
import { useShellStore } from "../state/useShellStore";

/**
 * After an account is created, opens the first channel of the first workspace shown with no
 * conversation selected, once. The flag is cleared when the person picks something themselves,
 * so a later workspace switch or sign-in opens nothing. A direct space has no channels and
 * leaves the flag as it is.
 *
 * @param workspaceId - The workspace shown.
 */
export function useOpenFirstChannelOnce(workspaceId: string | null): void {
  const pending = useShellStore((s) => s.openFirstChannelOnce);
  const selected = useShellStore((s) => s.selectedConversationId);
  const draft = useShellStore((s) => s.draftDirect);
  const onConversation = useShellStore((s) => s.mainSurface.kind === "conversation");
  const direct = useIsDirectSpace(workspaceId);
  const { data } = useJoinedChannels(workspaceId ?? undefined);
  const firstId = sidebarChannels(data?.items ?? [])[0]?.id ?? null;

  useEffect(() => {
    if (!pending) return;
    const shell = useShellStore.getState();
    if (selected !== null || draft !== null) {
      shell.setOpenFirstChannelOnce(false);
      return;
    }
    if (!workspaceId || direct || !onConversation || !firstId) return;
    shell.setOpenFirstChannelOnce(false);
    shell.setSelectedConversationId(firstId);
  }, [pending, selected, draft, workspaceId, direct, onConversation, firstId]);
}
