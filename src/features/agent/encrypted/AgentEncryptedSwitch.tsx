import { ConfirmActionDialog } from "../../conversations/components/ConfirmActionDialog";
import { AGENT_ENCRYPTED_WARNING, useAgentEncryptedStore } from "../state/useAgentEncryptedStore";

/** The warning the person accepts before the agent may read an encrypted conversation. */
export function AgentEncryptedWarning({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const setAllowed = useAgentEncryptedStore((s) => s.setAllowed);
  return (
    <ConfirmActionDialog
      title="Let the agent use this encrypted conversation?"
      description={AGENT_ENCRYPTED_WARNING}
      confirmLabel="Turn on"
      danger
      onConfirm={() => {
        setAllowed(conversationId, true);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
