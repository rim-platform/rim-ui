import { AgentEncryptedWarning } from "../../agent/encrypted/AgentEncryptedSwitch";
import { useConversationDialogStore } from "../state/useConversationDialogStore";
import { BrowseChannelsDialog } from "./BrowseChannelsDialog";

/**
 * Shows the dialogs the conversation commands open from the palette, a keybind or a quick box:
 * Browse channels, and the warning before the agent may read an encrypted conversation.
 */
export function ConversationCommandHost() {
  const browseIn = useConversationDialogStore((s) => s.browseChannelsIn);
  const agentFor = useConversationDialogStore((s) => s.agentWarningFor);
  const { closeBrowseChannels, closeAgentWarning } = useConversationDialogStore.getState();
  return (
    <>
      {browseIn && <BrowseChannelsDialog workspaceId={browseIn} onClose={closeBrowseChannels} />}
      {agentFor && <AgentEncryptedWarning conversationId={agentFor} onClose={closeAgentWarning} />}
    </>
  );
}
