import { create } from "zustand";

import type { ConversationSummary } from "../../conversations/types";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";

/** A picker or dialog that a management command opens. */
export type ManageRequest =
  | { kind: "report"; outcome: "resolve" | "dismiss" }
  | { kind: "join-request"; accept: boolean }
  | { kind: "revoke-invite" }
  | { kind: "bot"; action: "edit" | "deactivate" }
  | { kind: "revoke-webhook" }
  | { kind: "new-webhook"; conversation: ConversationSummary }
  | { kind: "unblock-principal" }
  | { kind: "unblock-ip" }
  | { kind: "principal"; purpose: "block" | "clear-profile" }
  | { kind: "plugin"; action: "toggle" | "update" | "uninstall" | "revoke-ai" }
  | { kind: "person"; purpose: "add-contact" | "remove-contact" | "block"; userId?: string }
  | { kind: "unblock-person" }
  | {
      kind: "request";
      action: RequestAction;
      requestId: string;
      /** For `report`: the reason to report it for, rather than asking for one. */
      reason?: string;
    };

/** What a command does with a message request. */
export type RequestAction = "accept" | "ignore" | "read-first" | "report" | "block";

interface ManageCommandState {
  request: ManageRequest | null;
  /** The workspace that was open when the request was made. */
  workspaceId: string | null;
  open: (request: ManageRequest) => void;
  close: () => void;
}

/** The management picker or dialog that is open, until it closes. */
export const useManageCommandStore = create<ManageCommandState>((set) => ({
  request: null,
  workspaceId: null,
  open: (request) => set({ request, workspaceId: useWorkspaceStore.getState().workspaceId }),
  close: () => set({ request: null }),
}));
