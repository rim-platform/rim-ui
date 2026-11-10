import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ desktop: true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.desktop,
  invoke: tauri.invoke,
}));
const events = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));

import {
  AGENT_INSTALL_PROGRESS_EVENT,
  agentInstallerCatalog,
  DESKTOP_ONLY_MESSAGE,
  installAgent,
  onInstallProgress,
  progressLine,
  removeInstalledAgent,
  type InstallProgress,
} from "./agentInstaller";

describe("agentInstaller", () => {
  beforeEach(() => {
    tauri.desktop = true;
    tauri.invoke.mockReset().mockResolvedValue(null);
    events.handlers.clear();
    events.listen
      .mockReset()
      .mockImplementation((name: string, handler: (event: { payload: unknown }) => void) => {
        events.handlers.set(name, handler);
        return Promise.resolve(() => {});
      });
  });

  it("reads the catalog, installs and removes by preset id", async () => {
    tauri.invoke.mockResolvedValueOnce([]);
    await expect(agentInstallerCatalog()).resolves.toEqual([]);
    expect(tauri.invoke).toHaveBeenCalledWith("agent_installer_catalog", undefined);
    tauri.invoke.mockResolvedValueOnce({ kind: "declined" });
    await expect(installAgent("goose")).resolves.toEqual({ kind: "declined" });
    expect(tauri.invoke).toHaveBeenCalledWith("agent_installer_install", { presetId: "goose" });
    await removeInstalledAgent("goose");
    expect(tauri.invoke).toHaveBeenCalledWith("agent_installer_remove", { presetId: "goose" });
  });

  it("passes on the installer's sentence", async () => {
    tauri.invoke.mockRejectedValue("Stop its sessions first.");
    await expect(removeInstalledAgent("codex")).rejects.toThrow("Stop its sessions first.");
  });

  it("refuses off the desktop app", async () => {
    tauri.desktop = false;
    await expect(agentInstallerCatalog()).rejects.toThrow(DESKTOP_ONLY_MESSAGE);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it("hears the progress of installs", async () => {
    const heard: InstallProgress[] = [];
    onInstallProgress((progress) => heard.push(progress));
    await Promise.resolve();
    const payload = { presetId: "codex", stage: "checking", received: null, total: null };
    events.handlers.get(AGENT_INSTALL_PROGRESS_EVENT)?.({ payload });
    expect(heard).toEqual([payload]);
  });

  it("says where an install is", () => {
    const at = (stage: InstallProgress["stage"], received: number | null, total: number | null) =>
      progressLine({ presetId: "codex", stage, received, total });
    expect(at("node", null, null)).toBe("Downloading Node.js…");
    expect(at("node", 12_000_000, 30_000_000)).toBe("Downloading Node.js… 12 of 30 MB");
    expect(at("downloading", 34_000_000, 120_000_000)).toBe("Downloading… 34 of 120 MB");
    expect(at("downloading", 2_500_000, null)).toBe("Downloading… 2.5 MB");
    expect(at("checking", null, null)).toBe("Checking…");
    expect(at("unpacking", null, null)).toBe("Unpacking…");
    expect(at("installing", null, null)).toBe("Installing…");
    expect(at("done", null, null)).toBeNull();
  });
});
