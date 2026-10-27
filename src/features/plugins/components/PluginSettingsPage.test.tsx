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
  usePluginUpdate: vi.fn(() => ({ mutate: vi.fn(), isPending: false, variables: undefined })),
}));

vi.mock("../api/usePluginCapabilities", () => ({
  useApproveCapabilities: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import {
  usePluginDisable,
  usePluginEnable,
  usePluginInstallFromLocal,
  usePluginUninstall,
} from "../api/usePluginActions";
import { useApproveCapabilities } from "../api/usePluginCapabilities";
import { usePluginList } from "../api/usePluginList";
import { usePluginFingerprintDismissStore } from "../state/usePluginFingerprintDismissStore";
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

/** Mocks the enable and disable mutations; returns their `mutate` spies. */
function mockToggles() {
  const enable = vi.fn();
  const disable = vi.fn();
  vi.mocked(usePluginEnable).mockReturnValue({ mutate: enable } as unknown as ReturnType<
    typeof usePluginEnable
  >);
  vi.mocked(usePluginDisable).mockReturnValue({ mutate: disable } as unknown as ReturnType<
    typeof usePluginDisable
  >);
  return { enable, disable };
}

/** Opens the row's more-actions menu and picks Uninstall. */
function clickUninstall() {
  fireEvent.click(screen.getByRole("button", { name: /^More actions for / }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Uninstall…" }));
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

    const web = screen.getByText("GitHub Pull Requests").closest(".rounded-xl") as HTMLElement;
    expect(within(web).getByText("Sandboxed")).toBeInTheDocument();
    expect(within(web).getByText("Unsigned")).toBeInTheDocument();
    expect(
      within(web).getByText("Installed from a link (plugins.example.com)"),
    ).toBeInTheDocument();
    expect(within(web).getByRole("switch", { name: "GitHub Pull Requests" })).toBeEnabled();

    const local = screen.getByText("Kubernetes Pods").closest(".rounded-xl") as HTMLElement;
    expect(within(local).getAllByText("Needs the desktop app").length).toBeGreaterThan(0);
    const localSwitch = within(local).getByRole("switch", { name: "Kubernetes Pods" });
    expect(localSwitch).toBeDisabled();
    expect(localSwitch).toHaveAttribute("title", "Needs the desktop app");
  });

  it("says an uninstall removes the plugin's files from this browser, naming it by id without a name", () => {
    listPlugins([makePlugin({ display_name: "", runtime_kind: "WebSandboxed" })]);
    mockUninstall();
    render(<PluginSettingsPage />);

    clickUninstall();
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

  describe("the switch of a plugin whose bundle changed", () => {
    it("cannot turn a stopped plugin on, and says why", () => {
      const { enable } = mockToggles();
      listPlugins([makePlugin({ fingerprint_changed: true, enabled: false })]);
      render(<PluginSettingsPage />);

      const toggle = screen.getByRole("switch", { name: "Test Plugin" });
      expect(toggle).toBeDisabled();
      expect(toggle).toHaveAttribute("title", "Trust the new version before enabling");
      fireEvent.click(toggle);
      expect(enable).not.toHaveBeenCalled();
    });

    it("turns a running plugin off", () => {
      const { enable, disable } = mockToggles();
      listPlugins([makePlugin({ fingerprint_changed: true, enabled: true })]);
      render(<PluginSettingsPage />);

      const toggle = screen.getByRole("switch", { name: "Test Plugin" });
      expect(toggle).toBeEnabled();
      expect(toggle).toHaveAttribute("aria-checked", "true");
      expect(toggle).toHaveAttribute("title", "Disable plugin");
      fireEvent.click(toggle);
      expect(disable).toHaveBeenCalledWith("dev.example.test");
      expect(enable).not.toHaveBeenCalled();
      expect(screen.getByText("Plugin bundle has changed")).toBeInTheDocument();
    });
  });

  it("names each switch after its plugin and gives its state", () => {
    listPlugins([
      makePlugin({ plugin_id: "dev.example.on", display_name: "On Plugin", enabled: true }),
      makePlugin({ plugin_id: "dev.example.off", display_name: "Off Plugin", enabled: false }),
    ]);
    render(<PluginSettingsPage />);

    expect(screen.getByRole("switch", { name: "On Plugin" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Off Plugin" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  describe("the switch of a plugin with permissions not granted", () => {
    afterEach(() => {
      vi.mocked(useApproveCapabilities).mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof useApproveCapabilities>);
    });

    it("asks for ungranted permissions before turning a plugin on, and Approve and turn on starts it", () => {
      const { enable } = mockToggles();
      const approve = vi.fn((_vars: unknown, options: { onSuccess: () => void }) =>
        options.onSuccess(),
      );
      vi.mocked(useApproveCapabilities).mockReturnValue({
        mutate: approve,
        isPending: false,
      } as unknown as ReturnType<typeof useApproveCapabilities>);
      listPlugins([
        makePlugin({
          capabilities: ["ui.panel", "ui.notify"],
          approved_capabilities: ["ui.notify"],
        }),
      ]);
      render(<PluginSettingsPage />);

      fireEvent.click(screen.getByRole("switch", { name: "Test Plugin" }));
      expect(enable).not.toHaveBeenCalled();
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("Plugin Permissions")).toBeInTheDocument();
      expect(within(dialog).getByText("Render UI Panels")).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: "Approve and turn on" }));
      expect(approve).toHaveBeenCalledWith(
        { pluginId: "dev.example.test", capabilities: ["ui.panel", "ui.notify"] },
        expect.anything(),
      );
      expect(enable).toHaveBeenCalledWith("dev.example.test", expect.anything());
    });

    it("turns on a plugin whose permissions are all granted without asking", () => {
      const { enable } = mockToggles();
      listPlugins([
        makePlugin({ capabilities: ["ui.panel"], approved_capabilities: ["ui.panel"] }),
      ]);
      render(<PluginSettingsPage />);

      fireEvent.click(screen.getByRole("switch", { name: "Test Plugin" }));
      expect(enable).toHaveBeenCalledWith("dev.example.test", expect.anything());
      expect(screen.queryByText("Plugin Permissions")).not.toBeInTheDocument();
    });

    it("leaves the plugin off when its permission prompt is cancelled", () => {
      const { enable } = mockToggles();
      const approve = vi.fn();
      vi.mocked(useApproveCapabilities).mockReturnValue({
        mutate: approve,
        isPending: false,
      } as unknown as ReturnType<typeof useApproveCapabilities>);
      listPlugins([makePlugin({ capabilities: ["ui.panel"] })]);
      render(<PluginSettingsPage />);

      fireEvent.click(screen.getByRole("switch", { name: "Test Plugin" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText("Plugin Permissions")).not.toBeInTheDocument();
      expect(approve).not.toHaveBeenCalled();
      expect(enable).not.toHaveBeenCalled();
    });
  });

  describe("dismissing the changed-bundle warning", () => {
    beforeEach(() => {
      usePluginFingerprintDismissStore.setState({ dismissed: {} });
    });

    function mockDisable() {
      const mutate = vi.fn();
      vi.mocked(usePluginDisable).mockReturnValue({ mutate } as unknown as ReturnType<
        typeof usePluginDisable
      >);
      return mutate;
    }

    it("hides the banner until the fingerprint changes again", () => {
      mockDisable();
      listPlugins([makePlugin({ fingerprint_changed: true, current_fingerprint: "aaa" })]);
      const { rerender } = render(<PluginSettingsPage />);

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(screen.queryByText("Plugin bundle has changed")).not.toBeInTheDocument();
      expect(screen.getByText("Bundle changed")).toBeInTheDocument();
      expect(usePluginFingerprintDismissStore.getState().dismissed).toEqual({
        "dev.example.test": "aaa",
      });

      listPlugins([makePlugin({ fingerprint_changed: true, current_fingerprint: "aaa" })]);
      rerender(<PluginSettingsPage />);
      expect(screen.queryByText("Plugin bundle has changed")).not.toBeInTheDocument();

      listPlugins([makePlugin({ fingerprint_changed: true, current_fingerprint: "bbb" })]);
      rerender(<PluginSettingsPage />);
      expect(screen.getByText("Plugin bundle has changed")).toBeInTheDocument();
    });

    it("shows a dismissed banner again from the Bundle changed badge", () => {
      mockDisable();
      listPlugins([makePlugin({ fingerprint_changed: true, current_fingerprint: "aaa" })]);
      render(<PluginSettingsPage />);

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      fireEvent.click(screen.getByRole("button", { name: /bundle changed/i }));

      expect(screen.getByText("Plugin bundle has changed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /trust new version/i })).toBeInTheDocument();
    });

    it("stops a running plugin, and leaves a stopped one alone", () => {
      const disable = mockDisable();
      listPlugins([
        makePlugin({ fingerprint_changed: true, current_fingerprint: "aaa", enabled: true }),
      ]);
      const { unmount } = render(<PluginSettingsPage />);
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(disable).toHaveBeenCalledWith("dev.example.test");
      unmount();

      disable.mockClear();
      usePluginFingerprintDismissStore.setState({ dismissed: {} });
      listPlugins([makePlugin({ fingerprint_changed: true, current_fingerprint: "aaa" })]);
      render(<PluginSettingsPage />);
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(disable).not.toHaveBeenCalled();
    });
  });

  it("keeps the rarer actions in the row's more-actions menu", () => {
    listPlugins([makePlugin({ display_name: "Kubernetes Pods", source: { kind: "local" } })]);
    render(<PluginSettingsPage />);
    expect(screen.queryByRole("button", { name: "Permissions" })).not.toBeInTheDocument();

    const more = screen.getByRole("button", { name: "More actions for Kubernetes Pods" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "More actions for Kubernetes Pods" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Permissions", "Activity", "Uninstall…"]);
    // Uninstall stands apart from the rest.
    expect(within(menu).getByRole("separator").nextElementSibling).toHaveTextContent("Uninstall…");

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Permissions" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Plugin Permissions")).toBeInTheDocument();
    // Opened from the menu, it only changes permissions.
    expect(within(dialog).getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("uninstalls a plugin only once the user confirms", async () => {
    listPlugins([makePlugin({ display_name: "Kubernetes Pods", source: { kind: "local" } })]);
    const mutate = mockUninstall(false, (_id, options) => options.onSuccess());
    render(<PluginSettingsPage />);
    clickUninstall();
    const dialog = screen.getByRole("dialog", { name: "Uninstall Kubernetes Pods?" });
    expect(dialog).toHaveTextContent(
      "removed from this device, with the permissions you granted it and the data it stored. Its files are deleted from the plugins folder.",
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    clickUninstall();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    clickUninstall();
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith("dev.example.test", expect.anything());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says the folder of a plugin the app did not install stays", () => {
    listPlugins([makePlugin({ source: null })]);
    mockUninstall();
    render(<PluginSettingsPage />);

    clickUninstall();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The app did not install it, so its folder stays in the plugins folder.",
    );
  });

  it("keeps the uninstall dialog open with the reason when the uninstall fails", () => {
    listPlugins([makePlugin()]);
    mockUninstall(false, (_id, options) =>
      options.onError({ message: "io error: Permission denied" }),
    );
    render(<PluginSettingsPage />);

    clickUninstall();
    fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "io error: Permission denied",
    );
  });

  it("disables the uninstall confirmation while the uninstall runs", () => {
    listPlugins([makePlugin()]);
    mockUninstall(true);
    render(<PluginSettingsPage />);

    clickUninstall();
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
    // Right after an install, approving also turns the plugin on.
    expect(within(dialog).getByRole("button", { name: "Approve and turn on" })).toBeInTheDocument();
    expect(
      within(dialog).getByText("Your cluster credentials never leave this device."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Render UI Panels")).toBeInTheDocument();
  });

  describe("View details", () => {
    const longDescription =
      "Lists the pods of the cluster your kubeconfig points at.\nYour cluster credentials never leave this device.";

    function k8sPlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
      return makePlugin({
        plugin_id: "chat.rim.k8s-pods",
        display_name: "Kubernetes Pods",
        version: "0.3.1",
        author: "RIM",
        description: longDescription,
        runtime_kind: "DesktopLocalProcess",
        source: { kind: "git", url: "https://github.com/rim-platform/plugin-k8s-pods" },
        capabilities: ["ui.panel", "network.fetch"],
        approved_capabilities: ["ui.panel"],
        network_origins: ["https://k8s.example.com:6443"],
        commands: [
          {
            id: "restart_pod",
            qualified_id: "plugin.chat.rim.k8s-pods.restart_pod",
            title: "Restart pod",
            description: "Deletes the pod so its controller starts a new one.",
            keybind_capable: false,
            dangerous: true,
            ai_callable: false,
            arguments: [],
          },
        ],
        ...overrides,
      });
    }

    function openDetails() {
      fireEvent.click(screen.getByRole("button", { name: "View details for Kubernetes Pods" }));
      return screen.getByRole("dialog", { name: "Kubernetes Pods" });
    }

    it("clamps the description on the row to two lines", () => {
      listPlugins([k8sPlugin()]);
      render(<PluginSettingsPage />);

      const description = screen.getByText(/Lists the pods of the cluster/);
      expect(description).toHaveClass("line-clamp-2");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("shows the whole description and what the plugin is, asks for and runs", () => {
      listPlugins([k8sPlugin()]);
      render(<PluginSettingsPage />);
      const dialog = openDetails();

      expect(within(dialog).getByText("From the plugin author:")).toBeInTheDocument();
      const quote = dialog.querySelector("blockquote") as HTMLElement;
      expect(quote.textContent).toBe(longDescription);
      expect(quote).toHaveClass("whitespace-pre-line");

      expect(within(dialog).getByText("chat.rim.k8s-pods")).toBeInTheDocument();
      expect(within(dialog).getByText("0.3.1")).toBeInTheDocument();
      expect(within(dialog).getByText("RIM")).toBeInTheDocument();
      expect(within(dialog).getByText("Runs on this computer")).toBeInTheDocument();
      expect(
        within(dialog).getByText("Git repository https://github.com/rim-platform/plugin-k8s-pods"),
      ).toBeInTheDocument();

      const panel = within(dialog).getByText("Render UI Panels").closest("li") as HTMLElement;
      expect(panel).toHaveTextContent("Granted");
      const fetch = within(dialog)
        .getByText("Connect to listed sites")
        .closest("li") as HTMLElement;
      expect(fetch).toHaveTextContent("Not granted");
      expect(within(dialog).getByText("https://k8s.example.com:6443")).toBeInTheDocument();

      const command = within(dialog).getByText("Restart pod").closest("li") as HTMLElement;
      expect(command).toHaveTextContent("Dangerous");
      expect(command).toHaveTextContent("Deletes the pod so its controller starts a new one.");
    });

    it("shows the description as text, not as HTML or markdown", () => {
      listPlugins([
        k8sPlugin({ description: "<b>bold</b> and **stars** and [a](https://x.test)" }),
      ]);
      render(<PluginSettingsPage />);
      const dialog = openDetails();

      const quote = dialog.querySelector("blockquote") as HTMLElement;
      expect(quote.textContent).toBe("<b>bold</b> and **stars** and [a](https://x.test)");
      expect(quote.querySelector("b, strong, a")).toBeNull();
    });

    it("says when there is no description, permission or command", () => {
      listPlugins([k8sPlugin({ description: "", capabilities: [], commands: [] })]);
      render(<PluginSettingsPage />);
      const dialog = openDetails();

      expect(within(dialog).getByText("The plugin has no description.")).toBeInTheDocument();
      expect(within(dialog).getByText("The plugin asks for no permissions.")).toBeInTheDocument();
      expect(within(dialog).getByText("The plugin has no commands.")).toBeInTheDocument();
    });

    it("closes with the close button and with Escape", () => {
      listPlugins([k8sPlugin()]);
      render(<PluginSettingsPage />);

      fireEvent.click(within(openDetails()).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();

      openDetails();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
    });
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
