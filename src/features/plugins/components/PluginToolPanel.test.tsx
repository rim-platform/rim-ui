import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: vi.fn(),
}));

vi.mock("../api/usePluginList", () => ({
  usePluginList: vi.fn(),
}));

vi.mock("../api/usePluginActions", () => ({
  usePluginEnable: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginDisable: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("./PluginErrorBoundary", () => ({
  PluginErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockSetMainSurface = vi.fn();

vi.mock("../../../shell/state/useShellStore", () => ({
  useShellStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setMainSurface: mockSetMainSurface }),
}));

import React from "react";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { usePluginList } from "../api/usePluginList";
import { PluginToolPanel } from "./PluginToolPanel";
import type { PluginInfo } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRuntime(pluginHost: boolean) {
  return {
    platform: pluginHost ? "desktop" : "web",
    osType: pluginHost ? "linux" : "unknown",
    capabilities: {
      multiPaneShell: true,
      dockedThreadPane: true,
      pluginHost,
      agent: false,
      deviceLocalKeybinds: true,
      globalShortcuts: false,
      localProcess: false,
      filesystemAccess: false,
      nativeNotifications: false,
      customTitleBar: false,
      deviceKeys: false,
    },
  };
}

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: "dev.example.test",
    manifest_id: "dev.example.test",
    display_name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    author: "Test Author",
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PluginToolPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when pluginHost capability is false (web build)", () => {
    it("renders the desktop-only message", () => {
      vi.mocked(useRuntime).mockReturnValue(makeRuntime(false) as ReturnType<typeof useRuntime>);
      vi.mocked(usePluginList).mockReturnValue({ data: [], isLoading: false } as ReturnType<
        typeof usePluginList
      >);

      render(<PluginToolPanel />);

      expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument();
    });

    it("does not render the Manage plugins button", () => {
      vi.mocked(useRuntime).mockReturnValue(makeRuntime(false) as ReturnType<typeof useRuntime>);
      vi.mocked(usePluginList).mockReturnValue({ data: [], isLoading: false } as ReturnType<
        typeof usePluginList
      >);

      render(<PluginToolPanel />);

      expect(screen.queryByText("Manage plugins")).not.toBeInTheDocument();
    });
  });

  describe("when loading", () => {
    it("shows a loading indicator", () => {
      vi.mocked(useRuntime).mockReturnValue(makeRuntime(true) as ReturnType<typeof useRuntime>);
      vi.mocked(usePluginList).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
        typeof usePluginList
      >);

      render(<PluginToolPanel />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });

  describe("when no enabled plugins exist", () => {
    beforeEach(() => {
      vi.mocked(useRuntime).mockReturnValue(makeRuntime(true) as ReturnType<typeof useRuntime>);
      vi.mocked(usePluginList).mockReturnValue({
        data: [makePlugin({ enabled: false })],
        isLoading: false,
      } as ReturnType<typeof usePluginList>);
    });

    it("shows the empty-state 'Manage plugins' button", () => {
      render(<PluginToolPanel />);
      expect(screen.getByText("Manage plugins")).toBeInTheDocument();
    });

    /**
     * Regression: "Manage plugins" must open Settings on the Plugins tab, not
     * the default Profile tab. Verified by checking that setMainSurface is
     * called with `{ kind: "settings", tab: "plugins" }`.
     */
    it("navigates to settings with tab 'plugins' when 'Manage plugins' is clicked", async () => {
      const user = userEvent.setup();
      render(<PluginToolPanel />);

      await user.click(screen.getByText("Manage plugins"));

      expect(mockSetMainSurface).toHaveBeenCalledOnce();
      expect(mockSetMainSurface).toHaveBeenCalledWith({ kind: "settings", tab: "plugins" });
    });
  });

  describe("when enabled plugins exist", () => {
    it("renders the plugin list instead of the empty state", () => {
      vi.mocked(useRuntime).mockReturnValue(makeRuntime(true) as ReturnType<typeof useRuntime>);
      vi.mocked(usePluginList).mockReturnValue({
        data: [makePlugin({ display_name: "My Plugin", enabled: true })],
        isLoading: false,
      } as ReturnType<typeof usePluginList>);

      render(<PluginToolPanel />);

      expect(screen.getByText("My Plugin")).toBeInTheDocument();
      expect(screen.queryByText("Manage plugins")).not.toBeInTheDocument();
    });
  });
});
