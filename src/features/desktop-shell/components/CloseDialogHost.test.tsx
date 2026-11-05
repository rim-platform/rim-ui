import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke,
}));
const events = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: { id: number } }) => void>(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: { id: number } }) => void) => {
    events.listeners.set(name, handler);
    return Promise.resolve(events.unlisten);
  }),
}));

import { RuntimeProvider } from "../../../core/runtime/RuntimeProvider";
import { CloseDialogHost } from "./CloseDialogHost";

const NO_TRAY =
  "Your desktop doesn't show tray icons. RIM keeps running; open RIM again to bring the window back.";

let trayAvailable: boolean;

function inDesktopApp(desktop: boolean) {
  const w = window as { __TAURI_INTERNALS__?: unknown };
  if (desktop) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

function commandCalls(command: string) {
  return invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
}

async function renderHost() {
  render(
    <RuntimeProvider>
      <CloseDialogHost />
    </RuntimeProvider>,
  );
  await waitFor(() => expect(events.listeners.has("desktop://close-requested")).toBe(true));
}

async function requestClose(id: number) {
  await act(async () => {
    events.listeners.get("desktop://close-requested")?.({ payload: { id } });
    await Promise.resolve();
  });
}

async function openDialog(id = 1) {
  await requestClose(id);
  return screen.findByRole("dialog", { name: "Keep RIM running in the tray?" });
}

describe("CloseDialogHost", () => {
  beforeEach(() => {
    inDesktopApp(true);
    trayAvailable = true;
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === "desktop_tray_available" ? trayAvailable : null),
    );
  });

  afterEach(() => {
    inDesktopApp(false);
    invoke.mockReset();
    events.listeners.clear();
    events.unlisten.mockClear();
  });

  it("does not listen or render on the web", async () => {
    inDesktopApp(false);
    render(
      <RuntimeProvider>
        <CloseDialogHost />
      </RuntimeProvider>,
    );
    await act(() => Promise.resolve());
    expect(events.listeners.size).toBe(0);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("acknowledges each request with its id, and stops listening when it goes", async () => {
    const { unmount } = render(
      <RuntimeProvider>
        <CloseDialogHost />
      </RuntimeProvider>,
    );
    await waitFor(() => expect(events.listeners.size).toBe(1));
    await openDialog(7);
    expect(commandCalls("desktop_close_ack")).toEqual([{ id: 7 }]);
    unmount();
    expect(events.unlisten).toHaveBeenCalled();
  });

  it("shows the question with the box ticked and the keyboard on Keep in tray", async () => {
    await renderHost();
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(
      "You'll keep getting messages and notifications while the window is closed.",
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Don't ask again (you can change this in Settings > Desktop)",
      }),
    ).toBeChecked();
    expect(screen.getByRole("button", { name: "Keep in tray" })).toHaveFocus();
    expect(dialog).not.toHaveTextContent(NO_TRAY);
  });

  it("adds the no-tray sentence when the desktop shows no tray icons", async () => {
    trayAvailable = false;
    await renderHost();
    expect(await openDialog()).toHaveTextContent(NO_TRAY);
  });

  it.each([
    ["Keep in tray", "tray"],
    ["Quit RIM", "quit"],
  ])("%s remembers the choice while the box is ticked", async (name, choice) => {
    const user = userEvent.setup();
    await renderHost();
    await openDialog();
    await user.click(screen.getByRole("button", { name }));
    expect(commandCalls("desktop_close_choose")).toEqual([{ choice, remember: true }]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["Keep in tray", "tray"],
    ["Quit RIM", "quit"],
  ])("%s applies once when the box is unticked", async (name, choice) => {
    const user = userEvent.setup();
    await renderHost();
    await openDialog();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name }));
    expect(commandCalls("desktop_close_choose")).toEqual([{ choice, remember: false }]);
  });

  it("Cancel closes the dialog with no command", async () => {
    const user = userEvent.setup();
    await renderHost();
    await openDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(commandCalls("desktop_close_choose")).toEqual([]);
  });

  it("Escape closes the dialog with no command", async () => {
    const user = userEvent.setup();
    await renderHost();
    await openDialog();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(commandCalls("desktop_close_choose")).toEqual([]);
  });

  it("a second request while open only acknowledges", async () => {
    const user = userEvent.setup();
    await renderHost();
    await openDialog(1);
    await user.click(screen.getByRole("checkbox"));
    await requestClose(2);
    expect(commandCalls("desktop_close_ack")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(commandCalls("desktop_tray_available")).toHaveLength(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("asks afresh, box ticked, after a cancel", async () => {
    const user = userEvent.setup();
    await renderHost();
    await openDialog(1);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await openDialog(2);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(commandCalls("desktop_tray_available")).toHaveLength(2);
  });

  it("still asks when the tray check fails", async () => {
    invoke.mockImplementation((command: string) =>
      command === "desktop_tray_available"
        ? Promise.reject(new Error("no answer"))
        : Promise.resolve(null),
    );
    await renderHost();
    expect(await openDialog()).not.toHaveTextContent(NO_TRAY);
  });
});
