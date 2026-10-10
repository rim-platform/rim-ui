import { create } from "zustand";

interface MessageDisplaySettings {
  /** Images and videos render inline; off shows file chips and links only. */
  showInlineMedia: boolean;
  setShowInlineMedia: (value: boolean) => void;
}

const STORAGE_KEY = "rim:message-display-settings";

function loadShowInlineMedia(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === "object" &&
        "showInlineMedia" in parsed &&
        typeof parsed.showInlineMedia === "boolean"
      ) {
        return parsed.showInlineMedia;
      }
    }
  } catch {
    // Unreadable storage keeps the default.
  }
  return true;
}

/** How messages render on this device, kept in local storage. */
export const useMessageDisplaySettingsStore = create<MessageDisplaySettings>((set) => ({
  showInlineMedia: loadShowInlineMedia(),
  setShowInlineMedia: (value) => {
    set({ showInlineMedia: value });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ showInlineMedia: value }));
    } catch {
      // Storage full or unavailable: the choice holds for this session.
    }
  },
}));
