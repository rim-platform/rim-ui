import { create } from "zustand";

/** What a command asks Settings > Agents to open. */
export type AgentsSettingsRequest =
  | { kind: "disconnect"; agentId: string }
  | { kind: "chooseReads"; agentId: string }
  | { kind: "choosePlugins"; agentId: string }
  | { kind: "allRuns" }
  | { kind: "runs"; agentId: string }
  | { kind: "record"; agentId?: string }
  | { kind: "clearRecord" }
  | { kind: "connect" };

interface AgentsSettingsRequestState {
  /** The request waiting for Settings > Agents to take it, or `null`. */
  request: AgentsSettingsRequest | null;
  open: (request: AgentsSettingsRequest) => void;
  /** Hands over the waiting request, if any, and forgets it. */
  take: () => AgentsSettingsRequest | null;
}

/** The dialog of Settings > Agents a command opens, held until the tab takes it. */
export const useAgentsSettingsRequestStore = create<AgentsSettingsRequestState>((set, get) => ({
  request: null,
  open: (request) => set({ request }),
  take: () => {
    const { request } = get();
    if (request) set({ request: null });
    return request;
  },
}));
