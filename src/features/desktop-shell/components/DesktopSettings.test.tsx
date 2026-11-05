import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke,
}));
vi.mock("../../../shared/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { toast } from "../../../shared/toast";
import { DesktopSettings } from "./DesktopSettings";

const NO_TRAY =
  "Your desktop doesn't show tray icons. RIM keeps running; open RIM again to bring the window back.";

let stored: string;
let trayAvailable: boolean;
let saveFails: boolean;

function setCalls() {
  return invoke.mock.calls.filter(([name]) => name === "desktop_set_close_action");
}

async function renderedSelect() {
  render(<DesktopSettings />);
  const select = screen.getByRole("combobox", { name: "When I close the window" });
  await waitFor(() => expect(select).toBeEnabled());
  return select;
}

describe("DesktopSettings", () => {
  beforeEach(() => {
    stored = "ask";
    trayAvailable = true;
    saveFails = false;
    invoke.mockImplementation((command: string, args?: { action?: string }) => {
      switch (command) {
        case "desktop_close_action":
          return Promise.resolve(stored);
        case "desktop_tray_available":
          return Promise.resolve(trayAvailable);
        case "desktop_set_close_action":
          if (saveFails) return Promise.reject("disk full");
          stored = args?.action ?? stored;
          return Promise.resolve(null);
        default:
          return Promise.reject(new Error(`unexpected ${command}`));
      }
    });
  });

  afterEach(() => {
    invoke.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("reads the setting and offers the three answers", async () => {
    stored = "tray";
    const select = await renderedSelect();
    expect(select).toHaveValue("tray");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Ask",
      "Keep running in the tray",
      "Quit RIM",
    ]);
  });

  it("writes the setting on a change", async () => {
    const user = userEvent.setup();
    const select = await renderedSelect();
    await user.selectOptions(select, "quit");
    expect(setCalls()).toEqual([["desktop_set_close_action", { action: "quit" }]]);
    expect(select).toHaveValue("quit");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("goes back and says so when the setting cannot be saved", async () => {
    saveFails = true;
    const user = userEvent.setup();
    const select = await renderedSelect();
    await user.selectOptions(select, "tray");
    await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
    expect(select).toHaveValue("ask");
  });

  it("adds the no-tray sentence only when the desktop shows no tray icons", async () => {
    await renderedSelect();
    await waitFor(() =>
      expect(invoke.mock.calls.some(([name]) => name === "desktop_tray_available")).toBe(true),
    );
    expect(screen.queryByText(NO_TRAY)).not.toBeInTheDocument();
  });

  it("shows the no-tray sentence", async () => {
    trayAvailable = false;
    render(<DesktopSettings />);
    expect(await screen.findByText(NO_TRAY)).toBeInTheDocument();
  });
});
