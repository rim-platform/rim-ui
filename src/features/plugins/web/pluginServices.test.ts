import { beforeEach, describe, expect, it, vi } from "vitest";

const safeInvokeMock = vi.fn();
vi.mock("../../../core/tauri/safeInvoke", () => ({
  safeInvoke: (...args: unknown[]) => safeInvokeMock(...args),
}));

import { desktopPluginServices } from "./pluginServices";
import { RpcError } from "./rpc";

describe("the desktop's settings for a web plugin", () => {
  beforeEach(() => safeInvokeMock.mockReset());

  it("come from the desktop host for that plugin", async () => {
    safeInvokeMock.mockResolvedValue({ ok: true, value: { api_token: "t0k" } });
    expect(await desktopPluginServices.pluginSettings("dev.example.web")).toEqual({
      api_token: "t0k",
    });
    expect(safeInvokeMock).toHaveBeenCalledWith("plugin_web_settings", {
      pluginId: "dev.example.web",
    });
  });

  it("fail as INTERNAL_ERROR, saying so when the secret vault is locked", async () => {
    safeInvokeMock.mockResolvedValue({
      ok: false,
      error: {
        kind: "backend_error",
        code: "SECRETS_LOCKED",
        message: "the plugin's secret settings are not available: locked",
        data: { reason: "secretsLocked" },
      },
    });
    const locked = await desktopPluginServices.pluginSettings("dev.example.web").catch((e) => e);
    expect(locked).toBeInstanceOf(RpcError);
    expect(locked).toMatchObject({ code: -32603, data: { reason: "secretsLocked" } });

    safeInvokeMock.mockResolvedValue({
      ok: false,
      error: {
        kind: "backend_error",
        code: "NOT_WEB_PLUGIN",
        message: "dev.example.web is not an enabled WebSandboxed plugin",
      },
    });
    const refused = await desktopPluginServices.pluginSettings("dev.example.web").catch((e) => e);
    expect(refused).toMatchObject({ code: -32603, data: undefined });
  });
});
