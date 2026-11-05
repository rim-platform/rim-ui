import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";

import { showPluginNotification } from "./pluginNotification";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
  sendNotification: vi.fn(),
}));

vi.mock("../../../shared/toast", () => ({
  toast: { info: vi.fn() },
}));

describe("showPluginNotification", () => {
  beforeEach(() => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    vi.mocked(sendNotification).mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("sends no desktop notification while the person is at the window", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    await showPluginNotification("Poll", "Closed", "Results are in");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends one while the window is hidden, even if it still reports focus", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    await showPluginNotification("Poll", "Closed", "Results are in");
    expect(sendNotification).toHaveBeenCalledWith({
      title: "Poll: Closed",
      body: "Results are in",
    });
  });
});
