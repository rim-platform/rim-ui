import { create } from "zustand";

interface OnCallStoreState {
  /** Whether the "take shift" override modal is open — set by the `oncall.take_shift`
   * command's local handler (see `commandDispatcher.ts`). */
  showOverrideModal: boolean;
  /** Preselected schedule, if the command was invoked with one in context. */
  overrideScheduleId: string | null;

  openOverrideModal: (scheduleId?: string | null) => void;
  closeOverrideModal: () => void;
}

export const useOnCallStore = create<OnCallStoreState>((set) => ({
  showOverrideModal: false,
  overrideScheduleId: null,

  openOverrideModal: (scheduleId = null) =>
    set({ showOverrideModal: true, overrideScheduleId: scheduleId }),
  closeOverrideModal: () => set({ showOverrideModal: false, overrideScheduleId: null }),
}));
