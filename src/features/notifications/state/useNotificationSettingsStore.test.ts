import { describe, it, expect, beforeEach } from "vitest";
import { useNotificationSettingsStore } from "./useNotificationSettingsStore";

const DEFAULTS = {
  enabled: true,
  soundEnabled: true,
  preview: "full",
  hideEncryptedText: false,
  title: "conversation",
} as const;

describe("useNotificationSettingsStore", () => {
  beforeEach(() => {
    useNotificationSettingsStore.setState(DEFAULTS);
  });

  it("starts with notifications, sound and full previews under the conversation's name", () => {
    expect(useNotificationSettingsStore.getState()).toMatchObject(DEFAULTS);
  });

  it("sets enabled to false", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    expect(useNotificationSettingsStore.getState().enabled).toBe(false);
  });

  it("sets soundEnabled to false", () => {
    useNotificationSettingsStore.getState().setSoundEnabled(false);
    expect(useNotificationSettingsStore.getState().soundEnabled).toBe(false);
  });

  it("sets the preview, the title and hiding encrypted text", () => {
    const store = useNotificationSettingsStore.getState();
    store.setPreview("sender");
    store.setTitle("both");
    store.setHideEncryptedText(true);
    expect(useNotificationSettingsStore.getState()).toMatchObject({
      preview: "sender",
      title: "both",
      hideEncryptedText: true,
    });
  });

  it("toggling enabled back on", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    useNotificationSettingsStore.getState().setEnabled(true);
    expect(useNotificationSettingsStore.getState().enabled).toBe(true);
  });

  it("settings changes are independent", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    expect(useNotificationSettingsStore.getState()).toMatchObject({
      soundEnabled: true,
      preview: "full",
      title: "conversation",
    });
  });
});
