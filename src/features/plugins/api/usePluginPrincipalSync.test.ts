import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const safeInvokeMock = vi.fn();
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => safeInvokeMock(...args),
}));

const runtime = { platform: "desktop", capabilities: { pluginHost: true, webPlugins: false } };
vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => runtime,
}));

const webHost = vi.hoisted(() => ({ setPrincipal: vi.fn(), setMappings: vi.fn() }));
vi.mock("../web/webPluginHost", () => ({ webPluginHost: webHost }));
vi.mock("../web/webPluginEnvironment", () => ({
  pluginServices: () => ({ mappings: async () => [] }),
}));

type Me =
  { id: string; username: string; displayName: string; principalId?: string | null } | undefined;
let me: Me;
vi.mock("../../workspaces/api/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: me }),
}));

import { useAuthStore } from "../../auth/state/useAuthStore";
import { usePluginPrincipalSync } from "./usePluginPrincipalSync";

const USER = { id: "user-1", username: "jakub", displayName: "Jakub" };

describe("usePluginPrincipalSync", () => {
  beforeEach(() => {
    safeInvokeMock.mockReset();
    safeInvokeMock.mockResolvedValue({ ok: true, value: null });
    runtime.capabilities.pluginHost = true;
    runtime.capabilities.webPlugins = false;
    webHost.setPrincipal.mockReset();
    me = undefined;
    useAuthStore.setState({ session: null });
  });

  it("reports the signed-in user to the plugin host", async () => {
    useAuthStore.setState({ session: { userId: USER.id } });
    me = USER;
    renderHook(() => usePluginPrincipalSync());

    await waitFor(() =>
      expect(safeInvokeMock).toHaveBeenCalledWith("plugin_set_principal", {
        user: { userId: "user-1", displayName: "Jakub", principalId: null },
      }),
    );
  });

  it("passes the key-based id once the account enrolled a key", async () => {
    useAuthStore.setState({ session: { userId: USER.id } });
    me = { ...USER, principalId: "rimp1_key" };
    renderHook(() => usePluginPrincipalSync());

    await waitFor(() =>
      expect(safeInvokeMock).toHaveBeenCalledWith("plugin_set_principal", {
        user: { userId: "user-1", displayName: "Jakub", principalId: "rimp1_key" },
      }),
    );
  });

  it("falls back to the username when there is no display name", async () => {
    useAuthStore.setState({ session: { userId: USER.id } });
    me = { ...USER, displayName: "" };
    renderHook(() => usePluginPrincipalSync());

    await waitFor(() =>
      expect(safeInvokeMock).toHaveBeenCalledWith("plugin_set_principal", {
        user: { userId: "user-1", displayName: "jakub", principalId: null },
      }),
    );
  });

  it("waits until the profile belongs to the session's account", () => {
    useAuthStore.setState({ session: { userId: "user-2" } });
    me = USER;
    renderHook(() => usePluginPrincipalSync());

    expect(safeInvokeMock).not.toHaveBeenCalled();
  });

  it("clears the principal on sign-out", async () => {
    useAuthStore.setState({ session: { userId: USER.id } });
    me = USER;
    const { rerender } = renderHook(() => usePluginPrincipalSync());
    await waitFor(() => expect(safeInvokeMock).toHaveBeenCalledTimes(1));

    useAuthStore.setState({ session: null });
    rerender();

    await waitFor(() =>
      expect(safeInvokeMock).toHaveBeenLastCalledWith("plugin_set_principal", { user: null }),
    );
  });

  it("tells the desktop's web plugins only once the desktop host has the new principal", async () => {
    runtime.capabilities.webPlugins = true;
    let answer: (result: unknown) => void = () => {};
    safeInvokeMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    useAuthStore.setState({ session: { userId: USER.id } });
    me = USER;
    renderHook(() => usePluginPrincipalSync());

    await waitFor(() => expect(safeInvokeMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(webHost.setPrincipal).not.toHaveBeenCalled();
    answer({ ok: true, value: null });
    await waitFor(() =>
      expect(webHost.setPrincipal).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "Jakub" }),
      ),
    );
  });

  it("does nothing without a plugin host", () => {
    runtime.capabilities.pluginHost = false;
    useAuthStore.setState({ session: { userId: USER.id } });
    me = USER;
    renderHook(() => usePluginPrincipalSync());

    expect(safeInvokeMock).not.toHaveBeenCalled();
  });
});
