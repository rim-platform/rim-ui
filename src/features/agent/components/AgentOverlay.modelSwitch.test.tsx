import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

import { withServerInfo } from "../../../test/serverInfo";
import { useAgentStore } from "../state/useAgentStore";
import { useLiveModelsStore } from "../state/useLiveModelsStore";
import { settingsTabCommandId } from "../../settings/settingsTabs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../tools/loader", () => ({
  loadAgentTools: vi.fn(() => Promise.resolve({ winners: [], droppedBuiltinNames: [] })),
}));
vi.mock("../runtime/agentEngine", () => ({ runAgent: vi.fn(() => Promise.resolve()) }));
vi.mock("../../commands/runtime/runFromClick", () => ({
  runCommandFromClick: vi.fn(() => Promise.resolve({ ok: true })),
}));

import { runAgent } from "../runtime/agentEngine";
import { runCommandFromClick } from "../../commands/runtime/runFromClick";
import { AgentOverlay } from "./AgentOverlay";

/** The providers with a key in the secret vault in a test. */
let keysSet = new Set<string>();

function onDesktop() {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
}

function offDesktop() {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

/** An open conversation with one prompt and its answer. */
function conversationWithAnswer() {
  useAgentStore.setState({
    isOpen: true,
    status: "done",
    conversations: [
      {
        id: "conv-1",
        createdAt: "2026-11-10T10:00:00.000Z",
        title: "Hi",
        messages: [
          { role: "user", content: "Hi", timestamp: "2026-11-10T10:00:00.000Z" },
          {
            role: "assistant",
            content: "Hello from Sonnet",
            timestamp: "2026-11-10T10:00:01.000Z",
          },
        ],
      },
    ],
    activeConversationId: "conv-1",
  });
}

function renderOverlay() {
  return render(<AgentOverlay />, { wrapper: withServerInfo() });
}

async function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: /^Model: / }));
  return screen.findByRole("menu", { name: "Models" });
}

async function sendPrompt(text: string) {
  const input = screen.getByPlaceholderText("Ask the assistant...");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(runAgent).toHaveBeenCalled());
}

describe("AgentOverlay model switch", () => {
  beforeEach(() => {
    keysSet = new Set(["anthropic"]);
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "is_provider_key_configured") {
        return keysSet.has((args as { provider: string }).provider);
      }
      return undefined;
    });
    vi.mocked(runAgent).mockClear();
    vi.mocked(runCommandFromClick).mockClear();
    localStorage.setItem("agent-disclaimer-accepted", "true");
    useLiveModelsStore.setState({ byProvider: {} });
    useAgentStore.setState({
      isOpen: true,
      status: "idle",
      settings: { providerId: "anthropic", modelId: "claude-sonnet-5-5", systemPrompt: "" },
    });
    onDesktop();
  });

  afterEach(() => {
    offDesktop();
    vi.mocked(invoke).mockReset();
  });

  it("names the current model in the header", () => {
    conversationWithAnswer();
    renderOverlay();
    expect(screen.getByRole("button", { name: "Model: claude-sonnet-5-5" })).toBeInTheDocument();
  });

  it("lists only the providers with a key, each with its live list when there is one", async () => {
    useLiveModelsStore.setState({
      byProvider: {
        anthropic: [
          {
            id: "claude-opus-5-5",
            name: "Claude Opus 5.5 (live)",
            contextWindow: 1_000_000,
            supportsTools: true,
            supportsStreaming: true,
          },
        ],
        openai: [
          {
            id: "gpt-6",
            name: "GPT-6",
            contextWindow: 128_000,
            supportsTools: true,
            supportsStreaming: true,
          },
        ],
      },
    });
    conversationWithAnswer();
    renderOverlay();

    const menu = await openPicker();

    expect(within(menu).getByText("Anthropic Claude")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemradio", { name: "Claude Opus 5.5 (live)" }),
    ).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitemradio", { name: "Claude Haiku 5.5" })).toBeNull();
    expect(within(menu).queryByText("OpenAI")).toBeNull();
    expect(within(menu).queryByRole("menuitemradio", { name: "GPT-6" })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "Model settings…" })).toBeInTheDocument();
  });

  it("lists the built-in models of a provider with no live list, grouped by provider", async () => {
    keysSet = new Set(["anthropic", "openai"]);
    conversationWithAnswer();
    renderOverlay();

    const menu = await openPicker();

    expect(within(menu).getByText("Anthropic Claude")).toBeInTheDocument();
    expect(within(menu).getByText("OpenAI")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: "Claude Sonnet 5.5" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(menu).getByRole("menuitemradio", { name: "GPT-5.5" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("says no provider has a key when none has", async () => {
    keysSet = new Set();
    conversationWithAnswer();
    renderOverlay();

    const menu = await openPicker();

    expect(within(menu).getByText("No provider has an API key set.")).toBeInTheDocument();
    expect(within(menu).queryAllByRole("menuitemradio")).toHaveLength(0);
    expect(within(menu).getByRole("menuitem", { name: "Model settings…" })).toBeInTheDocument();
  });

  it("switches within a provider, marks the switch and keeps the conversation", async () => {
    conversationWithAnswer();
    renderOverlay();

    const menu = await openPicker();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Claude Haiku 5.5" }));

    expect(useAgentStore.getState().settings.modelId).toBe("claude-haiku-5-5");
    expect(screen.getByRole("note")).toHaveTextContent("Switched to Claude Haiku 5.5");
    expect(screen.getByRole("button", { name: "Model: Claude Haiku 5.5" })).toBeInTheDocument();

    await sendPrompt("And now?");

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "And now?",
        providerId: "anthropic",
        modelId: "claude-haiku-5-5",
        existingMessages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello from Sonnet" },
        ],
      }),
    );
  });

  it("switches to another provider and continues the same conversation", async () => {
    keysSet = new Set(["anthropic", "openai"]);
    conversationWithAnswer();
    renderOverlay();

    const menu = await openPicker();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "GPT-5.5" }));

    expect(useAgentStore.getState().settings).toMatchObject({
      providerId: "openai",
      modelId: "gpt-5.5",
    });
    expect(screen.getByRole("note")).toHaveTextContent("Switched to GPT-5.5");
    expect(screen.queryByRole("button", { name: "Switch" })).toBeNull();

    await sendPrompt("And now?");

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "openai",
        modelId: "gpt-5.5",
        existingMessages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello from Sonnet" },
        ],
      }),
    );
    expect(useAgentStore.getState().activeConversationId).toBe("conv-1");
  });

  it("refuses to switch while a turn runs", () => {
    conversationWithAnswer();
    useAgentStore.setState({ status: "streaming" });
    renderOverlay();

    const picker = screen.getByRole("button", { name: /^Model: / });
    expect(picker).toBeDisabled();
    fireEvent.click(picker);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("is_provider_key_configured", expect.anything());
  });

  it("closes the menu on Escape and keeps the agent open", async () => {
    conversationWithAnswer();
    renderOverlay();

    const menu = await openPicker();
    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(useAgentStore.getState().isOpen).toBe(true);
  });

  it("opens the agent settings from Model settings…", async () => {
    conversationWithAnswer();
    renderOverlay();

    const menu = await openPicker();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Model settings…" }));

    expect(runCommandFromClick).toHaveBeenCalledWith(settingsTabCommandId("agent"), undefined, {
      source: "menu",
    });
    expect(useAgentStore.getState().isOpen).toBe(false);
  });
});
