import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";
import type { AgentGrants } from "../runtime/grants";

/** What one agent may run from one plugin, tied to the manifest it was approved for. */
export interface PluginApproval {
  manifestHash: string;
  commandIds: string[];
}

/** A program on this computer the person connected to RIM. */
export interface ConnectedAgent {
  id: string;
  /** What the program calls itself, cleaned. */
  name: string;
  /** SHA-256 of its token, unpadded base64url. The token itself is not kept. */
  tokenHash: string;
  /** When it was connected, ISO 8601. */
  pairedAt: string;
  /** What it may read. Everything starts off. */
  grants: AgentGrants;
  /** What it may run, by plugin id. Everything starts off. */
  pluginApprovals: Record<string, PluginApproval>;
}

interface ConnectedAgentsState {
  agents: ConnectedAgent[];
  add: (agent: ConnectedAgent) => void;
  revoke: (id: string) => void;
  setGrants: (id: string, grants: AgentGrants) => void;
  /** Keeps an approval for one plugin, or with `null` takes it away. */
  setPluginApprovals: (id: string, pluginId: string, approval: PluginApproval | null) => void;
}

/** The programs connected to this account on this device, sealed under the account vault. */
export const useConnectedAgentsStore = create<ConnectedAgentsState>()(
  persist(
    (set) => ({
      agents: [],
      add: (agent) => set((state) => ({ agents: [...state.agents, agent] })),
      revoke: (id) => set((state) => ({ agents: state.agents.filter((agent) => agent.id !== id) })),
      setGrants: (id, grants) =>
        set((state) => ({
          agents: state.agents.map((agent) => (agent.id === id ? { ...agent, grants } : agent)),
        })),
      setPluginApprovals: (id, pluginId, approval) =>
        set((state) => ({
          agents: state.agents.map((agent) => {
            if (agent.id !== id) return agent;
            const { [pluginId]: _previous, ...others } = agent.pluginApprovals ?? {};
            return {
              ...agent,
              pluginApprovals: approval ? { ...others, [pluginId]: approval } : others,
            };
          }),
        })),
    }),
    {
      name: "rim-connected-agents",
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
    },
  ),
);
registerSealedStore(useConnectedAgentsStore);
