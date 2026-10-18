import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ──────────────────────────────────────────────────────────────
// Hoist mocks before any imports that reference them
// ──────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn().mockReturnValue(true),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    capabilities: { pluginHost: true, agent: true },
  }),
}));

const mockApproveMutate = vi.fn();
const mockRevokeMutate = vi.fn();
const mockRevokeAllMutate = vi.fn();
const mockRevokeAllPluginsMutate = vi.fn();

vi.mock("../api/usePluginAiConsent", () => ({
  useApproveAiCommands: () => ({
    mutate: mockApproveMutate,
    isPending: false,
  }),
  useRevokeAiConsent: () => ({
    mutate: mockRevokeMutate,
    isPending: false,
  }),
  useRevokeAllAiConsent: () => ({
    mutate: mockRevokeAllMutate,
    isPending: false,
  }),
  useRevokeAllPluginsAiConsent: () => ({
    mutate: mockRevokeAllPluginsMutate,
    isPending: false,
  }),
}));

vi.mock("../api/usePluginList", () => ({
  usePluginList: () => ({
    data: mockPlugins,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("../../../shared/toast/useToastStore", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { PluginAiConsentPanel } from "./PluginAiConsentPanel";
import type { PluginInfo } from "../types";

// ──────────────────────────────────────────────────────────────
// Shared test data
// ──────────────────────────────────────────────────────────────

let mockPlugins: PluginInfo[];

function makePlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    plugin_id: "test-plugin",
    manifest_id: "test-plugin",
    display_name: "Test Plugin",
    version: "1.0.0",
    description: "A test plugin",
    author: "Author",
    enabled: true,
    capabilities: [],
    approved_capabilities: [],
    approved_ai_commands: [],
    ai_callable_commands: ["test-plugin::run", "test-plugin::query"],
    ai_consent_required: false,
    health: "running",
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe("PluginAiConsentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlugins = [makePlugin()];
  });

  it("renders plugin list with AI-callable commands", () => {
    render(<PluginAiConsentPanel />, { wrapper });

    expect(screen.getByText("Test Plugin")).toBeInTheDocument();
    expect(screen.getByText("test-plugin")).toBeInTheDocument();
    expect(screen.getByText("0 / 2 AI commands approved")).toBeInTheDocument();
  });

  it("shows AI consent required badge when consent is required and no approvals", () => {
    mockPlugins = [makePlugin({ ai_consent_required: true })];
    render(<PluginAiConsentPanel />, { wrapper });

    expect(screen.getByText("AI consent required")).toBeInTheDocument();
  });

  it("does not show badge when commands are already approved", () => {
    mockPlugins = [
      makePlugin({
        ai_consent_required: true,
        approved_ai_commands: ["test-plugin::run"],
      }),
    ];
    render(<PluginAiConsentPanel />, { wrapper });

    expect(screen.queryByText("AI consent required")).not.toBeInTheDocument();
  });

  it("shows empty state when no AI-enabled plugins", () => {
    mockPlugins = [makePlugin({ ai_callable_commands: [], ai_consent_required: false })];
    render(<PluginAiConsentPanel />, { wrapper });

    expect(screen.getByText("No plugins with AI-callable commands installed.")).toBeInTheDocument();
  });

  it("expands command list on chevron click and shows checkboxes", async () => {
    render(<PluginAiConsentPanel />, { wrapper });

    const expandButton = screen.getByLabelText("Expand");
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText("test-plugin::run")).toBeInTheDocument();
      expect(screen.getByText("test-plugin::query")).toBeInTheDocument();
    });
  });

  it("clicking unapproved toggle triggers first-grant confirmation modal", async () => {
    render(<PluginAiConsentPanel />, { wrapper });

    // Expand to see checkboxes
    fireEvent.click(screen.getByLabelText("Expand"));

    await waitFor(() => {
      expect(screen.getByText("test-plugin::run")).toBeInTheDocument();
    });

    // First grant — approved_ai_commands is empty
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    // Confirmation modal should appear
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Grant AI Access?")).toBeInTheDocument();
    });
  });

  it("confirming modal calls grant mutation", async () => {
    render(<PluginAiConsentPanel />, { wrapper });

    fireEvent.click(screen.getByLabelText("Expand"));

    await waitFor(() => screen.getByText("test-plugin::run"));

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    await waitFor(() => screen.getByText("Grant AI Access?"));

    fireEvent.click(screen.getByRole("button", { name: "Grant Access" }));

    expect(mockApproveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "test-plugin",
        commandIds: expect.arrayContaining(["test-plugin::run"]),
      }),
      expect.any(Object),
    );
  });

  it("cancelling modal does not call grant mutation", async () => {
    render(<PluginAiConsentPanel />, { wrapper });

    fireEvent.click(screen.getByLabelText("Expand"));

    await waitFor(() => screen.getByText("test-plugin::run"));

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    await waitFor(() => screen.getByText("Grant AI Access?"));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockApproveMutate).not.toHaveBeenCalled();
  });

  it("clicking approved toggle revokes directly (no modal)", async () => {
    mockPlugins = [
      makePlugin({ approved_ai_commands: ["test-plugin::run", "test-plugin::query"] }),
    ];
    render(<PluginAiConsentPanel />, { wrapper });

    fireEvent.click(screen.getByLabelText("Expand"));

    await waitFor(() => screen.getByText("test-plugin::run"));

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    // No modal — direct revoke
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockRevokeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "test-plugin",
        commandId: "test-plugin::run",
      }),
      expect.any(Object),
    );
  });

  it("per-plugin revoke-all button calls revokeAll hook with all approved commands", async () => {
    mockPlugins = [
      makePlugin({ approved_ai_commands: ["test-plugin::run", "test-plugin::query"] }),
    ];
    render(<PluginAiConsentPanel />, { wrapper });

    // The per-plugin "Revoke all" button (inside the plugin row)
    const revokeAllButtons = screen.getAllByRole("button", { name: "Revoke all" });
    // First match is the per-plugin row button (panel-level "Revoke all grants" is separate)
    fireEvent.click(revokeAllButtons[0]);

    expect(mockRevokeAllMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "test-plugin",
        commandIds: expect.arrayContaining(["test-plugin::run", "test-plugin::query"]),
      }),
      expect.any(Object),
    );
  });

  it("bulk approve-all triggers confirmation modal on first grant", async () => {
    render(<PluginAiConsentPanel />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Grant AI Access?")).toBeInTheDocument();
    });
  });

  it("approve all modal shows all command IDs", async () => {
    render(<PluginAiConsentPanel />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Approve all" }));

    await waitFor(() => {
      expect(screen.getByText("test-plugin::run")).toBeInTheDocument();
      expect(screen.getByText("test-plugin::query")).toBeInTheDocument();
    });
  });

  it("does not leak listener when component unmounts before listen() resolves", async () => {
    // Arrange: capture the resolve callback to settle the promise manually
    // after the component has already unmounted (simulating a slow Tauri IPC call).
    const { listen: mockListen } = await import("@tauri-apps/api/event");
    const mockListenFn = mockListen as ReturnType<typeof vi.fn>;

    let resolveListen!: (fn: () => void) => void;
    const listenPromise = new Promise<() => void>((resolve) => {
      resolveListen = resolve;
    });
    mockListenFn.mockReturnValueOnce(listenPromise);

    const unlistenSpy = vi.fn();

    // Act: mount then immediately unmount before listen() resolves
    const { unmount } = render(<PluginAiConsentPanel />, { wrapper });
    unmount();

    // Now resolve the listen() promise — simulates Tauri responding after unmount
    await act(async () => {
      resolveListen(unlistenSpy);
      await listenPromise;
    });

    // Assert: the unlisten function returned by listen() must have been called
    // immediately (cleanup path for the cancelled-flag branch), not leaked.
    expect(unlistenSpy).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────
  // Panel-level "Revoke all grants" button tests
  // ──────────────────────────────────────────────────────────────

  it("panel-level revoke-all button is hidden when no grants exist", () => {
    mockPlugins = [makePlugin({ approved_ai_commands: [] })];
    render(<PluginAiConsentPanel />, { wrapper });

    expect(screen.queryByRole("button", { name: "Revoke all grants" })).not.toBeInTheDocument();
  });

  it("panel-level revoke-all button is hidden when plugin list is empty", () => {
    mockPlugins = [makePlugin({ ai_callable_commands: [], ai_consent_required: false })];
    render(<PluginAiConsentPanel />, { wrapper });

    expect(screen.queryByRole("button", { name: "Revoke all grants" })).not.toBeInTheDocument();
  });

  it("panel-level revoke-all button is visible when at least one grant exists", () => {
    mockPlugins = [makePlugin({ approved_ai_commands: ["test-plugin::run"] })];
    render(<PluginAiConsentPanel />, { wrapper });

    expect(screen.getByRole("button", { name: "Revoke all grants" })).toBeInTheDocument();
  });

  it("clicking panel-level revoke-all opens confirmation dialog", async () => {
    mockPlugins = [makePlugin({ approved_ai_commands: ["test-plugin::run"] })];
    render(<PluginAiConsentPanel />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Revoke all grants" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("Revoke all AI grants?")).toBeInTheDocument();
    });
  });

  it("confirmation dialog shows correct grant count", async () => {
    mockPlugins = [
      makePlugin({ approved_ai_commands: ["test-plugin::run", "test-plugin::query"] }),
    ];
    render(<PluginAiConsentPanel />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Revoke all grants" }));

    await waitFor(() => {
      expect(screen.getByText(/2 approved commands/)).toBeInTheDocument();
    });
  });

  it("cancelling confirmation dialog does not call the mutation", async () => {
    mockPlugins = [makePlugin({ approved_ai_commands: ["test-plugin::run"] })];
    render(<PluginAiConsentPanel />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Revoke all grants" }));
    await waitFor(() => screen.getByRole("dialog"));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockRevokeAllPluginsMutate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("confirming calls useRevokeAllPluginsAiConsent with all plugins and their approved commands", async () => {
    mockPlugins = [
      makePlugin({
        plugin_id: "plugin-a",
        manifest_id: "plugin-a",
        display_name: "Plugin A",
        approved_ai_commands: ["plugin-a::run"],
      }),
      makePlugin({
        plugin_id: "plugin-b",
        manifest_id: "plugin-b",
        display_name: "Plugin B",
        approved_ai_commands: ["plugin-b::search", "plugin-b::list"],
      }),
    ];
    render(<PluginAiConsentPanel />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Revoke all grants" }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));

    // Click the confirm button inside the dialog (not the panel-header trigger)
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all grants" }));

    expect(mockRevokeAllPluginsMutate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ pluginId: "plugin-a", commandIds: ["plugin-a::run"] }),
        expect.objectContaining({
          pluginId: "plugin-b",
          commandIds: ["plugin-b::search", "plugin-b::list"],
        }),
      ]),
      expect.any(Object),
    );
  });

  it("success-all: onSuccess callback toasts singular revoked count", async () => {
    const { toast } = await import("../../../shared/toast/useToastStore");
    mockPlugins = [makePlugin({ approved_ai_commands: ["test-plugin::run"] })];

    // Capture the onSuccess callback from the mutate call
    mockRevokeAllPluginsMutate.mockImplementation(
      (
        _vars: unknown,
        callbacks: { onSuccess?: (data: { revokedCount: number; failedCount: number }) => void },
      ) => {
        callbacks?.onSuccess?.({ revokedCount: 1, failedCount: 0 });
      },
    );

    render(<PluginAiConsentPanel />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Revoke all grants" }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all grants" }));

    expect(toast.success).toHaveBeenCalledWith("Revoked 1 AI grant");
  });

  it("partial-failure: onSuccess with failedCount > 0 toasts error with counts", async () => {
    const { toast } = await import("../../../shared/toast/useToastStore");
    mockPlugins = [
      makePlugin({ approved_ai_commands: ["test-plugin::run", "test-plugin::query"] }),
    ];

    mockRevokeAllPluginsMutate.mockImplementation(
      (
        _vars: unknown,
        callbacks: { onSuccess?: (data: { revokedCount: number; failedCount: number }) => void },
      ) => {
        callbacks?.onSuccess?.({ revokedCount: 1, failedCount: 1 });
      },
    );

    render(<PluginAiConsentPanel />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Revoke all grants" }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all grants" }));

    expect(toast.error).toHaveBeenCalledWith("Revoked 1, failed 1 (see console)");
  });

  it("all-fail: onError callback toasts generic failure message", async () => {
    const { toast } = await import("../../../shared/toast/useToastStore");
    mockPlugins = [makePlugin({ approved_ai_commands: ["test-plugin::run"] })];

    mockRevokeAllPluginsMutate.mockImplementation(
      (_vars: unknown, callbacks: { onError?: () => void }) => {
        callbacks?.onError?.();
      },
    );

    render(<PluginAiConsentPanel />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Revoke all grants" }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke all grants" }));

    expect(toast.error).toHaveBeenCalledWith("Failed to revoke AI grants");
  });
});
