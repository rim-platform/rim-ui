import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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
const START_AT_LOGIN = "Start RIM when I sign in to this computer";
const APP_IMAGE_SENTENCE =
  "If you move the RIM AppImage, open it once so it starts from the new place.";
const READ_FAILED_SENTENCE = "RIM can't check this setting on this computer.";
const REFUSED_SENTENCE =
  "RIM can't start at sign-in from this folder, because its path contains a character the desktop can't start. Move RIM to another folder.";

let stored: string;
let trayAvailable: boolean;
let saveFails: boolean;
let startAtLogin: { enabled: boolean; appImage: boolean; pathAllowed: boolean };
let startAtLoginReadFails: boolean;
let startAtLoginSaveFails: boolean;

function setCalls() {
  return invoke.mock.calls.filter(([name]) => name === "desktop_set_close_action");
}

function startAtLoginSetCalls() {
  return invoke.mock.calls.filter(([name]) => name === "desktop_set_start_at_login");
}

async function renderedSwitch() {
  render(<DesktopSettings />);
  const toggle = screen.getByRole("switch", { name: START_AT_LOGIN });
  await waitFor(() => expect(toggle).toBeEnabled());
  return toggle;
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
    startAtLogin = { enabled: false, appImage: false, pathAllowed: true };
    startAtLoginReadFails = false;
    startAtLoginSaveFails = false;
    invoke.mockImplementation((command: string, args?: { action?: string; enabled?: boolean }) => {
      switch (command) {
        case "desktop_close_action":
          return Promise.resolve(stored);
        case "desktop_tray_available":
          return Promise.resolve(trayAvailable);
        case "desktop_set_close_action":
          if (saveFails) return Promise.reject("disk full");
          stored = args?.action ?? stored;
          return Promise.resolve(null);
        case "desktop_start_at_login":
          if (startAtLoginReadFails) return Promise.reject("no home directory");
          return Promise.resolve(startAtLogin);
        case "desktop_set_start_at_login":
          if (startAtLoginSaveFails) return Promise.reject("not a directory");
          startAtLogin = { ...startAtLogin, enabled: args?.enabled ?? startAtLogin.enabled };
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

  it("disables the start-at-login switch until the state is read", async () => {
    render(<DesktopSettings />);
    const toggle = screen.getByRole("switch", { name: START_AT_LOGIN });
    expect(toggle).toBeDisabled();
    await waitFor(() => expect(toggle).toBeEnabled());
  });

  it("reads start at login as off", async () => {
    const toggle = await renderedSwitch();
    expect(toggle).not.toBeChecked();
  });

  it("reads start at login as on", async () => {
    startAtLogin = { enabled: true, appImage: false, pathAllowed: true };
    const toggle = await renderedSwitch();
    expect(toggle).toBeChecked();
  });

  it("turns start at login on", async () => {
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    await user.click(toggle);
    expect(startAtLoginSetCalls()).toEqual([["desktop_set_start_at_login", { enabled: true }]]);
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toBeChecked();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("turns start at login off", async () => {
    startAtLogin = { enabled: true, appImage: false, pathAllowed: true };
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    await user.click(toggle);
    expect(startAtLoginSetCalls()).toEqual([["desktop_set_start_at_login", { enabled: false }]]);
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("ignores a second press during a save and keeps the switch enabled", async () => {
    let finish: (value: null) => void = () => {};
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(toggle);
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(startAtLoginSetCalls()).toEqual([["desktop_set_start_at_login", { enabled: true }]]);
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
    await act(async () => finish(null));
    await user.click(toggle);
    expect(startAtLoginSetCalls()).toHaveLength(2);
    expect(startAtLoginSetCalls()[1]).toEqual(["desktop_set_start_at_login", { enabled: false }]);
  });

  it("puts the switch back and says so when saving fails", async () => {
    startAtLoginSaveFails = true;
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    await user.click(toggle);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The setting could not be saved"));
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
  });

  it("keeps the switch off and disabled and says so when reading fails", async () => {
    startAtLoginReadFails = true;
    render(<DesktopSettings />);
    expect(await screen.findByText(READ_FAILED_SENTENCE)).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: START_AT_LOGIN });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
  });

  it("shows the AppImage sentence for an AppImage, on or off", async () => {
    startAtLogin = { enabled: false, appImage: true, pathAllowed: true };
    const { unmount } = render(<DesktopSettings />);
    expect(await screen.findByText(APP_IMAGE_SENTENCE)).toBeInTheDocument();
    unmount();
    startAtLogin = { enabled: true, appImage: true, pathAllowed: true };
    render(<DesktopSettings />);
    expect(await screen.findByText(APP_IMAGE_SENTENCE)).toBeInTheDocument();
  });

  it("disables the switch and says so when the path is refused and the switch is off", async () => {
    startAtLogin = { enabled: false, appImage: false, pathAllowed: false };
    render(<DesktopSettings />);
    expect(await screen.findByText(REFUSED_SENTENCE)).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: START_AT_LOGIN });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(startAtLoginSetCalls()).toEqual([]);
  });

  it("says so and keeps the switch usable when the path is refused and the switch is on", async () => {
    startAtLogin = { enabled: true, appImage: false, pathAllowed: false };
    const toggle = await renderedSwitch();
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.getByText(REFUSED_SENTENCE)).toBeInTheDocument();
  });

  it("lets an existing entry be turned off from a refused path", async () => {
    startAtLogin = { enabled: true, appImage: false, pathAllowed: false };
    const user = userEvent.setup();
    const toggle = await renderedSwitch();
    await user.click(toggle);
    expect(startAtLoginSetCalls()).toEqual([["desktop_set_start_at_login", { enabled: false }]]);
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(REFUSED_SENTENCE)).toBeInTheDocument();
  });

  it("shows no refusal for an allowed path", async () => {
    await renderedSwitch();
    expect(screen.queryByText(REFUSED_SENTENCE)).not.toBeInTheDocument();
  });

  it("leaves out the AppImage sentence otherwise", async () => {
    await renderedSwitch();
    expect(screen.queryByText(APP_IMAGE_SENTENCE)).not.toBeInTheDocument();
    expect(screen.queryByText(READ_FAILED_SENTENCE)).not.toBeInTheDocument();
  });
});
