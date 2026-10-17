/**
 * Git install flow (the consent to dependency install steps, and the typed
 * git URL refusal) through the real `usePluginInstallFromGit` hook and
 * `safeInvoke`, with only the Tauri IPC mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(),
}));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: vi.fn(() => ({
    platform: "desktop",
    osType: "linux",
    capabilities: { pluginHost: true },
  })),
}));

vi.mock("../registry/components/RegistryNotes", () => ({ RegistryNotes: () => null }));
vi.mock("../registry/signing", () => ({
  usePluginSigning: () => ({ canSign: false, identity: undefined }),
}));
vi.mock("../api/usePluginList", () => ({
  usePluginList: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("../../commands/api/useCommands", () => ({
  reloadCommands: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { PluginSettingsPage } from "./PluginSettingsPage";

const mockInvoke = vi.mocked(invoke);

const URL = "https://github.com/acme/rim-weather";

const consentError = {
  kind: "POST_INSTALL_CONSENT_REQUIRED",
  message:
    "plugin dev.acme.weather needs post-install steps that run code from the plugin author; explicit consent is required",
  data: {
    plugin_id: "dev.acme.weather",
    steps: [
      {
        program: "npm",
        args: ["install", "--production"],
        working_dir: "/home/u/.rim/plugins/dev.acme.weather",
        trigger_file: "package.json",
        command_line: "npm install --production",
      },
    ],
  },
};

const installResult = {
  plugin_id: "dev.acme.weather",
  display_name: "Weather",
  version: "1.0.0",
  capabilities: [],
  install_path: "/home/u/.rim/plugins/dev.acme.weather",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PluginSettingsPage />
    </QueryClientProvider>,
  );
}

function submitUrl(url: string) {
  fireEvent.click(screen.getByRole("button", { name: /install from git url/i }));
  fireEvent.change(screen.getByLabelText("Git repository URL"), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
}

function installCalls() {
  return mockInvoke.mock.calls.filter(([cmd]) => cmd === "plugin_install_from_git");
}

describe("PluginSettingsPage — git install consent flow", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("first attempt never sends consent, and shows the exact commands when required", async () => {
    mockInvoke.mockRejectedValueOnce(consentError);
    renderPage();

    submitUrl(URL);

    expect(
      await screen.findByRole("dialog", { name: "Run plugin install scripts?" }),
    ).toBeVisible();
    expect(screen.getByText("npm install --production")).toBeInTheDocument();
    expect(screen.getByText("/home/u/.rim/plugins/dev.acme.weather")).toBeInTheDocument();
    expect(installCalls()).toEqual([
      [
        "plugin_install_from_git",
        {
          url: URL,
          branch: null,
          allowPostInstall: false,
          forbiddenOrigins: expect.any(Array),
        },
      ],
    ]);
  });

  it("cancel closes the dialog without retrying", async () => {
    mockInvoke.mockRejectedValueOnce(consentError);
    renderPage();

    submitUrl(URL);
    const dialog = await screen.findByRole("dialog", { name: "Run plugin install scripts?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Run plugin install scripts?" })).toBeNull(),
    );
    expect(installCalls()).toHaveLength(1);
  });

  it("confirm retries the same URL with allowPostInstall: true", async () => {
    mockInvoke.mockRejectedValueOnce(consentError).mockResolvedValueOnce(installResult);
    renderPage();

    submitUrl(URL);
    await screen.findByRole("dialog", { name: "Run plugin install scripts?" });
    fireEvent.click(screen.getByRole("button", { name: "Run commands and install" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Run plugin install scripts?" })).toBeNull(),
    );
    expect(installCalls()).toEqual([
      [
        "plugin_install_from_git",
        {
          url: URL,
          branch: null,
          allowPostInstall: false,
          forbiddenOrigins: expect.any(Array),
        },
      ],
      [
        "plugin_install_from_git",
        {
          url: URL,
          branch: null,
          allowPostInstall: true,
          forbiddenOrigins: expect.any(Array),
        },
      ],
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the typed INVALID_GIT_URL message and no consent dialog", async () => {
    mockInvoke.mockRejectedValueOnce({
      kind: "INVALID_GIT_URL",
      message:
        "invalid git URL: remote-helper syntax ('::') is not allowed; only https://, ssh:// or git@host:owner/repo URLs are accepted",
    });
    renderPage();

    submitUrl("ext::sh -c id");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "invalid git URL: remote-helper syntax ('::') is not allowed",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a malformed consent payload falls back to the error message, never a retry", async () => {
    mockInvoke.mockRejectedValueOnce({ ...consentError, data: { plugin_id: "x", steps: "npm" } });
    renderPage();

    submitUrl(URL);

    expect(await screen.findByRole("alert")).toHaveTextContent("explicit consent is required");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(installCalls()).toHaveLength(1);
  });
});
