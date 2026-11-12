import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createKeybind: vi.fn(),
  updateKeybind: vi.fn(),
  deleteKeybind: vi.fn(),
  invalidateKeybinds: vi.fn(),
}));

vi.mock("../api/useKeybindSettings", () => api);

vi.mock("../../../shared/toast", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import { queryKeys } from "../../../core/query/keys";
import { toast } from "../../../shared/toast";
import { fakeServerInfo } from "../../../test/serverInfo";
import { useAuthStore } from "../../auth/state/useAuthStore";
import { APP_COMMAND_KEYBINDS } from "../../updater/api/serverCapabilities";
import { useDeviceKeybindStore } from "../state/useDeviceKeybindStore";
import type { ResolvedKeybind } from "../types";
import {
  APP_KEYBINDS_MOVED_MESSAGE,
  appKeybindAccount,
  appKeybindsMoved,
  forgetAppKeybindMove,
  moveAppKeybindsToServer,
  useAppKeybindMove,
} from "./appKeybindMove";

function deviceKeybind(id: string, commandId: string, overrides: Partial<ResolvedKeybind> = {}) {
  return {
    id: `device:${id}`,
    keystroke: `Ctrl+${id.toUpperCase()}`,
    commandId,
    context: "GLOBAL" as const,
    source: "USER" as const,
    scope: "USER" as const,
    isEnabled: true,
    presetArgs: null,
    ...overrides,
  };
}

const ZEN = deviceKeybind("z", "workspace.toggle_zen_mode");
const QUIT = deviceKeybind("q", "app.quit", { context: "COMPOSER", isEnabled: false });
const PLUGIN = deviceKeybind("p", "plugin.chat.rim.k8s-pods.refresh");
const PANEL = deviceKeybind("o", "workspace.open_plugin_panel.chat.rim.k8s-pods/pods");

const ACCOUNT = "https://rim.example:user-1";

describe("moveAppKeybindsToServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    let next = 0;
    api.createKeybind.mockImplementation(async (input: { keystroke: string }) => ({
      id: `kb-${++next}`,
      ...input,
    }));
    api.updateKeybind.mockResolvedValue({});
    api.deleteKeybind.mockResolvedValue(undefined);
    useDeviceKeybindStore.setState({ keybinds: [ZEN, QUIT, PLUGIN, PANEL] });
  });

  afterEach(() => {
    useDeviceKeybindStore.setState({ keybinds: [] });
    localStorage.clear();
  });

  it("moves app command keybinds with their keys, context and state, and keeps plugin ones", async () => {
    expect(await moveAppKeybindsToServer(ACCOUNT)).toBe(2);

    expect(api.createKeybind.mock.calls.map(([input]) => input)).toEqual([
      {
        scope: "USER",
        keystroke: "Ctrl+Z",
        commandId: "workspace.toggle_zen_mode",
        context: "GLOBAL",
      },
      { scope: "USER", keystroke: "Ctrl+Q", commandId: "app.quit", context: "COMPOSER" },
    ]);
    expect(api.updateKeybind).toHaveBeenCalledTimes(1);
    expect(api.updateKeybind).toHaveBeenCalledWith({
      keybindId: "kb-2",
      keystroke: "Ctrl+Q",
      commandId: "app.quit",
      context: "COMPOSER",
      isEnabled: false,
    });
    expect(useDeviceKeybindStore.getState().keybinds).toEqual([PLUGIN, PANEL]);
    expect(api.invalidateKeybinds).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(APP_KEYBINDS_MOVED_MESSAGE);
  });

  it("keeps a keybind the server refuses on this device", async () => {
    api.createKeybind.mockImplementationOnce(async () => {
      throw new Error("conflict");
    });

    expect(await moveAppKeybindsToServer(ACCOUNT)).toBe(1);

    expect(useDeviceKeybindStore.getState().keybinds).toEqual([ZEN, PLUGIN, PANEL]);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it("keeps a turned-off keybind on this device when the server cannot turn its copy off", async () => {
    api.updateKeybind.mockRejectedValueOnce(new Error("refused"));

    await moveAppKeybindsToServer(ACCOUNT);

    expect(api.deleteKeybind).toHaveBeenCalledWith({ keybindId: "kb-2" });
    expect(useDeviceKeybindStore.getState().keybinds).toEqual([QUIT, PLUGIN, PANEL]);
  });

  it("runs once per account and server, even after a refusal", async () => {
    api.createKeybind.mockRejectedValue(new Error("refused"));

    await moveAppKeybindsToServer(ACCOUNT);
    expect(appKeybindsMoved(ACCOUNT)).toBe(true);
    api.createKeybind.mockClear();
    await moveAppKeybindsToServer(ACCOUNT);

    expect(api.createKeybind).not.toHaveBeenCalled();
    expect(useDeviceKeybindStore.getState().keybinds).toHaveLength(4);

    api.createKeybind.mockResolvedValue({ id: "kb-other" });
    expect(await moveAppKeybindsToServer("https://other.example:user-1")).toBe(2);
  });

  it("does not run twice at once for an account", async () => {
    const [first, second] = await Promise.all([
      moveAppKeybindsToServer(ACCOUNT),
      moveAppKeybindsToServer(ACCOUNT),
    ]);

    expect([first, second]).toEqual([2, 0]);
    expect(api.createKeybind).toHaveBeenCalledTimes(2);
  });

  it("shows nothing when no app command keybind is on this device", async () => {
    useDeviceKeybindStore.setState({ keybinds: [PLUGIN] });

    expect(await moveAppKeybindsToServer(ACCOUNT)).toBe(0);

    expect(api.createKeybind).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(api.invalidateKeybinds).not.toHaveBeenCalled();
  });

  it("shows nothing when every app command keybind is refused", async () => {
    api.createKeybind.mockRejectedValue(new Error("refused"));

    expect(await moveAppKeybindsToServer(ACCOUNT)).toBe(0);

    expect(toast.info).not.toHaveBeenCalled();
    expect(useDeviceKeybindStore.getState().keybinds).toHaveLength(4);
  });

  it("forgets the record of an account removed from this device", async () => {
    const account = appKeybindAccount("user-9");
    await moveAppKeybindsToServer(account);
    expect(appKeybindsMoved(account)).toBe(true);

    forgetAppKeybindMove("user-9");

    expect(appKeybindsMoved(account)).toBe(false);
  });
});

