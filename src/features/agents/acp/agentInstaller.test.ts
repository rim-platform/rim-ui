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
  formatSize,
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
    const catalog = { agents: [], node: null, nodeDownload: 62_900_000, totalBytes: 0 };
    tauri.invoke.mockResolvedValueOnce(catalog);
    await expect(agentInstallerCatalog()).resolves.toEqual(catalog);
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

  it("reads sizes in decimal units, rounded as the installer rounds them", () => {
    expect(formatSize(0)).toBe("0.0 MB");
    expect(formatSize(49_999)).toBe("0.0 MB");
    expect(formatSize(2_250_000)).toBe("2.3 MB");
    expect(formatSize(9_949_999)).toBe("9.9 MB");
    expect(formatSize(9_950_000)).toBe("10 MB");
    expect(formatSize(120_400_000)).toBe("120 MB");
    expect(formatSize(999_499_999)).toBe("999 MB");
    expect(formatSize(999_500_000)).toBe("1.0 GB");
    expect(formatSize(1_249_999_999)).toBe("1.2 GB");
    expect(formatSize(1_250_000_000)).toBe("1.3 GB");
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
