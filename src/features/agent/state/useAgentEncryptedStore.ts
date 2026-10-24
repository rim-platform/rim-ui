import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";

/** The warning shown before the agent may read an encrypted conversation. */
export const AGENT_ENCRYPTED_WARNING =
  "The text of this conversation goes to the model provider. It leaves this device and is no longer end-to-end encrypted once the agent reads it.";

interface AgentEncryptedState {
  /** Encrypted conversations the person let the agent read, with when they did. */
  allowed: Record<string, string>;
  setAllowed: (conversationId: string, allowed: boolean) => void;
}

/**
 * Where the agent may read and post in end-to-end encrypted conversations: nowhere until the
 * person turns it on for a conversation, after the warning.
 */
export const useAgentEncryptedStore = create<AgentEncryptedState>()(
  persist(
    (set) => ({
      allowed: {},
      setAllowed: (conversationId, allowed) =>
        set((state) => {
          const next = { ...state.allowed };
          if (allowed) next[conversationId] = new Date().toISOString();
          else delete next[conversationId];
          return { allowed: next };
        }),
    }),
    {
      name: "rim-agent-encrypted",
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
    },
  ),
);
registerSealedStore(useAgentEncryptedStore);

/** Whether the agent may use the encrypted conversation `conversationId`. */
export function agentAllowedIn(conversationId: string): boolean {
  return conversationId in useAgentEncryptedStore.getState().allowed;
}

/** Whether the agent may use `conversationId`, for rendering. */
export function useAgentAllowedIn(conversationId: string): boolean {
  return useAgentEncryptedStore((s) => conversationId in s.allowed);
}

/** The menu label of the per-conversation agent switch. */
export function agentSwitchLabel(allowed: boolean): string {
  return allowed ? "Agent: on in this conversation" : "Agent: off in this conversation";
}
