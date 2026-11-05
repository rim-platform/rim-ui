import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke,
}));
const accounts = vi.hoisted(() => vi.fn());
vi.mock("../../key-identity/api/keyBackend", () => ({
  keyBackend: () => ({ accounts }),
}));

import { useAuthStore } from "../../auth/state/useAuthStore";
import { dispatchCommand, runDesktopLocalCommand } from "../../commands/runtime/commandDispatcher";
import { LOCAL_COMMANDS } from "../../commands/runtime/localCommands";
import { requestQuit, useQuitConfirmStore } from "../state/useQuitConfirmStore";
import { QuitConfirmHost } from "./QuitConfirmHost";

const NO_MESSAGES = "You won't get messages or notifications until you open it again.";
const NEEDS_PASSWORD = "You'll need your password next time.";

let kept: boolean | Error;

function inDesktopApp(desktop: boolean) {
  const w = window as { __TAURI_INTERNALS__?: unknown };
  if (desktop) w.__TAURI_INTERNALS__ = {};
  else delete w.__TAURI_INTERNALS__;
}

function quitCalls() {
  return invoke.mock.calls.filter(([name]) => name === "desktop_quit");
}

async function openDialog() {
  render(<QuitConfirmHost />);
  await act(() => requestQuit());
  return screen.findByRole("dialog", { name: "Quit RIM?" });
}

describe("the Quit RIM command", () => {
  beforeEach(() => {
    inDesktopApp(true);
    kept = true;
    useAuthStore.setState({ session: { userId: "user-1" } });
    accounts.mockResolvedValue([{ userId: "user-1", principalId: "principal-1" }]);
    invoke.mockImplementation((command: string) => {
      if (command !== "account_is_kept") return Promise.resolve(null);
      return kept instanceof Error ? Promise.reject(kept) : Promise.resolve(kept);
    });
  });

  afterEach(() => {
    inDesktopApp(false);
    act(() => useQuitConfirmStore.getState().close());
    useAuthStore.setState({ session: null });
    invoke.mockReset();
    accounts.mockReset();
  });

  it("opens the confirmation from the command, and Quit quits", async () => {
    const user = userEvent.setup();
    render(<QuitConfirmHost />);
    const command = LOCAL_COMMANDS.find((cmd) => cmd.id === "app.quit");
    expect(command).toBeDefined();
    await act(() => dispatchCommand(command!, vi.fn()));
    await screen.findByRole("dialog", { name: "Quit RIM?" });
    expect(quitCalls()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Quit" }));
    expect(quitCalls()).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms on Enter, the keyboard being on Quit", async () => {
    const user = userEvent.setup();
    await openDialog();
    expect(screen.getByRole("button", { name: "Quit" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(quitCalls()).toHaveLength(1);
  });

  it("Cancel and Escape do not quit", async () => {
    const user = userEvent.setup();
    await openDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(() => requestQuit());
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(quitCalls()).toEqual([]);
  });

  it("the agent's run of the command only opens the confirmation", async () => {
    render(<QuitConfirmHost />);
    act(() => {
      expect(runDesktopLocalCommand("app.quit")).toBe(true);
    });
    await screen.findByRole("dialog", { name: "Quit RIM?" });
    expect(quitCalls()).toEqual([]);
  });

  it("leaves the password out for a kept account", async () => {
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(NO_MESSAGES);
    expect(dialog).not.toHaveTextContent(NEEDS_PASSWORD);
    expect(invoke).toHaveBeenCalledWith("account_is_kept", { principal: "principal-1" });
  });

  it("adds the password for an account that is not kept", async () => {
    kept = false;
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(`${NO_MESSAGES} ${NEEDS_PASSWORD}`);
  });

  it("leaves the password out with no signed-in account", async () => {
    useAuthStore.setState({ session: null });
    expect(await openDialog()).not.toHaveTextContent(NEEDS_PASSWORD);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("leaves the password out when the account cannot be checked", async () => {
    kept = new Error("no vault");
    expect(await openDialog()).not.toHaveTextContent(NEEDS_PASSWORD);
  });

  it("does nothing on the web", async () => {
    inDesktopApp(false);
    render(<QuitConfirmHost />);
    await act(() => requestQuit());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    await waitFor(() => expect(useQuitConfirmStore.getState().request).toBeNull());
  });
});
