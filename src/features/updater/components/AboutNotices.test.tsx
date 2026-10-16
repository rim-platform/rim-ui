import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const runtime = vi.hoisted(() => ({ platform: "desktop" as "desktop" | "web" }));
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({ platform: runtime.platform }),
}));

const resolveResource = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/path", () => ({ resolveResource }));
const openPath = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath }));

import { NOTICES_RESOURCE, RELEASE_NOTICES_URL } from "../api/noticesApi";
import { AboutNotices } from "./AboutNotices";

beforeEach(() => {
  runtime.platform = "desktop";
  resolveResource.mockReset().mockImplementation(async (p: string) => `/usr/lib/RIM/${p}`);
  openPath.mockReset().mockResolvedValue(undefined);
});

describe("AboutNotices", () => {
  it("opens the notices bundled with the desktop app", async () => {
    const user = userEvent.setup();
    render(<AboutNotices />);

    await user.click(screen.getByRole("button", { name: "Open notices" }));

    expect(resolveResource).toHaveBeenCalledWith(NOTICES_RESOURCE);
    expect(openPath).toHaveBeenCalledWith(`/usr/lib/RIM/${NOTICES_RESOURCE}`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the bundled notices cannot be opened", async () => {
    openPath.mockRejectedValue(new Error("no application opens .txt files"));
    const user = userEvent.setup();
    render(<AboutNotices />);

    await user.click(screen.getByRole("button", { name: "Open notices" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The notices could not be opened: no application opens .txt files",
    );
  });

  it("links the web app to the notices attached to each release", () => {
    runtime.platform = "web";
    render(<AboutNotices />);

    expect(screen.getByRole("link", { name: "Open notices" })).toHaveAttribute(
      "href",
      RELEASE_NOTICES_URL,
    );
    expect(screen.getByText(/web app's notices are the same file/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
