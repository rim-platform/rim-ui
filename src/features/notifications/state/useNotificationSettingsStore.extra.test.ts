import { describe, it, expect, beforeEach, vi } from "vitest";
import { useNotificationSettingsStore } from "./useNotificationSettingsStore";

describe("useNotificationSettingsStore (extra coverage)", () => {
  beforeEach(() => {
    localStorage.clear();
    useNotificationSettingsStore.setState({
      enabled: true,
      soundEnabled: true,
      showPreview: true,
    });
  });

  it("has correct defaults", () => {
    const state = useNotificationSettingsStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.soundEnabled).toBe(true);
    expect(state.showPreview).toBe(true);
  });

  it("setEnabled updates enabled and persists to localStorage", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    expect(useNotificationSettingsStore.getState().enabled).toBe(false);

    const stored = JSON.parse(localStorage.getItem("rim:notification-settings") ?? "{}");
    expect(stored.enabled).toBe(false);
  });

  it("setSoundEnabled updates soundEnabled and persists", () => {
    useNotificationSettingsStore.getState().setSoundEnabled(false);
    expect(useNotificationSettingsStore.getState().soundEnabled).toBe(false);

    const stored = JSON.parse(localStorage.getItem("rim:notification-settings") ?? "{}");
    expect(stored.soundEnabled).toBe(false);
  });

  it("setShowPreview updates showPreview and persists", () => {
    useNotificationSettingsStore.getState().setShowPreview(false);
    expect(useNotificationSettingsStore.getState().showPreview).toBe(false);

    const stored = JSON.parse(localStorage.getItem("rim:notification-settings") ?? "{}");
    expect(stored.showPreview).toBe(false);
  });

  it("persists all settings together", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    useNotificationSettingsStore.getState().setSoundEnabled(false);
    useNotificationSettingsStore.getState().setShowPreview(false);

    const stored = JSON.parse(localStorage.getItem("rim:notification-settings") ?? "{}");
    expect(stored.enabled).toBe(false);
    expect(stored.soundEnabled).toBe(false);
    expect(stored.showPreview).toBe(false);
  });

  it("settings can be toggled back on", () => {
    useNotificationSettingsStore.getState().setEnabled(false);
    useNotificationSettingsStore.getState().setEnabled(true);
    expect(useNotificationSettingsStore.getState().enabled).toBe(true);
  });
});
