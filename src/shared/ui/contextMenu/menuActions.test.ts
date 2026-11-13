import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: () => Promise.reject(new Error("not running in Tauri")),
}));

import { openExternalUrl } from "./menuActions";

describe("openExternalUrl", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the link in the browser without handing the page its opener", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openExternalUrl("https://example.org/page");
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith("https://example.org/page", "_blank", "noopener,noreferrer");
  });
});
