import { create } from "zustand";

/** One line of a command result: a channel, a member, a message or a state entry. */
export interface ResultRow {
  key: string;
  primary: string;
  secondary?: string;
}

/** What the result view shows for a read command's answer. */
export interface CommandResultViewData {
  title: string;
  rows: ResultRow[];
  /** A line above the rows, such as why a conversation's messages are not listed. */
  note?: string;
}

type CommandResultState = {
  view: CommandResultViewData | null;
  show: (view: CommandResultViewData) => void;
  dismiss: () => void;
};

export const useCommandResultStore = create<CommandResultState>((set) => ({
  view: null,
  show: (view) => set({ view }),
  dismiss: () => set({ view: null }),
}));
