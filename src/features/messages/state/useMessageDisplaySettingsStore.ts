import { create } from "zustand";

interface StoredSettings {
  /** Images and videos render inline; off shows file chips and links only. */
  showInlineMedia: boolean;
  /** Conversations stay unread until they are marked read, whatever was read of them. */
  markReadByHand: boolean;
}

interface MessageDisplaySettings extends StoredSettings {
  setShowInlineMedia: (value: boolean) => void;
  setMarkReadByHand: (value: boolean) => void;
}

const STORAGE_KEY = "rim:message-display-settings";

const DEFAULTS: StoredSettings = { showInlineMedia: true, markReadByHand: false };

function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const stored = parsed as Partial<Record<keyof StoredSettings, unknown>>;
        return {
          showInlineMedia:
            typeof stored.showInlineMedia === "boolean"
              ? stored.showInlineMedia
              : DEFAULTS.showInlineMedia,
          markReadByHand:
            typeof stored.markReadByHand === "boolean"
              ? stored.markReadByHand
              : DEFAULTS.markReadByHand,
        };
      }
    }
  } catch {
    // Unreadable storage keeps the defaults.
  }
  return DEFAULTS;
}

function saveSettings({ showInlineMedia, markReadByHand }: StoredSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ showInlineMedia, markReadByHand }));
  } catch {
    // Storage full or unavailable: the choice holds for this session.
  }
}

/** How messages render and count as read on this device, kept in local storage. */
export const useMessageDisplaySettingsStore = create<MessageDisplaySettings>((set, get) => ({
  ...loadSettings(),
  setShowInlineMedia: (value) => {
    set({ showInlineMedia: value });
    saveSettings(get());
  },
  setMarkReadByHand: (value) => {
    set({ markReadByHand: value });
    saveSettings(get());
  },
}));
