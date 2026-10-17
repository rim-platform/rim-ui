import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: vi.fn(),
}));

vi.mock("../registry/components/RegistryNotes", () => ({ RegistryNotes: () => null }));
vi.mock("../registry/signing", () => ({
  usePluginSigning: () => ({ canSign: false, identity: undefined }),
}));
vi.mock("../api/usePluginList", () => ({
  usePluginList: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("../api/usePluginActions", () => ({
  usePluginEnable: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginDisable: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginUninstall: vi.fn(() => ({ mutate: vi.fn() })),
  usePluginInstallFromLocal: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  usePluginInstallFromLink: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  fetchLinkBundle: vi.fn(),
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
import { usePluginInstallFromLocal, usePluginUninstall } from "../api/usePluginActions";
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

type UninstallOptions = { onSuccess: () => void; onError: (err: { message: string }) => void };

/** Mocks the uninstall mutation; returns its `mutate` spy. */
function mockUninstall(
  isPending = false,
  impl: (id: string, options: UninstallOptions) => void = () => {},
) {
  const mutate = vi.fn(impl);
  vi.mocked(usePluginUninstall).mockReturnValue({ mutate, isPending } as unknown as ReturnType<
    typeof usePluginUninstall
  >);
  return mutate;
}

function listPlugins(plugins: PluginInfo[]) {
  vi.mocked(usePluginList).mockReturnValue({ data: plugins, isLoading: false } as ReturnType<
    typeof usePluginList
  >);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PluginSettingsPage — no plugin runtime (pluginHost and webPlugins false)", () => {
  it("renders PluginDesktopOnlyCard and not the plugin list", () => {
    vi.mocked(useRuntime).mockReturnValue({
      platform: "mobile",
      osType: "unknown",
      capabilities: {
        dockedThreadPane: true,
        pluginHost: false,
        agent: false,
        deviceLocalKeybinds: true,
        customTitleBar: false,
        deviceKeys: false,
        identityKeys: false,
      },
    });

    render(<PluginSettingsPage />);

    // Desktop-only card must be present
    expect(screen.getByText("Plugins require the desktop app")).toBeInTheDocument();
    expect(screen.getByText(/cannot run plugins yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /get the desktop app/i })).toBeInTheDocument();

    // Normal plugin list UI must NOT be present
    expect(screen.queryByText("Installed Plugins")).not.toBeInTheDocument();
  });
});

describe("PluginSettingsPage — web build (webPlugins only)", () => {
  beforeEach(() => {
    vi.mocked(useRuntime).mockReturnValue({
      platform: "web",
      osType: "linux",
      capabilities: {
        dockedThreadPane: true,
        pluginHost: false,
        webPlugins: true,
        agent: false,
        deviceLocalKeybinds: true,
        customTitleBar: false,
        deviceKeys: true,
        identityKeys: true,
        pluginSigning: false,
      },
    } as ReturnType<typeof useRuntime>);
  });

  it("offers only Install from link", () => {
    vi.mocked(usePluginList).mockReturnValue({ data: [], isLoading: false } as ReturnType<
      typeof usePluginList
    >);
    render(<PluginSettingsPage />);
    expect(screen.getByRole("button", { name: /install from link/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install from local folder/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /install from git url/i })).toBeNull();
    expect(screen.getByText(/install a web plugin from a link/i)).toBeInTheDocument();
  });

  it("lists web plugins with their source, and local-process ones as needing the desktop app", () => {
    vi.mocked(usePluginList).mockReturnValue({
      data: [
        makePlugin({
          plugin_id: "chat.rim.github-prs",
          display_name: "GitHub Pull Requests",
          runtime_kind: "WebSandboxed",
          source: { kind: "link", url: "https://plugins.example.com/prs.rimbundle", sha256: "ab" },
        }),
        makePlugin({ plugin_id: "chat.rim.k8s-pods", display_name: "Kubernetes Pods" }),
      ],
      isLoading: false,
    } as ReturnType<typeof usePluginList>);
    render(<PluginSettingsPage />);

    const web = screen.getByText("GitHub Pull Requests").closest(".rounded-lg") as HTMLElement;
    expect(
      within(web).getByText("Sandboxed · Unsigned · installed from a link (plugins.example.com)"),
    ).toBeInTheDocument();
    expect(within(web).getByRole("button", { name: "Enable plugin" })).toBeEnabled();

    const local = screen.getByText("Kubernetes Pods").closest(".rounded-lg") as HTMLElement;
    expect(within(local).getAllByText("Needs the desktop app").length).toBeGreaterThan(0);
    expect(within(local).getByRole("button", { name: "Needs the desktop app" })).toBeDisabled();
  });

  it("says an uninstall removes the plugin's files from this browser, naming it by id without a name", () => {
    listPlugins([makePlugin({ display_name: "", runtime_kind: "WebSandboxed" })]);
    mockUninstall();
    render(<PluginSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Uninstall plugin" }));
    const dialog = screen.getByRole("dialog", { name: "Uninstall dev.example.test?" });
    expect(dialog).toHaveTextContent(
      "removed from this browser for your account, with the permissions you granted it, the data it stored and its files",
    );
  });
});

describe("PluginSettingsPage — desktop build (pluginHost: true)", () => {
  beforeEach(() => {
    vi.mocked(useRuntime).mockReturnValue({
      platform: "desktop",
      osType: "linux",
      capabilities: {
        dockedThreadPane: true,
        pluginHost: true,
        agent: true,
        deviceLocalKeybinds: true,
        customTitleBar: true,
        deviceKeys: true,
        identityKeys: true,
        pluginSigning: true,
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
    expect(screen.getByRole("button", { name: /install from link/i })).toBeInTheDocument();
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
  it("uninstalls a plugin only once the user confirms", async () => {
    listPlugins([makePlugin({ display_name: "Kubernetes Pods" })]);
    const mutate = mockUninstall(false, (_id, options) => options.onSuccess());
    render(<PluginSettingsPage />);
    const trash = screen.getByRole("button", { name: "Uninstall plugin" });

    fireEvent.click(trash);
    const dialog = screen.getByRole("dialog", { name: "Uninstall Kubernetes Pods?" });
    expect(dialog).toHaveTextContent(
      "removed from this device, with the permissions you granted it and the data it stored. Its files stay in the plugins folder.",
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trash);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(trash);
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith("dev.example.test", expect.anything());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the uninstall dialog open with the reason when the uninstall fails", () => {
    listPlugins([makePlugin()]);
    mockUninstall(false, (_id, options) => options.onError({ message: "must disable first" }));
    render(<PluginSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Uninstall plugin" }));
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "must disable first",
    );
  });

  it("disables the uninstall confirmation while the uninstall runs", () => {
    listPlugins([makePlugin()]);
    mockUninstall(true);
    render(<PluginSettingsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Uninstall plugin" }));
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeDisabled();
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
    expect(screen.getByText(/cannot run plugins yet/i)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /get the desktop app/i });
    expect(link).toHaveAttribute("href", "https://rim.dev/download");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
