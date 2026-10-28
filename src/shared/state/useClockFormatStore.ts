import { create } from "zustand";

/** How times of day are written: the browser's language decides, or a fixed 12-hour or 24-hour clock. */
export type ClockFormat = "auto" | "12h" | "24h";

interface ClockFormatState {
  clockFormat: ClockFormat;
  setClockFormat: (value: ClockFormat) => void;
}

const STORAGE_KEY = "rim:clock-format";

function isClockFormat(value: unknown): value is ClockFormat {
  return value === "auto" || value === "12h" || value === "24h";
}

function loadClockFormat(): ClockFormat {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "clockFormat" in parsed) {
        if (isClockFormat(parsed.clockFormat)) return parsed.clockFormat;
      }
    }
  } catch {
    // Unreadable storage keeps the default.
  }
  return "auto";
}

/** The clock choice for this device, kept in local storage. */
export const useClockFormatStore = create<ClockFormatState>((set) => ({
  clockFormat: loadClockFormat(),
  setClockFormat: (value) => {
    set({ clockFormat: value });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ clockFormat: value }));
    } catch {
      // Storage full or unavailable: the choice holds for this session.
    }
  },
}));