describe("useAppKeybindMove", () => {
  function renderWith(capabilities: string[]) {
    const client = new QueryClient();
    client.setQueryData(queryKeys.serverInfo, fakeServerInfo({}, { capabilities }));
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    renderHook(() => useAppKeybindMove(), { wrapper });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    api.createKeybind.mockResolvedValue({ id: "kb-1" });
    useDeviceKeybindStore.setState({ keybinds: [ZEN, PLUGIN] });
    useAuthStore.getState().setSession({ userId: "user-1" });
  });

  afterEach(() => {
    useAuthStore.getState().clearSession();
    useDeviceKeybindStore.setState({ keybinds: [] });
    localStorage.clear();
  });

  it("moves the signed-in account's app command keybinds where the server keeps them", async () => {
    renderWith([APP_COMMAND_KEYBINDS]);

    await waitFor(() => expect(useDeviceKeybindStore.getState().keybinds).toEqual([PLUGIN]));
    expect(appKeybindsMoved(appKeybindAccount("user-1"))).toBe(true);
  });

  it("leaves them on this device for a server without the capability", async () => {
    renderWith([]);

    await Promise.resolve();
    expect(api.createKeybind).not.toHaveBeenCalled();
    expect(appKeybindsMoved(appKeybindAccount("user-1"))).toBe(false);
  });
});
