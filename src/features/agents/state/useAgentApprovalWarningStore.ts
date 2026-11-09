import { create } from "zustand";

/** What the approval warning is about: an agent's open request, or a program waiting to connect. */
export type AgentApprovalWarning =
  { kind: "request"; token: string } | { kind: "pairing"; requestId: string };

interface AgentApprovalWarningState {
  /** The warning shown now, or `null`. */
  warning: AgentApprovalWarning | null;
  show: (warning: AgentApprovalWarning) => void;
  close: () => void;
}

/** The warning shown before an agent's request or connection is approved by a command. */
export const useAgentApprovalWarningStore = create<AgentApprovalWarningState>((set) => ({
  warning: null,
  show: (warning) => set({ warning }),
  close: () => set({ warning: null }),
}));
