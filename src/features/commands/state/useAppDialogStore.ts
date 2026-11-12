import { create } from "zustand";

/** The dialogs an app command opens that no screen owns. */
export type AppDialog = "signOut" | "status" | "addWorkspace" | "profile";

/** A point in the window, in CSS pixels. */
export interface DialogPoint {
  x: number;
  y: number;
}

interface AppDialogState {
  dialog: AppDialog | null;
  /** The person whose profile card is open, while `dialog` is `profile`. */
  userId: string | null;
  /**
   * Where the status menu opens, next to the control it was chosen from; `null` opens it where
   * a command opens it.
   */
  statusAt: DialogPoint | null;
  open: (dialog: AppDialog, userId?: string) => void;
  /** Sets where the status menu opens next, before the control runs the command that opens it. */
  anchorStatus: (point: DialogPoint) => void;
  close: () => void;
}

/** Which of {@link AppDialog} is open; the host in the app shell shows it. */
export const useAppDialogStore = create<AppDialogState>((set) => ({
  dialog: null,
  userId: null,
  statusAt: null,
  open: (dialog, userId) => set({ dialog, userId: userId ?? null }),
  anchorStatus: (point) => set({ statusAt: point }),
  close: () => set({ dialog: null, userId: null, statusAt: null }),
}));
