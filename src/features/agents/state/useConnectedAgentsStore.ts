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
  /** The ids of RIM's own commands it may ask to run. Everything starts off. */
  commandApprovals: string[];
  /** When its grants or approvals last changed, ISO 8601; a run does not span the change. */
  scopeChangedAt?: string;
}

interface ConnectedAgentsState {
  agents: ConnectedAgent[];
  add: (agent: ConnectedAgent) => void;
  revoke: (id: string) => void;
  setGrants: (id: string, grants: AgentGrants) => void;
  /** Keeps an approval for one plugin, or with `null` takes it away. */
  setPluginApprovals: (id: string, pluginId: string, approval: PluginApproval | null) => void;
  /** Replaces the RIM commands the agent may ask to run. */
  setCommandApprovals: (id: string, commandIds: string[]) => void;
}

/** The stored shape's version: 1 added `commandApprovals`. */
const STORE_VERSION = 1;

/**
 * Brings stored agents up to the current shape: an agent stored before `commandApprovals`
 * existed gets none, and a missing `pluginApprovals` becomes none.
 *
 * @param persisted - What the storage held, of any version.
 * @returns The state with every agent in the current shape.
 */
export function migrateConnectedAgents(persisted: unknown): { agents: ConnectedAgent[] } {
  const stored = (persisted as { agents?: unknown } | null | undefined)?.agents;
  const agents = Array.isArray(stored) ? (stored as Partial<ConnectedAgent>[]) : [];
  return {
    agents: agents.map(
      (agent) =>
        ({
          ...agent,
          pluginApprovals: agent.pluginApprovals ?? {},
          commandApprovals: Array.isArray(agent.commandApprovals) ? agent.commandApprovals : [],
        }) as ConnectedAgent,
    ),
  };
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
          agents: state.agents.map((agent) =>
            agent.id === id
              ? { ...agent, grants, scopeChangedAt: new Date().toISOString() }
              : agent,
          ),
        })),
      setPluginApprovals: (id, pluginId, approval) =>
        set((state) => ({
          agents: state.agents.map((agent) => {
            if (agent.id !== id) return agent;
            const { [pluginId]: _previous, ...others } = agent.pluginApprovals ?? {};
            return {
              ...agent,
              scopeChangedAt: new Date().toISOString(),
              pluginApprovals: approval ? { ...others, [pluginId]: approval } : others,
            };
          }),
        })),
      setCommandApprovals: (id, commandIds) =>
        set((state) => ({
          agents: state.agents.map((agent) =>
            agent.id === id
              ? {
                  ...agent,
                  scopeChangedAt: new Date().toISOString(),
                  commandApprovals: [...new Set(commandIds)],
                }
              : agent,
          ),
        })),
    }),
    {
      name: "rim-connected-agents",
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
      version: STORE_VERSION,
      migrate: (persisted) => migrateConnectedAgents(persisted) as ConnectedAgentsState,
    },
  ),
);
registerSealedStore(useConnectedAgentsStore);
