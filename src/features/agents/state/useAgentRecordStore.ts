import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";

/** How long an entry is kept. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Most entries kept for one agent, so one agent's calls cannot push out another's. */
const MAX_PER_AGENT = 2000;
/** Most refused entries kept for one agent, so refused calls cannot push out what it was given. */
const MAX_REFUSED_PER_AGENT = 500;

/** The `tool` of the entry clearing the record leaves. */
export const CLEARED_TOOL = "cleared";

/**
 * One thing RIM handed to an agent, refused it, or was asked to do for it. Holds no message text,
 * no query text, and nothing a plugin command was given or returned.
 */
export interface RecordEntry {
  /** When, ISO 8601. */
  at: string;
  agentId: string;
  /** Kept, so an entry still reads after the agent is disconnected. */
  agentName: string;
  tool: string;
  /** Empty when the call named none that could be a workspace id. */
  workspaceId: string;
  channelId: string | null;
  /** Whether it was a search. */
  query: boolean;
  messageIds: string[];
  /** Whether a grant or validation check refused it. */
  refused: boolean;
  /** For a request to change something: that it was asked, or how it ended. */
  change?: "asked" | "sent" | "proposed" | "done" | "discarded" | "expired" | "busy" | "refused";
  /** The plugin command it was about. An id the call gave in the wrong shape is left empty. */
  plugin?: { pluginId: string; commandId: string };
  /** The id of RIM's own command it was about, when the call gave one in the shape of an id. */
  command?: string;
  /** The run it belongs to: its agent's calls with no long gap between them. */
  runId?: string;
}

interface AgentRecordState {
  entries: RecordEntry[];
  add: (entry: RecordEntry) => void;
  clear: () => void;
}

/** @returns The entries younger than the age limit, within the limits for each agent. */
function kept(entries: RecordEntry[]): RecordEntry[] {
  const oldest = Date.now() - MAX_AGE_MS;
  const refused = new Map<string, number>();
  const counted = new Map<string, number>();
  const result: RecordEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (Date.parse(entry.at) < oldest) continue;
    if (entry.refused) {
      const count = (refused.get(entry.agentId) ?? 0) + 1;
      refused.set(entry.agentId, count);
      if (count > MAX_REFUSED_PER_AGENT) continue;
    }
    const count = (counted.get(entry.agentId) ?? 0) + 1;
    counted.set(entry.agentId, count);
    if (count > MAX_PER_AGENT) continue;
    result.push(entry);
  }
  return result.reverse();
}

/** What RIM handed to agents on this device, oldest first, sealed under the account vault. */
export const useAgentRecordStore = create<AgentRecordState>()(
  persist(
    (set) => ({
      entries: [],
      add: (entry) => set((state) => ({ entries: kept([...state.entries, entry]) })),
      clear: () =>
        set({
          entries: [
            {
              at: new Date().toISOString(),
              agentId: "",
              agentName: "",
              tool: CLEARED_TOOL,
              workspaceId: "",
              channelId: null,
              query: false,
              messageIds: [],
              refused: false,
            },
          ],
        }),
    }),
    {
      name: "rim-agent-record",
      storage: createJSONStorage(() => sealedStateStorage),
      skipHydration: true,
      merge: (stored, current) => ({
        ...current,
        entries: kept((stored as Partial<AgentRecordState> | undefined)?.entries ?? []),
      }),
    },
  ),
);
registerSealedStore(useAgentRecordStore);
