import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

// ──────────────────────────────────────────────────────────────
// Hoist mocks — must precede any import that transitively loads the module
// ──────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// runtimeCapabilities is hoisted so individual tests can override agent: false.
const { runtimeCaps } = vi.hoisted(() => {
  const runtimeCaps = { agent: true };
  return { runtimeCaps };
});

vi.mock("../../../core/runtime/RuntimeProvider", () => ({
  useRuntime: () => ({
    capabilities: runtimeCaps,
  }),
}));

vi.mock("../../../shared/toast/useToastStore", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// Stub provider factories — only config.models matters for these tests.
vi.mock("../providers/anthropic", () => ({
  createAnthropicProvider: () => ({
    config: {
      id: "anthropic",
      name: "Anthropic Claude",
      models: [
        {
          id: "claude-sonnet-5-5",
          name: "Claude Sonnet 5.5",
          contextWindow: 200_000,
          supportsTools: true,
          supportsStreaming: true,
        },
      ],
    },
  }),
}));

vi.mock("../providers/openai", () => ({
  createOpenAiProvider: () => ({
    config: {
      id: "openai",
      name: "OpenAI",
      models: [
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          contextWindow: 128_000,
          supportsTools: true,
          supportsStreaming: true,
        },
      ],
    },
  }),
}));

vi.mock("../providers/registry", () => ({
  getProvider: () => undefined,
}));

// useAgentStore is called both as a hook (selector pattern) and imperatively
// via `useAgentStore.getState()`. We use vi.hoisted so the mock object is
// available both inside the vi.mock factory (hoisted) and in test body resets.
const { agentStoreState } = vi.hoisted(() => {
  const agentStoreState = {
    settings: { providerId: "anthropic", modelId: "claude-sonnet-5-5", systemPrompt: "" },
    hasApiKey: false,
    updateSettings: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(agentStoreState.settings, patch);
    }),
    setHasApiKey: vi.fn((v: boolean) => {
      agentStoreState.hasApiKey = v;
    }),
    setLoadApiKeyStatus: vi.fn(),
  };
  return { agentStoreState };
});

vi.mock("../state/useAgentStore", () => {
  const useAgentStore = (selector: (s: typeof agentStoreState) => unknown) =>
    selector(agentStoreState);
  useAgentStore.getState = () => agentStoreState;
  return { useAgentStore };
});

import { AgentSettingsPanel } from "./AgentSettingsPanel";
import { useLiveModelsStore } from "../state/useLiveModelsStore";
import { toast } from "../../../shared/toast/useToastStore";
import { withServerInfo, type FakeFeatures } from "../../../test/serverInfo";
import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function setup(features: FakeFeatures = {}) {
  return render(<AgentSettingsPanel />, { wrapper: withServerInfo(features) });
}

type IpcAnswer = unknown | ((args: Record<string, unknown>) => Promise<unknown>);

/**
 * Answers each IPC command from `answers`: a function is called with the
 * command's arguments, any other value resolves as is. Unlisted commands see
 * no key and an empty model list.
 */
function answerIpc(answers: Record<string, IpcAnswer>) {
  const all: Record<string, IpcAnswer> = {
    is_provider_key_configured: false,
    agent_list_models: { data: [] },
    ...answers,
  };
  mockInvoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
    const answer = all[cmd];
    return typeof answer === "function" ? answer(args) : Promise.resolve(answer);
  });
}

/** Calls of one IPC command so far. */
function ipcCalls(cmd: string) {
  return mockInvoke.mock.calls.filter(([called]: [string]) => called === cmd);
}

/** Waits until the model picker shows and its model fetch has finished. */
async function modelsSettled() {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Refresh models/i })).toBeEnabled();
  });
}

/** An Anthropic model list whose newest entry is Claude Opus 5.5. */
const ANTHROPIC_LIVE = {
  data: [
    {
      id: "claude-sonnet-5-5",
      display_name: "Claude Sonnet 5.5",
      type: "model",
      created_at: "2026-08-01T00:00:00Z",
    },
    {
      id: "claude-opus-5-5",
      display_name: "Claude Opus 5.5",
      type: "model",
      created_at: "2026-09-01T00:00:00Z",
    },
  ],
};

// ──────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────

