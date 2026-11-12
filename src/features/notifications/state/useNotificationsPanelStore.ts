import { create } from "zustand";

type NotificationsPanelState = {
  /** Whether the notification inbox is open under the top bar's bell. */
  open: boolean;
  /** The inbox's "Unread only" filter; kept while the panel closes and reopens. */
  unreadOnly: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setUnreadOnly: (unreadOnly: boolean) => void;
};

export const useNotificationsPanelStore = create<NotificationsPanelState>((set) => ({
  open: false,
  unreadOnly: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setUnreadOnly: (unreadOnly) => set({ unreadOnly }),
}));
