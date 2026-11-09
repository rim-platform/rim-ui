import { create } from "zustand";

/** The dialogs an app command opens that no screen owns. */
export type AppDialog = "signOut" | "status" | "addWorkspace" | "profile";

interface AppDialogState {
  dialog: AppDialog | null;
  /** The person whose profile card is open, while `dialog` is `profile`. */
  userId: string | null;
  open: (dialog: AppDialog, userId?: string) => void;
  close: () => void;
}

/** Which of {@link AppDialog} is open; the host in the app shell shows it. */
export const useAppDialogStore = create<AppDialogState>((set) => ({
  dialog: null,
  userId: null,
  open: (dialog, userId) => set({ dialog, userId: userId ?? null }),
  close: () => set({ dialog: null, userId: null }),
}));
