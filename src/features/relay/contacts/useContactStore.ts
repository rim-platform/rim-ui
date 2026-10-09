/**
 * The names this person gave their contacts, kept on this device: shown instead of the card's
 * name wherever the contact appears.
 */

import { create } from "zustand";

import { logger } from "../../../core/logger";
import { allRecords, deleteRecord, putRecord } from "../state/relayDb";
import { accountKey } from "../state/spaces";

interface AliasRecord {
  account: string;
  principalId: string;
  alias: string;
}

interface ContactState {
  aliases: Record<string, string>;
  load: () => Promise<void>;
  setAlias: (principalId: string, alias: string) => Promise<void>;
}

export const useContactStore = create<ContactState>((set) => ({
  aliases: {},
  load: async () => {
    const account = accountKey();
    if (!account) return;
    const records = (await allRecords<AliasRecord>("aliases")).filter((r) => r.account === account);
    set({ aliases: Object.fromEntries(records.map((r) => [r.principalId, r.alias])) });
  },
  setAlias: async (principalId, alias) => {
    const account = accountKey();
    if (!account) return;
    const trimmed = alias.trim().slice(0, 80);
    set((s) => {
      const aliases = { ...s.aliases };
      if (trimmed) aliases[principalId] = trimmed;
      else delete aliases[principalId];
      return { aliases };
    });
    try {
      if (trimmed) await putRecord("aliases", { account, principalId, alias: trimmed });
      else await deleteRecord("aliases", [account, principalId]);
    } catch (err) {
      logger.warn("[RIM:relay] saving a contact name failed:", err);
    }
  },
}));

/** The name to show for `principalId`: the alias given here, else `fallback`. */
export function contactName(principalId: string, fallback: string): string {
  return useContactStore.getState().aliases[principalId] ?? fallback;
}
