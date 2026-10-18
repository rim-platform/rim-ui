import { beforeEach, describe, expect, it, vi } from "vitest";

const safeInvokeMock = vi.fn();
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => safeInvokeMock(...args),
}));

import { webPluginHost } from "../web/webPluginHost";
import { resetPluginSettings, savePluginSettings } from "./usePluginSettings";

describe("desktop plugin settings saves", () => {
  beforeEach(() => {
    safeInvokeMock.mockReset();
    vi.restoreAllMocks();
  });

  it("tell the web plugin host after the desktop host saved or reset them", async () => {
    const changed = vi.spyOn(webPluginHost, "settingsChanged");
    safeInvokeMock.mockResolvedValue({ ok: true, value: null });
    await savePluginSettings("desktop", "dev.example.web", { namespace: "prod" });
    await resetPluginSettings("desktop", "dev.example.web");
    expect(safeInvokeMock.mock.calls.map((call) => call[0])).toEqual([
      "plugin_settings_save",
      "plugin_settings_reset",
    ]);
    expect(changed.mock.calls).toEqual([["dev.example.web"], ["dev.example.web"]]);
  });

  it("tell nobody when the desktop host refused the save", async () => {
    const changed = vi.spyOn(webPluginHost, "settingsChanged");
    safeInvokeMock.mockResolvedValue({
      ok: false,
      error: { kind: "backend_error", code: "INVALID_SETTING_VALUE", message: "no" },
    });
    await expect(
      savePluginSettings("desktop", "dev.example.web", { namespace: 1 }),
    ).rejects.toThrow("no");
    expect(changed).not.toHaveBeenCalled();
  });
});
