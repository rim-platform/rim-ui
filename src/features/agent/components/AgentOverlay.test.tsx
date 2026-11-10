import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";

import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { withServerInfo } from "../../../test/serverInfo";
import { useAgentStore } from "../state/useAgentStore";
import { useLiveModelsStore } from "../state/useLiveModelsStore";

vi.mock("../tools/loader", () => ({
  loadAgentTools: vi.fn(() => Promise.resolve({ winners: [], droppedBuiltinNames: [] })),
}));

import { loadAgentTools } from "../tools/loader";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { AgentOverlay } from "./AgentOverlay";

/** Makes the app the desktop app, where the agent runs. */
function onDesktop() {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
}

function offDesktop() {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

describe("AgentOverlay and the ai_commands switch", () => {
  beforeEach(() => {
    vi.mocked(loadAgentTools).mockClear();
    localStorage.setItem("agent-disclaimer-accepted", "true");
    useAgentStore.setState({ isOpen: true });
    onDesktop();
  });

  afterEach(offDesktop);

  it("opens the agent while the server runs AI commands", () => {
    render(<AgentOverlay />, { wrapper: withServerInfo() });
    expect(screen.getByPlaceholderText("Ask the agent...")).toBeInTheDocument();
    expect(loadAgentTools).toHaveBeenCalled();
  });

  it("says the AI command surface is switched off, and loads no tools, while it is off", () => {
    render(<AgentOverlay />, {
      wrapper: withServerInfo({ ai_commands: ServerFeatureState.DISABLED }),
    });

    expect(
      screen.getByText("The AI command surface is switched off on this server."),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Ask the agent...")).not.toBeInTheDocument();
    expect(loadAgentTools).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useAgentStore.getState().isOpen).toBe(false);
  });
});

describe("AgentOverlay model label", () => {
  const opus = {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStreaming: true,
  };

  beforeEach(() => {
    localStorage.setItem("agent-disclaimer-accepted", "true");
    useAgentStore.setState({
      isOpen: true,
      settings: { providerId: "anthropic", modelId: "claude-opus-5-5", systemPrompt: "" },
    });
    useLiveModelsStore.setState({ byProvider: {} });
    onDesktop();
  });

  afterEach(offDesktop);

  it("names the model by its display name from the live list", () => {
    useLiveModelsStore.setState({ byProvider: { anthropic: [opus] } });
    render(<AgentOverlay />, { wrapper: withServerInfo() });
    expect(screen.getByRole("button", { name: "Model: Claude Opus 5.5" })).toBeInTheDocument();
  });

  it("names the model by its whole id when the live list lacks it", () => {
    useLiveModelsStore.setState({ byProvider: { openai: [{ ...opus, id: "gpt-5.4" }] } });
    render(<AgentOverlay />, { wrapper: withServerInfo() });
    expect(screen.getByRole("button", { name: "Model: claude-opus-5-5" })).toBeInTheDocument();
  });
});

describe("AgentOverlay and a failed tool load", () => {
  beforeEach(() => {
    vi.mocked(loadAgentTools).mockClear();
    localStorage.setItem("agent-disclaimer-accepted", "true");
    useAgentStore.setState({ isOpen: true });
    onDesktop();
  });

  afterEach(() => {
    offDesktop();
    cleanup();
  });

  async function openOnce() {
    const { unmount } = render(<AgentOverlay />, { wrapper: withServerInfo() });
    await act(async () => {});
    unmount();
  }

  it("tries again the next time the agent opens, after the server could not be reached", async () => {
    useWorkspaceStore.getState().setWorkspaceId("workspace-failed-load");
    vi.mocked(loadAgentTools).mockResolvedValueOnce({
      winners: [],
      droppedBuiltinNames: [],
      fetchFailed: true,
    });

    await openOnce();
    await openOnce();

    expect(loadAgentTools).toHaveBeenCalledTimes(2);
  });

  it("does not load again for the same workspace once a load worked", async () => {
    useWorkspaceStore.getState().setWorkspaceId("workspace-loaded");

    await openOnce();
    await openOnce();

    expect(loadAgentTools).toHaveBeenCalledTimes(1);
  });
});

describe("AgentOverlay on the web", () => {
  beforeEach(() => {
    vi.mocked(loadAgentTools).mockClear();
    localStorage.setItem("agent-disclaimer-accepted", "true");
    useAgentStore.setState({ isOpen: true });
  });

  it("says the agent is in the desktop app and loads no tools", () => {
    render(<AgentOverlay />, { wrapper: withServerInfo() });

    expect(screen.getByText("The AI agent is available in the desktop app.")).toBeInTheDocument();
    expect(screen.queryByText(/Ask anything about your workspace/)).not.toBeInTheDocument();
    expect(loadAgentTools).not.toHaveBeenCalled();
  });
});
