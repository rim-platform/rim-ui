import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { registerSealedStore, sealedStateStorage } from "../../../core/accountVault/sealedStorage";

/** How long an entry is kept. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Most entries kept. */
const MAX_ENTRIES = 5000;

/** The `tool` of the entry clearing the record leaves. */
export const CLEARED_TOOL = "cleared";

/** One thing RIM handed to an agent, or refused it. Holds no message text and no query text. */
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
  refused: boolean;
}

interface AgentRecordState {
  entries: RecordEntry[];
  add: (entry: RecordEntry) => void;
  clear: () => void;
}

/** @returns The entries younger than the age limit, at most the newest {@link MAX_ENTRIES}. */
function kept(entries: RecordEntry[]): RecordEntry[] {
  const oldest = Date.now() - MAX_AGE_MS;
  return entries.filter((entry) => Date.parse(entry.at) >= oldest).slice(-MAX_ENTRIES);
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
