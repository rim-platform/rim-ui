import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../../core/runtime/RuntimeProvider", () => ({ useRuntime: vi.fn() }));
vi.mock("../registry/components/RegistryNotes", () => ({ RegistryNotes: () => null }));
vi.mock("../registry/signing", () => ({
  usePluginSigning: () => ({ canSign: false, identity: undefined }),
}));
vi.mock("../api/usePluginList", () => ({ usePluginList: vi.fn() }));
vi.mock("../api/usePluginActions", () => ({
  usePluginEnable: () => ({ mutate: vi.fn() }),
  usePluginDisable: () => ({ mutate: vi.fn() }),
  usePluginUninstall: () => ({ mutate: vi.fn(), isPending: false }),
  usePluginInstallFromLocal: () => ({ mutate: vi.fn(), isPending: false }),
  usePluginInstallFromLink: () => ({ mutate: vi.fn(), isPending: false }),
  fetchLinkBundle: vi.fn(),
  usePluginInstallFromGit: () => ({ mutate: vi.fn(), isPending: false }),
  usePluginTrustFingerprint: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  usePluginUpdate: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
}));
vi.mock("../api/usePluginCapabilities", () => ({
  useApproveCapabilities: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeCapability: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../api/usePluginAiConsent", () => ({
  useApproveAiCommands: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeAiConsent: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeAllAiConsent: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokeAllPluginsAiConsent: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../agent/agentAvailability", () => ({ agentAvailable: () => true }));

import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { useShellStore } from "../../../shell/state/useShellStore";
import { usePluginList } from "../api/usePluginList";
import type { PluginInfo } from "../types";
import { PluginSettingsPage } from "./PluginSettingsPage";

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: "dev.example.test",
    manifest_id: "dev.example.test",
    display_name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    enabled: false,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    runtime_kind: "WebSandboxed",
    ...overrides,
  };
}

function listPlugins(plugins: PluginInfo[]) {
  vi.mocked(usePluginList).mockReturnValue({ data: plugins, isLoading: false } as ReturnType<
    typeof usePluginList
  >);
}

beforeEach(() => {
  vi.mocked(useRuntime).mockReturnValue({
    platform: "desktop",
    osType: "linux",
    capabilities: { pluginHost: true, webPlugins: true, agent: true },
  } as ReturnType<typeof useRuntime>);
  useShellStore.setState({ mainSurface: { kind: "settings", tab: "plugins" } });
});

describe("PluginSettingsPage layout", () => {
  it("groups plugins by how they run and leaves out an empty group", () => {
    listPlugins([
      makePlugin({ plugin_id: "a.sandboxed", display_name: "Boxed" }),
      makePlugin({
        plugin_id: "a.local",
        display_name: "Native",
        runtime_kind: "DesktopLocalProcess",
      }),
    ]);
    render(<PluginSettingsPage />);

    const sandboxed = screen.getByRole("region", { name: "Sandboxed plugins" });
    const local = screen.getByRole("region", { name: "Local process plugins" });
    expect(within(sandboxed).getByRole("switch", { name: "Boxed" })).toBeInTheDocument();
    expect(within(sandboxed).queryByRole("switch", { name: "Native" })).toBeNull();
    expect(within(local).getByRole("switch", { name: "Native" })).toBeInTheDocument();
    expect(local).toHaveTextContent("with your account's access");
    expect(sandboxed).not.toHaveTextContent("with your account's access");
  });

  it("shows only the group that has plugins", () => {
    listPlugins([makePlugin()]);
    render(<PluginSettingsPage />);
    expect(screen.queryByRole("region", { name: "Local process plugins" })).toBeNull();
    expect(screen.getByRole("region", { name: "Sandboxed plugins" })).toBeInTheDocument();
  });

  it("opens a row in place and closes it again", () => {
    listPlugins([makePlugin({ approved_capabilities: ["ui.panel"] })]);
    render(<PluginSettingsPage />);

    const toggle = screen.getByRole("button", { name: /Test Plugin/, expanded: false });
    expect(screen.queryByText("Permissions you granted")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Permissions you granted")).toBeInTheDocument();
    expect(screen.getByText("Render UI Panels")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Permissions you granted")).toBeNull();
  });

  it("opens several rows at once", () => {
    listPlugins([
      makePlugin({ plugin_id: "a.one", display_name: "One" }),
      makePlugin({ plugin_id: "a.two", display_name: "Two" }),
    ]);
    render(<PluginSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /One/, expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: /Two/, expanded: false }));
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(2);
  });

  it("warns about a local process inside its open row only", () => {
    listPlugins([makePlugin({ runtime_kind: "DesktopLocalProcess" })]);
    render(<PluginSettingsPage />);
    expect(screen.queryByText(/It is not sandboxed/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Test Plugin/, expanded: false }));
    expect(screen.getByText(/It is not sandboxed/)).toBeInTheDocument();
  });

  it("says the palette holds a plugin's commands only when it has some that run from it", () => {
    const command = {
      id: "go",
      qualified_id: "plugin.dev.example.test.go",
      title: "Go",
      description: "",
      keybind_capable: false,
      dangerous: false,
      ai_callable: false,
      read_only: false,
      arguments: [],
    };
    listPlugins([makePlugin({ commands: [command] })]);
    const { unmount } = render(<PluginSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Test Plugin/, expanded: false }));
    expect(screen.getByText(/in the command palette/)).toBeInTheDocument();
    expect(screen.queryByText(/macros/)).toBeNull();
    unmount();

    listPlugins([makePlugin({ commands: [] })]);
    render(<PluginSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Test Plugin/, expanded: false }));
    expect(screen.queryByText(/in the command palette/)).toBeNull();
  });

  it("offers the agent consent of the plugin and a way to Settings > Agents", () => {
    listPlugins([
      makePlugin({ ai_callable_commands: ["go"], runtime_kind: "DesktopLocalProcess" }),
    ]);
    render(<PluginSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Test Plugin/, expanded: false }));
    const section = screen.getByRole("region", { name: "What your agents can do with it" });
    expect(section).toHaveTextContent("0 / 1 AI commands approved");
    fireEvent.click(within(section).getByRole("button", { name: "Open Agents settings" }));
    expect(useShellStore.getState().mainSurface).toEqual({ kind: "settings", tab: "agents" });
  });

  it("leaves the agent section out where there is no agent", () => {
    vi.mocked(useRuntime).mockReturnValue({
      platform: "web",
      osType: "linux",
      capabilities: { pluginHost: false, webPlugins: true, agent: false },
    } as ReturnType<typeof useRuntime>);
    listPlugins([makePlugin()]);
    render(<PluginSettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Test Plugin/, expanded: false }));
    expect(screen.queryByText("What your agents can do with it")).toBeNull();
  });

  it("shows invisible and bidirectional characters of a name by their code points", () => {
    const rlo = "evil‮gpj.exe";
    listPlugins([makePlugin({ display_name: rlo, description: `about ‮${"x"}`, author: "a​b" })]);
    render(<PluginSettingsPage />);
    const shown = "evil⟦U+202E⟧gpj.exe";
    expect(screen.getByRole("switch", { name: shown })).toBeInTheDocument();
    expect(screen.getByText(shown)).toBeInTheDocument();
    expect(screen.getByText(/about ⟦U\+202E⟧x/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: new RegExp("evil"), expanded: false }));
    expect(screen.getByRole("button", { name: `Uninstall ${shown}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `View details for ${shown}` }));
    expect(screen.getByRole("dialog", { name: shown })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("‮");
  });

  it("reaches every control with Tab in page order, closed and open", async () => {
    const user = userEvent.setup();
    listPlugins([makePlugin({ display_name: "One" })]);
    render(<PluginSettingsPage />);

    const order = async () => {
      document.body.focus();
      const names: string[] = [];
      for (let i = 0; i < 20; i++) {
        await user.tab();
        const el = document.activeElement as HTMLElement;
        if (el === document.body) break;
        names.push(el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "");
      }
      return names;
    };

    const closed = await order();
    expect(closed.slice(-2)).toEqual([expect.stringContaining("One"), "One"]);
    expect(closed.indexOf("Install from link")).toBeLessThan(closed.length - 2);

    fireEvent.click(screen.getByRole("button", { name: /One/, expanded: false }));
    const open = await order();
    expect(open.slice(-5)).toEqual([
      "View details for One",
      "Activity",
      "Uninstall One",
      "Permissions for One",
      "Open Agents settings",
    ]);
  });
});
