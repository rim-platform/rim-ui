import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";

/** A program on this computer the person connected to RIM. */
export interface ConnectedAgent {
  id: string;
  /** What the program calls itself, cleaned. */
  name: string;
  /** SHA-256 of its token, unpadded base64url. The token itself is not kept. */
  tokenHash: string;
  /** When it was connected, ISO 8601. */
  pairedAt: string;
}

interface ConnectedAgentsState {
  agents: ConnectedAgent[];
  add: (agent: ConnectedAgent) => void;
  revoke: (id: string) => void;
}

/** The programs connected to this account on this device, sealed under the account vault. */
export const useConnectedAgentsStore = create<ConnectedAgentsState>()(
  persist(
    (set) => ({
      agents: [],
      add: (agent) => set((state) => ({ agents: [...state.agents, agent] })),
      revoke: (id) => set((state) => ({ agents: state.agents.filter((agent) => agent.id !== id) })),
    }),
    {
      name: "rim-connected-agents",
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
    },
  ),
);
registerSealedStore(useConnectedAgentsStore);
