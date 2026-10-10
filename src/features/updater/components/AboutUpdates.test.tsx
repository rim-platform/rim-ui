import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const runtime = { platform: "desktop", capabilities: { updater: true } };

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => runtime,
}));

vi.mock("../api/updaterApi", () => ({
  BUILD_VERSION: "0.1.0",
  fetchUpdaterConfigured: vi.fn(),
  checkForUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  readClientVersion: vi.fn(),
}));

import { checkForUpdate, fetchUpdaterConfigured, readClientVersion } from "../api/updaterApi";
import { initialUpdaterData, useUpdaterStore } from "../state/useUpdaterStore";
import { fakeUpdate } from "../../../test/fakeUpdate";
import { AboutUpdates, AboutVersion } from "./AboutUpdates";

const mockConfigured = vi.mocked(fetchUpdaterConfigured);
const mockCheck = vi.mocked(checkForUpdate);
const mockVersion = vi.mocked(readClientVersion);

describe("AboutVersion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows the desktop shell's version", async () => {
    runtime.platform = "desktop";
    mockVersion.mockResolvedValue("1.4.2");
    render(<AboutVersion />);
    expect(await screen.findByText("Version 1.4.2")).toBeInTheDocument();
  });

  it("shows the bundle's version on the web", () => {
    runtime.platform = "web";
    render(<AboutVersion />);
    expect(screen.getByText("Version 0.1.0")).toBeInTheDocument();
    expect(mockVersion).not.toHaveBeenCalled();
  });
});

describe("AboutUpdates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useUpdaterStore.setState(initialUpdaterData);
    runtime.platform = "desktop";
    runtime.capabilities.updater = true;
  });

  it("renders nothing on the web", () => {
    runtime.platform = "web";
    runtime.capabilities.updater = false;
    const { container } = render(<AboutUpdates />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says updates are not configured in this build", async () => {
    mockConfigured.mockResolvedValue(false);
    render(<AboutUpdates />);
    expect(await screen.findByText("Updates are not configured in this build")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("checks, offers the new version with notes, downloads and offers a restart", async () => {
    const fake = fakeUpdate("0.2.0", "Faster startup.");
    mockConfigured.mockResolvedValue(true);
    mockCheck.mockResolvedValue(fake.update);
    const user = userEvent.setup();
    render(<AboutUpdates />);

    await user.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByText("Version 0.2.0 is available.")).toBeInTheDocument();
    expect(screen.getByText("Faster startup.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download update" }));
    fake.emit({ event: "Started", data: { contentLength: 100 } });
    fake.emit({ event: "Progress", data: { chunkLength: 30 } });
    const bar = await screen.findByRole("progressbar", { name: "Update download" });
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "30"));

    fake.finishDownload();
    expect(await screen.findByRole("button", { name: "Restart to update" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("says when the app is up to date", async () => {
    mockConfigured.mockResolvedValue(true);
    mockCheck.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<AboutUpdates />);

    await user.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByTestId("updater-summary")).toHaveTextContent(
      "You have the latest version.",
    );
  });

  it("shows why a check failed", async () => {
    mockConfigured.mockResolvedValue(true);
    mockCheck.mockRejectedValue("network unreachable");
    const user = userEvent.setup();
    render(<AboutUpdates />);

    await user.click(await screen.findByRole("button", { name: "Check for updates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("network unreachable");
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeEnabled();
  });
});
