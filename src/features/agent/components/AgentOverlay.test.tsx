import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ServerFeatureState } from "../../../core/graphql/generated/schema-types";
import { withServerInfo } from "../../../test/serverInfo";
import { useAgentStore } from "../state/useAgentStore";

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
