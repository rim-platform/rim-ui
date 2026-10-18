import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../core/runtime/RuntimeProvider", () => ({ useRuntime: vi.fn() }));
vi.mock("../registry/components/RegistryNotes", () => ({ RegistryNotes: () => null }));
vi.mock("../registry/signing", () => ({
  usePluginSigning: () => ({ canSign: false, identity: undefined }),
}));
vi.mock("../api/usePluginList", () => ({ usePluginList: vi.fn() }));
vi.mock("../api/usePluginActions", () => ({
  usePluginEnable: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginDisable: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginUninstall: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginInstallFromLocal: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePluginInstallFromLink: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  fetchLinkBundle: vi.fn(),
  usePluginInstallFromGit: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePluginTrustFingerprint: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePluginUpdate: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock("./PluginSettingsDialog", () => ({
  PluginSettingsDialog: ({
    plugin,
    onClose,
  }: {
    plugin: { plugin_id: string };
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label={`settings of ${plugin.plugin_id}`}>
      <button type="button" onClick={onClose}>
        Close settings
      </button>
    </div>
  ),
}));

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useShellStore } from "../../../shell/state/useShellStore";
import { usePluginList } from "../api/usePluginList";
import { openPluginSettings } from "../pluginSettingsLink";
import type { PluginInfo } from "../types";
import { PluginSettingsPage } from "./PluginSettingsPage";

function makePlugin(id: string, overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: id,
    manifest_id: id,
    display_name: id,
    version: "1.0.0",
    description: "",
    enabled: true,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    ...overrides,
  };
}

const WITH_SETTINGS = makePlugin("dev.example.pods", {
  settings_schema: [
    { key: "context", title: "Context", description: "", value_type: "string", is_secret: false },
  ],
});
const WITHOUT_SETTINGS = makePlugin("dev.example.plain", { settings_schema: [] });
const OLDER_HOST = makePlugin("dev.example.older");

beforeEach(() => {
  vi.mocked(useRuntime).mockReturnValue({
    platform: "desktop",
    osType: "linux",
    capabilities: { pluginHost: true, webPlugins: true },
  } as ReturnType<typeof useRuntime>);
  vi.mocked(usePluginList).mockReturnValue({
    data: [WITH_SETTINGS, WITHOUT_SETTINGS, OLDER_HOST],
    isLoading: false,
  } as ReturnType<typeof usePluginList>);
  useShellStore.setState({ mainSurface: { kind: "settings", tab: "plugins" } });
});

describe("PluginSettingsPage settings", () => {
  it("shows Settings only on the row of a plugin that declares settings", () => {
    render(<PluginSettingsPage />);
    expect(screen.getByRole("button", { name: "Settings for dev.example.pods" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /^Settings for/ })).toHaveLength(1);
  });

  it("opens the plugin's settings form from its row", () => {
    render(<PluginSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Settings for dev.example.pods" }));
    expect(screen.getByRole("dialog", { name: "settings of dev.example.pods" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the settings form a deep link names, and closing it ends the link", () => {
    render(<PluginSettingsPage />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => openPluginSettings("dev.example.pods"));
    expect(useShellStore.getState().mainSurface).toEqual({
      kind: "settings",
      tab: "plugins",
      plugin: "dev.example.pods",
    });
    expect(screen.getByRole("dialog", { name: "settings of dev.example.pods" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "plugins" });
  });

  it("opens no form for a link to a plugin without settings or not installed", () => {
    useShellStore.setState({
      mainSurface: { kind: "settings", tab: "plugins", plugin: "dev.example.plain" },
    });
    render(<PluginSettingsPage />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => openPluginSettings("dev.example.missing"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
