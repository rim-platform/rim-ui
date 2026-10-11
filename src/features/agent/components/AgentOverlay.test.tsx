import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { withServerInfo } from "../../../test/serverInfo";
import { useAgentStore } from "../state/useAgentStore";
import { useLiveModelsStore } from "../state/useLiveModelsStore";

vi.mock("../tools/loader", () => ({ loadAgentTools: vi.fn(() => Promise.resolve()) }));

import { loadAgentTools } from "../tools/loader";
import { AgentOverlay } from "./AgentOverlay";

describe("AgentOverlay and the ai_commands switch", () => {
  beforeEach(() => {
    vi.mocked(loadAgentTools).mockClear();
    localStorage.setItem("agent-disclaimer-accepted", "true");
    useAgentStore.setState({ isOpen: true });
  });

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
  });

  it("names the model by its display name from the live list", () => {
    useLiveModelsStore.setState({ byProvider: { anthropic: [opus] } });
    render(<AgentOverlay />, { wrapper: withServerInfo() });
    expect(screen.getByText("anthropic / Claude Opus 5.5")).toBeInTheDocument();
  });

  it("names the model by its whole id when the live list lacks it", () => {
    useLiveModelsStore.setState({ byProvider: { openai: [{ ...opus, id: "gpt-5.4" }] } });
    render(<AgentOverlay />, { wrapper: withServerInfo() });
    expect(screen.getByText("anthropic / claude-opus-5-5")).toBeInTheDocument();
  });
});
