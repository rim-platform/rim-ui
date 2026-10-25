import { create } from "zustand";

/** How much of a message a notification shows: sender and text, the sender, or neither. */
export type NotificationPreview = "full" | "sender" | "none";

/** What a message notification's title names. */
export type NotificationTitle = "conversation" | "sender" | "both";

/** How this device's message notifications look. */
export interface NotificationStyle {
  preview: NotificationPreview;
  /** End-to-end encrypted messages show only the sender, whatever `preview` allows. */
  hideEncryptedText: boolean;
  title: NotificationTitle;
}

interface StoredSettings extends NotificationStyle {
  enabled: boolean;
  soundEnabled: boolean;
}

interface NotificationSettings extends StoredSettings {
  setEnabled: (v: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setPreview: (v: NotificationPreview) => void;
  setHideEncryptedText: (v: boolean) => void;
  setTitle: (v: NotificationTitle) => void;
}

const STORAGE_KEY = "rim:notification-settings";

const PREVIEWS: readonly NotificationPreview[] = ["full", "sender", "none"];
const TITLES: readonly NotificationTitle[] = ["conversation", "sender", "both"];

const DEFAULTS: StoredSettings = {
  enabled: true,
  soundEnabled: true,
  preview: "full",
  hideEncryptedText: false,
  title: "conversation",
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((a) => a === value);
}

/** The stored settings; an older `showPreview` switch reads as `full` or `sender`. */
function loadSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const legacyPreview =
        typeof parsed.showPreview === "boolean"
          ? parsed.showPreview
            ? "full"
            : "sender"
          : undefined;
      return {
        enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULTS.enabled,
        soundEnabled:
          typeof parsed.soundEnabled === "boolean" ? parsed.soundEnabled : DEFAULTS.soundEnabled,
        preview: oneOf(parsed.preview, PREVIEWS) ?? legacyPreview ?? DEFAULTS.preview,
        hideEncryptedText:
          typeof parsed.hideEncryptedText === "boolean"
            ? parsed.hideEncryptedText
            : DEFAULTS.hideEncryptedText,
        title: oneOf(parsed.title, TITLES) ?? DEFAULTS.title,
      };
    }
  } catch {
    // ignore
  }
  return DEFAULTS;
}

function persist(state: StoredSettings) {
  const { enabled, soundEnabled, preview, hideEncryptedText, title } = state;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ enabled, soundEnabled, preview, hideEncryptedText, title }),
    );
  } catch {
    // ignore
  }
}

/** The look of message notifications out of the device settings. */
export function notificationStyle(settings: NotificationStyle): NotificationStyle {
  const { preview, hideEncryptedText, title } = settings;
  return { preview, hideEncryptedText, title };
}

const initial = loadSettings();

export const useNotificationSettingsStore = create<NotificationSettings>((set, get) => {
  function update(patch: Partial<StoredSettings>) {
    set(patch);
    persist({ ...get(), ...patch });
  }
  return {
    ...initial,
    setEnabled: (v) => update({ enabled: v }),
    setSoundEnabled: (v) => update({ soundEnabled: v }),
    setPreview: (v) => update({ preview: v }),
    setHideEncryptedText: (v) => update({ hideEncryptedText: v }),
    setTitle: (v) => update({ title: v }),
  };
});
