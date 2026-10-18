import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../api/usePluginList", () => ({ usePluginList: vi.fn() }));
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

import { useShellStore } from "../../../shell/state/useShellStore";
import { usePluginList } from "../api/usePluginList";
import { openPluginSettings } from "../pluginSettingsLink";
import { usePluginSettingsDialogStore } from "../state/usePluginSettingsDialogStore";
import type { PluginInfo } from "../types";
import { PluginSettingsDialogHost } from "./PluginSettingsDialogHost";

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

beforeEach(() => {
  vi.mocked(usePluginList).mockReturnValue({
    data: [
      makePlugin("dev.example.pods", {
        settings_schema: [
          {
            key: "context",
            title: "Context",
            description: "",
            value_type: "string",
            is_secret: false,
          },
        ],
      }),
      makePlugin("dev.example.plain", { settings_schema: [] }),
    ],
    isLoading: false,
  } as ReturnType<typeof usePluginList>);
  useShellStore.getState().reset();
});

afterEach(() => usePluginSettingsDialogStore.getState().close());

describe("PluginSettingsDialogHost", () => {
  it("opens a plugin's settings over the current view and leaves the view as it was", () => {
    act(() => useShellStore.getState().openPluginPanel("dev.example.pods", "pods", "main_area"));
    const before = useShellStore.getState();
    render(<PluginSettingsDialogHost />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => openPluginSettings("dev.example.pods"));
    expect(screen.getByRole("dialog", { name: "settings of dev.example.pods" })).toBeVisible();
    expect(useShellStore.getState().mainSurface).toEqual(before.mainSurface);
    expect(useShellStore.getState().activePluginPanel).toEqual(before.activePluginPanel);

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(usePluginSettingsDialogStore.getState().pluginId).toBeNull();
    expect(useShellStore.getState().activePluginPanel).toEqual(before.activePluginPanel);
  });

  it("opens nothing for a plugin without settings or not installed", () => {
    render(<PluginSettingsDialogHost />);
    act(() => openPluginSettings("dev.example.plain"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => openPluginSettings("dev.example.missing"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
