import { AgentEncryptedWarning } from "../../agent/encrypted/AgentEncryptedSwitch";
import { InviteDialog } from "../../settings/components/InviteDialog";
import { useConversationDialogStore } from "../state/useConversationDialogStore";
import { BrowseChannelsDialog } from "./BrowseChannelsDialog";
import { NewChannelDialog } from "./NewChannelDialog";

/**
 * Shows the dialogs the conversation commands open from the palette, a keybind, a quick box or a
 * workspace's menu: Browse channels, Invite people and Create channel of a workspace, and the
 * warning before the agent may read an encrypted conversation.
 */
export function ConversationCommandHost() {
  const browseIn = useConversationDialogStore((s) => s.browseChannelsIn);
  const inviteTo = useConversationDialogStore((s) => s.inviteTo);
  const createIn = useConversationDialogStore((s) => s.createChannelIn);
  const agentFor = useConversationDialogStore((s) => s.agentWarningFor);
  const { closeBrowseChannels, closeInvite, closeCreateChannel, closeAgentWarning } =
    useConversationDialogStore.getState();
  return (
    <>
      {browseIn && <BrowseChannelsDialog workspaceId={browseIn} onClose={closeBrowseChannels} />}
      {inviteTo && <InviteDialog open workspaceId={inviteTo} onClose={closeInvite} />}
      {createIn && <NewChannelDialog workspaceId={createIn} onClose={closeCreateChannel} />}
      {agentFor && <AgentEncryptedWarning conversationId={agentFor} onClose={closeAgentWarning} />}
    </>
  );
}
