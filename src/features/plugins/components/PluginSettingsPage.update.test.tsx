/**
 * The Update action on a plugin's row: which plugins offer it, what it sends
 * to `plugin_update`, what the row says afterwards, and the permission and
 * install-step prompts it leads to, through the real `usePluginUpdate` hook
 * with only the Tauri IPC mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { PluginInfo, PluginInstallSource, PluginUpdateResult } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
}));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: vi.fn(),
}));

vi.mock("../registry/components/RegistryNotes", () => ({ RegistryNotes: () => null }));
vi.mock("../registry/signing", () => ({
  usePluginSigning: () => ({ canSign: false, identity: undefined }),
}));

let listed: PluginInfo[] = [];
vi.mock("../api/usePluginList", () => ({
  usePluginList: vi.fn(() => ({ data: listed, isLoading: false })),
}));

vi.mock("../../commands/api/useCommands", () => ({
  reloadCommands: vi.fn(),
}));

vi.mock("../web/webPluginHost", () => ({
  webPluginHost: { knows: vi.fn(() => false), stop: vi.fn(async () => {}) },
}));

import { invoke } from "@tauri-apps/api/core";
import { useRuntime } from "../../../core/runtime/RuntimeProvider";
import { webPluginHost } from "../web/webPluginHost";
import { PluginSettingsPage } from "./PluginSettingsPage";

const mockInvoke = vi.mocked(invoke);
const ID = "dev.acme.weather";
const GIT: PluginInstallSource = { kind: "git", url: "https://github.com/acme/rim-weather" };

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: ID,
    manifest_id: ID,
    display_name: "Weather",
    version: "1.0.0",
    description: "Forecasts in the side panel.",
    enabled: true,
    capabilities: ["ui.panel"],
    approved_capabilities: ["ui.panel"],
    approved_ai_commands: [],
    ai_callable_commands: [],
    ai_consent_required: false,
    fingerprint_changed: false,
    source: GIT,
    ...overrides,
  };
}

function updateResult(overrides: Partial<PluginUpdateResult> = {}): PluginUpdateResult {
  return {
    plugin_id: ID,
    updated: true,
    old_version: "1.0.0",
    new_version: "1.1.0",
    capabilities_changed: false,
    added_capabilities: [],
    removed_capabilities: [],
    ...overrides,
  };
}

function onPlatform(platform: "desktop" | "web") {
  vi.mocked(useRuntime).mockReturnValue({
    platform,
    osType: "linux",
    capabilities: { pluginHost: platform === "desktop", webPlugins: true },
  } as ReturnType<typeof useRuntime>);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PluginSettingsPage />
    </QueryClientProvider>,
  );
}

function updateCalls() {
  return mockInvoke.mock.calls.filter(([cmd]) => cmd === "plugin_update");
}

const consentError = {
  kind: "POST_INSTALL_CONSENT_REQUIRED",
  message: `plugin ${ID} needs post-install steps that run code from the plugin author; explicit consent is required`,
  data: {
    plugin_id: ID,
    steps: [
      {
        program: "npm",
        args: ["install", "--production"],
        working_dir: `/home/u/.rim/plugins/${ID}`,
        trigger_file: "package.json",
        command_line: "npm install --production",
      },
    ],
  },
};

describe("PluginSettingsPage — updating a plugin", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    vi.mocked(webPluginHost.knows).mockReturnValue(false);
    vi.mocked(webPluginHost.stop).mockClear();
    listed = [makePlugin()];
    onPlatform("desktop");
  });

  it("updates a git plugin by its id and says which version it now runs", async () => {
    mockInvoke.mockResolvedValueOnce(updateResult());
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(await screen.findByText("Updated to v1.1.0")).toBeInTheDocument();
    expect(updateCalls()).toEqual([
      [
        "plugin_update",
        { pluginId: ID, allowPostInstall: false, forbiddenOrigins: expect.any(Array) },
      ],
    ]);
    expect(screen.queryByText("Plugin Permissions")).not.toBeInTheDocument();
  });

  it("says when the plugin is already up to date", async () => {
    mockInvoke.mockResolvedValueOnce(
      updateResult({ updated: false, new_version: "1.0.0", old_version: "1.0.0" }),
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(await screen.findByText("Already up to date (v1.0.0)")).toBeInTheDocument();
  });

  it("shows the reason an update failed", async () => {
    mockInvoke.mockRejectedValueOnce({
      kind: "GIT_INSTALL_ERROR",
      message: "git pull failed: fatal: Not possible to fast-forward, aborting.",
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(
      await screen.findByText("git pull failed: fatal: Not possible to fast-forward, aborting."),
    ).toBeInTheDocument();
  });

  it("asks for the permissions a new version adds", async () => {
    mockInvoke.mockImplementationOnce(async () => {
      listed = [makePlugin({ version: "2.0.0", capabilities: ["ui.panel", "chat.read"] })];
      return updateResult({
        new_version: "2.0.0",
        capabilities_changed: true,
        added_capabilities: ["chat.read"],
      });
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Plugin Permissions")).toBeInTheDocument();
    expect(within(dialog).getByText("Read your conversations:")).toBeInTheDocument();
    expect(screen.getByText("Updated to v2.0.0")).toBeInTheDocument();
  });

  it("asks before running the new version's install steps, then retries with consent", async () => {
    mockInvoke.mockRejectedValueOnce(consentError).mockResolvedValueOnce(updateResult());
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    const dialog = await screen.findByRole("dialog", { name: "Run plugin install scripts?" });
    expect(within(dialog).getByText("npm install --production")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Run commands and install" }));

    expect(await screen.findByText("Updated to v1.1.0")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Run plugin install scripts?" })).toBeNull(),
    );
    expect(
      updateCalls().map(([, args]) => (args as { allowPostInstall: boolean }).allowPostInstall),
    ).toEqual([false, true]);
  });

  it("restarts a running sandboxed plugin on its new files", async () => {
    listed = [makePlugin({ runtime_kind: "WebSandboxed" })];
    vi.mocked(webPluginHost.knows).mockReturnValue(true);
    mockInvoke.mockResolvedValueOnce(updateResult());
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await screen.findByText("Updated to v1.1.0");
    expect(webPluginHost.stop).toHaveBeenCalledWith(ID);
  });

  it("is not offered for a plugin from a folder or the workspace registry", () => {
    listed = [
      makePlugin({ plugin_id: "a.local", display_name: "Local", source: { kind: "local" } }),
      makePlugin({
        plugin_id: "a.registry",
        display_name: "Registry",
        source: {
          kind: "registry",
          endpoint: "https://rim.example/api",
          serverId: "s",
          pluginId: "a.registry",
          statementSha256: "ab".repeat(32),
          publisherPrincipalId: "rimp1_x",
        },
      }),
      makePlugin({ plugin_id: "a.unknown", display_name: "Unknown", source: null }),
    ];
    renderPage();

    expect(screen.getAllByRole("button", { name: "Permissions" })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("says a link-installed plugin is updated by installing the new link", () => {
    listed = [
      makePlugin({
        source: {
          kind: "link",
          url: "https://example.com/weather.rimbundle",
          sha256: "cd".repeat(32),
        },
      }),
    ];
    renderPage();

    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(
      screen.getByText(
        "Installed from a link pinned to one bundle: install the new version's link to update it.",
      ),
    ).toBeInTheDocument();
  });

  it("is not offered on the web", () => {
    onPlatform("web");
    listed = [makePlugin({ runtime_kind: "WebSandboxed" })];
    renderPage();

    expect(screen.getByRole("button", { name: "Permissions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });
});
