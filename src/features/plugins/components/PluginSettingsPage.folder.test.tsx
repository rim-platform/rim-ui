import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../core/runtime/RuntimeProvider", () => ({ useRuntime: vi.fn() }));
vi.mock("../registry/components/RegistryNotes", () => ({ RegistryNotes: () => null }));
vi.mock("../registry/signing", () => ({
  usePluginSigning: () => ({ canSign: false, identity: undefined }),
}));
vi.mock("../api/usePluginList", () => ({
  usePluginList: vi.fn(() => ({ data: [], isLoading: false })),
}));
vi.mock("../../../core/tauri/safeInvoke", () => ({ safeInvoke: vi.fn() }));

const installFromLocal = vi.fn();
vi.mock("../api/usePluginActions", () => ({
  usePluginEnable: () => ({ mutate: vi.fn() }),
  usePluginDisable: () => ({ mutate: vi.fn() }),
  usePluginUninstall: () => ({ mutate: vi.fn() }),
  usePluginInstallFromLocal: () => ({ mutate: installFromLocal, isPending: false }),
  usePluginInstallFromLink: () => ({ mutate: vi.fn(), isPending: false }),
  fetchLinkBundle: vi.fn(),
  usePluginInstallFromGit: () => ({ mutate: vi.fn(), isPending: false }),
  usePluginTrustFingerprint: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  usePluginUpdate: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { safeInvoke } from "../../../core/tauri/safeInvoke";
import { PluginSettingsPage } from "./PluginSettingsPage";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useRuntime).mockReturnValue({
    platform: "desktop",
    osType: "linux",
    capabilities: { pluginHost: true, webPlugins: true },
  } as ReturnType<typeof useRuntime>);
});

function clickInstallFromFolder() {
  fireEvent.click(screen.getByRole("button", { name: /install from local folder/i }));
}

describe("Install from local folder", () => {
  it("installs from the folder the dialog returns", async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, value: "/home/ada/plugins/poll" });
    render(<PluginSettingsPage />);
    clickInstallFromFolder();

    await waitFor(() => expect(installFromLocal).toHaveBeenCalledTimes(1));
    expect(safeInvoke).toHaveBeenCalledWith("plugin_pick_folder");
    expect(installFromLocal.mock.calls[0][0]).toBe("/home/ada/plugins/poll");
  });

  it("does nothing when the dialog is cancelled", async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, value: null });
    render(<PluginSettingsPage />);
    clickInstallFromFolder();

    await waitFor(() => expect(safeInvoke).toHaveBeenCalled());
    expect(installFromLocal).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows why the dialog failed", async () => {
    vi.mocked(safeInvoke).mockResolvedValue({
      ok: false,
      error: { kind: "backend_error", code: "LOCAL_INSTALL_ERROR", message: "not a local folder" },
    });
    render(<PluginSettingsPage />);
    clickInstallFromFolder();

    expect(await screen.findByRole("alert")).toHaveTextContent("not a local folder");
    expect(installFromLocal).not.toHaveBeenCalled();
  });

  it("shows the install error of the chosen folder", async () => {
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, value: "/home/ada/empty" });
    installFromLocal.mockImplementation((_path, options) =>
      options.onError({ message: "no rim-plugin.json found in the plugin folder" }),
    );
    render(<PluginSettingsPage />);
    clickInstallFromFolder();

    expect(await screen.findByRole("alert")).toHaveTextContent("no rim-plugin.json found");
  });

  it("is not offered on the web", () => {
    vi.mocked(useRuntime).mockReturnValue({
      platform: "web",
      osType: "linux",
      capabilities: { pluginHost: false, webPlugins: true },
    } as ReturnType<typeof useRuntime>);
    render(<PluginSettingsPage />);
    expect(screen.queryByRole("button", { name: /install from local folder/i })).toBeNull();
  });
});