describe("AgentSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    agentStoreState.settings = {
      providerId: "anthropic",
      modelId: "claude-sonnet-5-5",
      systemPrompt: "",
    };
    agentStoreState.hasApiKey = false;
    useLiveModelsStore.setState({ byProvider: {} });
    answerIpc({});
  });

  // ── Rendering ────────────────────────────────────────────────

  it("renders heading and subhead", async () => {
    setup();
    expect(screen.getByRole("heading", { name: "AI Agent" })).toBeInTheDocument();
    expect(screen.getByText(/Keys are stored in your secret vault/)).toBeInTheDocument();
  });

  it("says the AI command surface is switched off while the server has it off", () => {
    setup({ ai_commands: ServerFeatureState.DISABLED });
    expect(
      screen.getByText("The AI command surface is switched off on this server."),
    ).toBeInTheDocument();
  });

  it("shows no switched-off notice while the server runs AI commands", () => {
    setup();
    expect(screen.queryByText(/AI command surface is switched off/)).not.toBeInTheDocument();
  });

  it("renders the data-leakage security banner", async () => {
    setup();
    expect(
      screen.getByText(/workspace data.*sent to the selected AI provider/i),
    ).toBeInTheDocument();
  });

  it("renders provider selector with Anthropic and OpenAI options", async () => {
    setup();
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(screen.getByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(screen.getByText("OpenAI (GPT)")).toBeInTheDocument();
  });

  it("renders the testid data-testid=agent-settings wrapper", async () => {
    const { container } = setup();
    expect(container.querySelector("[data-testid='agent-settings']")).toBeInTheDocument();
  });

  // ── Keyring presence check on mount ─────────────────────────

  it("calls is_provider_key_configured for the current provider on mount", async () => {
    setup();
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("is_provider_key_configured", {
        provider: "anthropic",
      });
    });
  });

  it("shows 'No key configured' pill when keyring returns false", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByText("No key configured")).toBeInTheDocument();
    });
  });

  it("shows 'Key set' pill when keyring returns true", async () => {
    answerIpc({ is_provider_key_configured: true });
    setup();
    await waitFor(() => {
      expect(screen.getByText("Key set")).toBeInTheDocument();
    });
  });

  // ── Verify & Save — valid key flow ───────────────────────────

  describe("Verify & Save — valid key", () => {
    beforeEach(() => {
      answerIpc({
        agent_validate_provided_key: { kind: "valid" },
        agent_list_models: ANTHROPIC_LIVE,
      });
    });

    it("calls agent_validate_provided_key THEN set_provider_key in that order", async () => {
      setup();
      await waitFor(() => screen.getByText("No key configured"));

      const input = screen.getByPlaceholderText("sk-ant-...");
      fireEvent.change(input, { target: { value: "sk-ant-test-key" } });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("agent_validate_provided_key", {
          provider: "anthropic",
          apiKey: "sk-ant-test-key",
        });
        expect(mockInvoke).toHaveBeenCalledWith("set_provider_key", {
          provider: "anthropic",
          apiKey: "sk-ant-test-key",
        });
      });

      // Ordering: validate must precede set_provider_key.
      const calls = mockInvoke.mock.calls.map(([cmd]: [string]) => cmd);
      const validateIdx = calls.indexOf("agent_validate_provided_key");
      const storeIdx = calls.indexOf("set_provider_key");
      expect(validateIdx).toBeGreaterThanOrEqual(0);
      expect(storeIdx).toBeGreaterThan(validateIdx);
    });

    it("shows 'Key verified and saved.' inline and success toast on valid", async () => {
      setup();
      await waitFor(() => screen.getByText("No key configured"));

      fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), {
        target: { value: "sk-ant-valid" },
      });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));

      await waitFor(() => {
        expect(screen.getByText("Key verified and saved.")).toBeInTheDocument();
      });
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("verified and saved"));
    });

    it("does NOT call agent_validate_credentials (old retired command)", async () => {
      setup();
      await waitFor(() => screen.getByText("No key configured"));

      fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), {
        target: { value: "sk-ant-valid" },
      });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));
      await waitFor(() => screen.getByText("Key verified and saved."));

      const oldCmdCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "agent_validate_credentials",
      );
      expect(oldCmdCalls).toHaveLength(0);
    });

    it("fetches the live model list once the key is saved", async () => {
      setup();
      await waitFor(() => screen.getByText("No key configured"));

      fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), {
        target: { value: "sk-ant-valid" },
      });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));
      await modelsSettled();

      expect(screen.getByRole("option", { name: "Claude Opus 5.5" })).toBeInTheDocument();
      expect(ipcCalls("agent_list_models")).toHaveLength(1);
    });
  });

  // ── Verify & Save — invalid key ──────────────────────────────

  describe("Verify & Save — invalid key", () => {
    beforeEach(() => {
      answerIpc({ agent_validate_provided_key: { kind: "invalid" } });
    });

    it("shows 'Invalid key — not saved' and does NOT call set_provider_key", async () => {
      setup();
      await waitFor(() => screen.getByText("No key configured"));

      fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), {
        target: { value: "sk-ant-bad" },
      });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));

      await waitFor(() => {
        expect(screen.getByText(/Invalid key — not saved/)).toBeInTheDocument();
      });

      const storeCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "set_provider_key",
      );
      expect(storeCalls).toHaveLength(0);
    });

    it("does NOT call clear_provider_key on invalid (existing key preserved)", async () => {
      setup();
      await waitFor(() => screen.getByText("No key configured"));

      fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), {
        target: { value: "sk-ant-bad" },
      });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));
      await waitFor(() => screen.getByText(/Invalid key — not saved/));

      const clearCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "clear_provider_key",
      );
      expect(clearCalls).toHaveLength(0);
    });

    it("success toast NOT fired on invalid", async () => {
      setup();
      await waitFor(() => screen.getByText("No key configured"));

      fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), {
        target: { value: "sk-ant-bad" },
      });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));
      await waitFor(() => screen.getByText(/Invalid key — not saved/));

      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  // ── Network error flow ───────────────────────────────────────

  describe("Network error flow", () => {
    it("shows network error inline, warning toast, and does NOT save key", async () => {
      answerIpc({
        agent_validate_provided_key: { kind: "network_error", message: "connection refused" },
      });

      setup();
      await waitFor(() => screen.getByText("No key configured"));

      fireEvent.change(screen.getByPlaceholderText("sk-ant-..."), {
        target: { value: "sk-ant-maybe" },
      });
      fireEvent.click(screen.getByRole("button", { name: /verify/i }));

      await waitFor(() => {
        expect(screen.getByText(/Could not reach Anthropic/)).toBeInTheDocument();
      });

      expect(toast.warning).toHaveBeenCalled();

      const storeCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "set_provider_key",
      );
      expect(storeCalls).toHaveLength(0);

      const clearCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "clear_provider_key",
      );
      expect(clearCalls).toHaveLength(0);
    });
  });

  // ── Delete key flow ──────────────────────────────────────────

  describe("Delete key flow", () => {
    it("shows delete button when key is configured", async () => {
      answerIpc({ is_provider_key_configured: true });

      setup();
      await waitFor(() => {
        const deleteButtons = screen.getAllByLabelText("Delete key");
        expect(deleteButtons.length).toBeGreaterThan(0);
      });
    });

    it("clicking delete calls clear_provider_key and flips pill to 'No key configured'", async () => {
      answerIpc({ is_provider_key_configured: true });

      setup();
      await waitFor(() => screen.getByText("Key set"));

      fireEvent.click(screen.getByLabelText("Delete key"));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("clear_provider_key", {
          provider: "anthropic",
        });
      });

      await waitFor(() => {
        expect(screen.getByText("No key configured")).toBeInTheDocument();
      });

      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("removed"));
    });
  });

  // ── Provider switch ──────────────────────────────────────────

  describe("Provider switch", () => {
    it("calls updateSettings with the new providerId on provider change", async () => {
      setup();
      await waitFor(() => screen.getByText("No key configured"));

      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "openai" } });

      // updateSettings must be called with the new provider.
      await waitFor(() => {
        expect(agentStoreState.updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ providerId: "openai" }),
        );
      });
    });

    it("calls is_provider_key_configured for the initial provider on mount", async () => {
      // On mount the effect fires once for the initially-selected provider.
      setup();

      await waitFor(() => {
        const calls = mockInvoke.mock.calls.filter(
          ([cmd]: [string]) => cmd === "is_provider_key_configured",
        );
        expect(calls.length).toBeGreaterThanOrEqual(1);
        expect(calls[0][1]).toEqual({ provider: "anthropic" });
      });
    });
  });

  // ── Model picker gating ──────────────────────────────────────

  it("model picker is hidden when no key is configured", async () => {
    setup();
    await waitFor(() => screen.getByText("No key configured"));

    // Model select and refresh-models button should not be present.
    expect(screen.queryByRole("button", { name: /Refresh models/i })).not.toBeInTheDocument();
    // No model option text visible.
    expect(screen.queryByText("Claude Sonnet 5.5")).not.toBeInTheDocument();
  });

  it("model picker is visible when key is configured", async () => {
    answerIpc({ is_provider_key_configured: true });

    setup();
    await waitFor(() => screen.getByText("Key set"));

    expect(screen.getByRole("button", { name: /Refresh models/i })).toBeInTheDocument();
  });

  // ── System prompt gating ─────────────────────────────────────

  it("system prompt textarea is hidden when no key is configured", async () => {
    setup();
    await waitFor(() => screen.getByText("No key configured"));

    expect(
      screen.queryByPlaceholderText(/Leave empty to use the default system prompt/),
    ).not.toBeInTheDocument();
  });

  it("system prompt textarea is visible when key is configured", async () => {
    answerIpc({ is_provider_key_configured: true });

    setup();
    await waitFor(() => screen.getByText("Key set"));

    expect(
      screen.getByPlaceholderText(/Leave empty to use the default system prompt/),
    ).toBeInTheDocument();
  });

  // ── Live model list ──────────────────────────────────────────

  describe("Live model list", () => {
    it("opening the panel with a key fetches the list once and selects its newest model", async () => {
      agentStoreState.settings.modelId = "claude-sonnet-4-20250514";
      answerIpc({ is_provider_key_configured: true, agent_list_models: ANTHROPIC_LIVE });

      setup();
      await modelsSettled();

      expect(screen.getByRole("option", { name: "Claude Opus 5.5" })).toBeInTheDocument();
      expect(screen.getByText("2 models loaded from API")).toBeInTheDocument();
      expect(agentStoreState.updateSettings).toHaveBeenCalledWith({ modelId: "claude-opus-5-5" });
      expect(ipcCalls("agent_list_models")).toEqual([
        ["agent_list_models", { provider: "anthropic" }],
      ]);
      expect(useLiveModelsStore.getState().byProvider.anthropic?.map((m) => m.name)).toEqual([
        "Claude Opus 5.5",
        "Claude Sonnet 5.5",
      ]);
    });

    it("a failed fetch keeps the fallback list and shows the error without a toast", async () => {
      answerIpc({
        is_provider_key_configured: true,
        agent_list_models: () => Promise.reject("provider returned error 500: overloaded"),
      });

      setup();
      await modelsSettled();

      expect(screen.getByText("provider returned error 500: overloaded")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Claude Sonnet 5.5" })).toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.warning).not.toHaveBeenCalled();
    });

    it("an empty list keeps the fallback list", async () => {
      answerIpc({ is_provider_key_configured: true });

      setup();
      await modelsSettled();

      expect(screen.getByRole("option", { name: "Claude Sonnet 5.5" })).toBeInTheDocument();
      expect(screen.queryByText(/models loaded from API/)).not.toBeInTheDocument();
    });

    it("refresh-models button fetches the list again", async () => {
      answerIpc({ is_provider_key_configured: true, agent_list_models: ANTHROPIC_LIVE });

      setup();
      await modelsSettled();
      fireEvent.click(screen.getByRole("button", { name: /Refresh models/i }));
      await modelsSettled();

      expect(ipcCalls("agent_list_models")).toHaveLength(2);
    });

    it("drops a list that arrives after the provider changed", async () => {
      const anthropicList = Promise.withResolvers<unknown>();
      answerIpc({
        is_provider_key_configured: ({ provider }: Record<string, unknown>) =>
          Promise.resolve(provider === "anthropic"),
        agent_list_models: () => anthropicList.promise,
      });

      const view = setup();
      await waitFor(() => expect(ipcCalls("agent_list_models")).toHaveLength(1));
      fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "openai" } });
      view.rerender(<AgentSettingsPanel />);
      await waitFor(() => screen.getByText("No key configured"));
      await act(async () => anthropicList.resolve(ANTHROPIC_LIVE));

      expect(agentStoreState.settings).toMatchObject({ providerId: "openai", modelId: "gpt-5.4" });
      expect(useLiveModelsStore.getState().byProvider).toEqual({});
    });
  });

  // ── Verify & Save button disabled state ──────────────────────

  it("Verify & Save button is disabled when input is empty", async () => {
    setup();
    await waitFor(() => screen.getByText("No key configured"));

    const verifyButton = screen.getByRole("button", { name: /verify/i });
    expect(verifyButton).toBeDisabled();
  });

  // ── Web mode guard ───────────────────────────────────────────

  it("shows web-mode fallback when capabilities.agent is false", async () => {
    // Flip the shared runtimeCaps to simulate web mode for this one render.
    runtimeCaps.agent = false;
    try {
      setup();
      expect(
        screen.getByText(/Key storage is only available in the desktop app/),
      ).toBeInTheDocument();
    } finally {
      runtimeCaps.agent = true;
    }
  });
});
