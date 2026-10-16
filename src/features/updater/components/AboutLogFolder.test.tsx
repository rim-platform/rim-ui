import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const runtime = vi.hoisted(() => ({ platform: "desktop" as "desktop" | "web" }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ platform: runtime.platform }),
}));

const appLogDir = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/path", () => ({ appLogDir }));
const openPath = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath }));

import { AboutLogFolder } from "./AboutLogFolder";

beforeEach(() => {
  runtime.platform = "desktop";
  appLogDir.mockReset().mockResolvedValue("/home/me/.local/share/com.rim.rim-ui/logs");
  openPath.mockReset().mockResolvedValue(undefined);
});

describe("AboutLogFolder", () => {
  it("opens the app's log folder on the desktop", async () => {
    const user = userEvent.setup();
    render(<AboutLogFolder />);

    await user.click(screen.getByRole("button", { name: "Open log folder" }));

    expect(openPath).toHaveBeenCalledWith("/home/me/.local/share/com.rim.rim-ui/logs");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the folder cannot be opened", async () => {
    openPath.mockRejectedValue(new Error("not allowed"));
    const user = userEvent.setup();
    render(<AboutLogFolder />);

    await user.click(screen.getByRole("button", { name: "Open log folder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The log folder could not be opened: not allowed",
    );
  });

  it("shows nothing on the web, which keeps no log file", () => {
    runtime.platform = "web";
    const { container } = render(<AboutLogFolder />);
    expect(container).toBeEmptyDOMElement();
  });
});
