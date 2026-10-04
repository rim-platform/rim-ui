import { describe, it, expect, beforeEach } from "vitest";
import { useNotificationSettingsStore } from "./useNotificationSettingsStore";

describe("useNotificationSettingsStore", () => {
  beforeEach(() => {
    useNotificationSettingsStore.setState({
      enabled: true,
      soundEnabled: true,
      showPreview: true,
    });
  });

  it("starts with all settings enabled by default", () => {
    const state = useNotificationSettingsStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.soundEnabled).toBe(true);
    expect(state.showPreview).toBe(true);
  });

  it("sets enabled to false", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    expect(useNotificationSettingsStore.getState().enabled).toBe(false);
  });

  it("sets soundEnabled to false", () => {
    useNotificationSettingsStore.getState().setSoundEnabled(false);
    expect(useNotificationSettingsStore.getState().soundEnabled).toBe(false);
  });

  it("sets showPreview to false", () => {
    useNotificationSettingsStore.getState().setShowPreview(false);
    expect(useNotificationSettingsStore.getState().showPreview).toBe(false);
  });

  it("toggling enabled back on", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    useNotificationSettingsStore.getState().setEnabled(true);
    expect(useNotificationSettingsStore.getState().enabled).toBe(true);
  });

  it("settings changes are independent", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    expect(useNotificationSettingsStore.getState().soundEnabled).toBe(true);
    expect(useNotificationSettingsStore.getState().showPreview).toBe(true);
  });
});
