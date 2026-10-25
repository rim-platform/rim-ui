import { describe, it, expect, beforeEach, vi } from "vitest";
import { useNotificationSettingsStore } from "./useNotificationSettingsStore";

const KEY = "rim:notification-settings";

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(KEY) ?? "{}");
}

/** The store as a fresh start reads it from what local storage holds. */
async function loadWith(saved: unknown) {
  localStorage.setItem(KEY, JSON.stringify(saved));
  vi.resetModules();
  const fresh = await import("./useNotificationSettingsStore");
  return fresh.useNotificationSettingsStore.getState();
}

describe("useNotificationSettingsStore (extra coverage)", () => {
  beforeEach(() => {
    localStorage.clear();
    useNotificationSettingsStore.setState({
      enabled: true,
      soundEnabled: true,
      preview: "full",
      hideEncryptedText: false,
      title: "conversation",
    });
  });

  it("setEnabled updates enabled and persists to localStorage", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    expect(useNotificationSettingsStore.getState().enabled).toBe(false);
    expect(stored().enabled).toBe(false);
  });

  it("setSoundEnabled updates soundEnabled and persists", () => {
    useNotificationSettingsStore.getState().setSoundEnabled(false);
    expect(stored().soundEnabled).toBe(false);
  });

  it("persists all settings together", () => {
    const store = useNotificationSettingsStore.getState();
    store.setEnabled(false);
    store.setSoundEnabled(false);
    store.setPreview("none");
    store.setHideEncryptedText(true);
    store.setTitle("sender");

    expect(stored()).toEqual({
      enabled: false,
      soundEnabled: false,
      preview: "none",
      hideEncryptedText: true,
      title: "sender",
    });
  });

  it("reads back what it stored", async () => {
    const state = await loadWith({
      enabled: true,
      soundEnabled: false,
      preview: "sender",
      hideEncryptedText: true,
      title: "both",
    });
    expect(state).toMatchObject({
      soundEnabled: false,
      preview: "sender",
      hideEncryptedText: true,
      title: "both",
    });
  });

  it("reads an older preview switch: off is sender only, on is the full preview", async () => {
    expect((await loadWith({ showPreview: false })).preview).toBe("sender");
    expect((await loadWith({ showPreview: true })).preview).toBe("full");
  });

  it("falls back to the defaults for values it does not know", async () => {
    const state = await loadWith({ preview: "loud", title: 3, hideEncryptedText: "yes" });
    expect(state).toMatchObject({
      preview: "full",
      title: "conversation",
      hideEncryptedText: false,
    });
  });
});
