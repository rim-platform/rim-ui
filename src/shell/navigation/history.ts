import { useEffect } from "react";

import { useWorkspaceStore } from "../../features/workspaces/state/useWorkspaceStore";
import { useShellStore, type Place } from "../state/useShellStore";

/** Whether a record is already queued for the end of the current change. */
let queued = false;

/** The place shown now, or `null` while no workspace is open. */
function currentPlace(): Place | null {
  const workspaceId = useWorkspaceStore.getState().workspaceId;
  if (!workspaceId) return null;
  const shell = useShellStore.getState();
  return {
    workspaceId,
    surface: shell.mainSurface,
    conversationId: shell.selectedConversationId,
  };
}

/**
 * Records the place shown once the current change is over, so that the steps of one move,
 * such as a workspace switch that then clears the conversation, make one place. Opening a
 * place from the history ends on that place, which records nothing new.
 */
function record(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const place = currentPlace();
    if (place) useShellStore.getState().recordPlace(place);
  });
}

/**
 * Records each place the person opens, a workspace, a page or a conversation, in the shell
 * store's history. The browser's own history is never touched.
 */
export function useNavigationHistory(): void {
  useEffect(() => {
    record();
    const stopWorkspace = useWorkspaceStore.subscribe((state, previous) => {
      if (state.workspaceId !== previous.workspaceId) record();
    });
    const stopShell = useShellStore.subscribe((state, previous) => {
      if (
        state.mainSurface !== previous.mainSurface ||
        state.selectedConversationId !== previous.selectedConversationId
      ) {
        record();
      }
    });
    return () => {
      stopWorkspace();
      stopShell();
    };
  }, []);
}

/** Opens `place`: its workspace, then its page, then its conversation. */
function open(place: Place): void {
  const workspace = useWorkspaceStore.getState();
  if (workspace.workspaceId !== place.workspaceId) workspace.setWorkspaceId(place.workspaceId);
  const shell = useShellStore.getState();
  shell.setMainSurface(place.surface);
  if (shell.selectedConversationId !== place.conversationId) {
    shell.setSelectedConversationId(place.conversationId);
  }
}

/**
 * Opens the place before the current one in the history.
 *
 * @returns Whether there was one.
 */
export function goBack(): boolean {
  const place = useShellStore.getState().stepHistory(-1);
  if (place) open(place);
  return place !== null;
}

/**
 * Opens the place after the current one in the history, one Back left.
 *
 * @returns Whether there was one.
 */
export function goForward(): boolean {
  const place = useShellStore.getState().stepHistory(1);
  if (place) open(place);
  return place !== null;
}

/** Whether Back has a place to open. */
export function useCanGoBack(): boolean {
  return useShellStore((s) => s.historyIndex > 0);
}

/** Whether Forward has a place to open. */
export function useCanGoForward(): boolean {
  return useShellStore((s) => s.historyIndex < s.history.length - 1);
}
