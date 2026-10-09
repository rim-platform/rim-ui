import { useShellStore } from "../../../shell/state/useShellStore";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/** Open `conversationId` of the direct space `spaceId`, switching to that space first. */
export function selectDirectConversation(spaceId: string, conversationId: string) {
  if (useWorkspaceStore.getState().workspaceId !== spaceId) {
    useWorkspaceStore.getState().setWorkspaceId(spaceId);
  }
  useShellStore.getState().setSelectedConversationId(conversationId);
}
