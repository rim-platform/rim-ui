import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: vi.fn(),
}));

vi.mock("../api/usePluginList", () => ({
  usePluginList: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("../api/usePluginActions", () => ({
  usePluginEnable: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginDisable: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginUninstall: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginInstallFromLocal: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePluginInstallFromGit: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePluginTrustFingerprint: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  })),
}));

vi.mock("../api/usePluginCapabilities", () => ({
  useApproveCapabilities: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { usePluginInstallFromLocal } from "../api/usePluginActions";
import { usePluginList } from "../api/usePluginList";
import { PluginSettingsPage, PluginDesktopOnlyCard } from "./PluginSettingsPage";
import type { PluginInfo } from "../types";

// ─── Helper ───────────────────────────────────────────────────────────────────

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: "dev.example.test",
    manifest_id: "dev.example.test",
    display_name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    author: "Test Author",
    enabled: false,
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

describe("PluginSettingsPage — web build (pluginHost: false)", () => {
  it("renders PluginDesktopOnlyCard and not the plugin list", () => {
    vi.mocked(useRuntime).mockReturnValue({
      platform: "web",
      osType: "unknown",
      capabilities: {
        multiPaneShell: true,
        dockedThreadPane: true,
        pluginHost: false,
        agent: false,
        deviceLocalKeybinds: true,
        globalShortcuts: false,
        localProcess: false,
        filesystemAccess: false,
        nativeNotifications: false,
        customTitleBar: false,
      },
    });

    render(<PluginSettingsPage />);

    // Desktop-only card must be present
    expect(screen.getByText("Plugins require the desktop app")).toBeInTheDocument();
    expect(screen.getByText(/browser sandbox/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /get the desktop app/i })).toBeInTheDocument();

    // Normal plugin list UI must NOT be present
    expect(screen.queryByText("Installed Plugins")).not.toBeInTheDocument();
  });
});

describe("PluginSettingsPage — desktop build (pluginHost: true)", () => {
  beforeEach(() => {
    vi.mocked(useRuntime).mockReturnValue({
      platform: "desktop",
      osType: "linux",
      capabilities: {
        multiPaneShell: true,
        dockedThreadPane: true,
        pluginHost: true,
        agent: true,
        deviceLocalKeybinds: true,
        globalShortcuts: true,
        localProcess: true,
        filesystemAccess: true,
        nativeNotifications: true,
        customTitleBar: true,
      },
    });
  });

  it("renders install affordance buttons", () => {
    vi.mocked(usePluginList).mockReturnValue({ data: [], isLoading: false } as ReturnType<
      typeof usePluginList
    >);
    render(<PluginSettingsPage />);

    expect(screen.getByRole("button", { name: /install from local folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /install from git url/i })).toBeInTheDocument();
  });

  it("renders empty state with marketplace copy when no plugins installed", () => {
    vi.mocked(usePluginList).mockReturnValue({ data: [], isLoading: false } as ReturnType<
      typeof usePluginList
    >);
    render(<PluginSettingsPage />);

    expect(screen.getByText("No plugins installed")).toBeInTheDocument();
    expect(screen.getByText(/marketplace coming soon/i)).toBeInTheDocument();
    // Normal plugin list heading must NOT be present
    expect(screen.queryByText("Installed Plugins")).not.toBeInTheDocument();
  });

  it("renders installed plugin list when plugins exist", () => {
    vi.mocked(usePluginList).mockReturnValue({
      data: [makePlugin({ display_name: "My Plugin", enabled: true })],
      isLoading: false,
    } as ReturnType<typeof usePluginList>);

    render(<PluginSettingsPage />);

    expect(screen.getByText("Installed Plugins")).toBeInTheDocument();
    expect(screen.getByText("My Plugin")).toBeInTheDocument();
  });

  it("shows FingerprintChanged warning banner when fingerprint_changed is true", () => {
    vi.mocked(usePluginList).mockReturnValue({
      data: [makePlugin({ fingerprint_changed: true, display_name: "Changed Plugin" })],
      isLoading: false,
    } as ReturnType<typeof usePluginList>);

    render(<PluginSettingsPage />);

    expect(screen.getByText("Plugin bundle has changed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /trust new version/i })).toBeInTheDocument();
    expect(screen.getByText(/Changed Plugin/)).toBeInTheDocument();
  });

  it("shows Bundle changed badge in plugin row when fingerprint_changed is true", () => {
    vi.mocked(usePluginList).mockReturnValue({
      data: [makePlugin({ fingerprint_changed: true })],
      isLoading: false,
    } as ReturnType<typeof usePluginList>);

    render(<PluginSettingsPage />);

    expect(screen.getByText("Bundle changed")).toBeInTheDocument();
  });

  it("does NOT show fingerprint warning when fingerprint_changed is false", () => {
    vi.mocked(usePluginList).mockReturnValue({
      data: [makePlugin({ fingerprint_changed: false })],
      isLoading: false,
    } as ReturnType<typeof usePluginList>);

    render(<PluginSettingsPage />);

    expect(screen.queryByText("Plugin bundle has changed")).not.toBeInTheDocument();
    expect(screen.queryByText("Bundle changed")).not.toBeInTheDocument();
  });

  it("disables the enable toggle when fingerprint_changed is true", () => {
    vi.mocked(usePluginList).mockReturnValue({
      data: [makePlugin({ fingerprint_changed: true, enabled: false })],
      isLoading: false,
    } as ReturnType<typeof usePluginList>);

    render(<PluginSettingsPage />);

    const toggle = screen.getByRole("button", {
      name: /trust the new version before enabling/i,
    });
    expect(toggle).toBeDisabled();
  });
  it("shows what an installed plugin does and asks for its permissions right away", () => {
    const k8s = makePlugin({
      plugin_id: "chat.rim.k8s-pods",
      display_name: "Kubernetes Pods",
      description: "Your cluster credentials never leave this device.",
      capabilities: ["ui.panel"],
    });
    vi.mocked(usePluginList).mockReturnValue({ data: [k8s], isLoading: false } as ReturnType<
      typeof usePluginList
    >);
    vi.mocked(usePluginInstallFromLocal).mockReturnValue({
      mutate: (_path: string, options: { onSuccess: (r: { plugin_id: string }) => void }) =>
        options.onSuccess({ plugin_id: "chat.rim.k8s-pods" }),
      isPending: false,
    } as unknown as ReturnType<typeof usePluginInstallFromLocal>);

    const { container } = render(<PluginSettingsPage />);
    expect(screen.queryByText("Plugin Permissions")).not.toBeInTheDocument();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = Object.assign(new File([""], "rim-plugin.json"), {
      path: "/home/me/k8s-pods/rim-plugin.json",
    });
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Plugin Permissions")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Your cluster credentials never leave this device."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Render UI Panels")).toBeInTheDocument();
  });
});

describe("PluginDesktopOnlyCard", () => {
  it("renders the heading, description, and download link", () => {
    render(<PluginDesktopOnlyCard />);

    expect(screen.getByText("Plugins require the desktop app")).toBeInTheDocument();
    expect(
      screen.getByText(/OS-level subprocess access that the browser sandbox does not permit/i),
    ).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /get the desktop app/i });
    expect(link).toHaveAttribute("href", "https://rim.dev/download");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
