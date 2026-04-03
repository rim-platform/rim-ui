import { create } from "zustand";

interface NotificationSettings {
  enabled: boolean;
  soundEnabled: boolean;
  showPreview: boolean;
  setEnabled: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setShowPreview: (v: boolean) => void;
}

const STORAGE_KEY = "rim:notification-settings";

function loadSettings(): Pick<NotificationSettings, "enabled" | "soundEnabled" | "showPreview"> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
        soundEnabled: typeof parsed.soundEnabled === "boolean" ? parsed.soundEnabled : true,
        showPreview: typeof parsed.showPreview === "boolean" ? parsed.showPreview : true,
      };
    }
  } catch {
    // ignore
  }
  return { enabled: true, soundEnabled: true, showPreview: true };
}

function persist(state: Pick<NotificationSettings, "enabled" | "soundEnabled" | "showPreview">) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const initial = loadSettings();

export const useNotificationSettingsStore = create<NotificationSettings>((set, get) => ({
  ...initial,
  setEnabled: (v) => {
    set({ enabled: v });
    persist({ ...get(), enabled: v });
  },
  setSoundEnabled: (v) => {
    set({ soundEnabled: v });
    persist({ ...get(), soundEnabled: v });
  },
  setShowPreview: (v) => {
    set({ showPreview: v });
    persist({ ...get(), showPreview: v });
  },
}));
