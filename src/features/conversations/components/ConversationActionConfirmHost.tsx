import { useConversationActionConfirmStore } from "../state/useConversationActionConfirmStore";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

/** Shows the pending leave or archive confirmation of a command run outside the conversation menu. */
export function ConversationActionConfirmHost() {
  const request = useConversationActionConfirmStore((s) => s.request);
  const confirm = useConversationActionConfirmStore((s) => s.confirm);
  const cancel = useConversationActionConfirmStore((s) => s.cancel);
  if (!request) return null;
  return <ConfirmActionDialog {...request} danger onConfirm={confirm} onClose={cancel} />;
}
