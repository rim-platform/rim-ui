import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import { callsTo, routeRequests } from "../../conversations/__fixtures__/conversations";

const requestMock = vi.fn();

vi.mock("../../../core/graphql/client", () => ({
  graphqlClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));
vi.mock("../../../shared/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("./AiMacroBuilder", () => ({
  AiMacroBuilder: () => null,
}));

import { toast } from "../../../shared/toast";
import { MacroSettings } from "./MacroSettings";

const macro = {
  id: "macro-1",
  name: "Cleanup",
  description: null,
  steps: [{ commandId: "chat.delete_message", args: null }],
};

const deleteCommand = {
  id: "chat.delete_message",
  title: "Delete Message",
  description: "",
  category: "Chat",
  sourceKind: "BUILT_IN",
  executionTarget: "BACKEND",
  requiredContext: [],
  requiredCapabilities: [],
  visibleInPalette: false,
  visibleInContextMenus: true,
  keybindCapable: true,
  dangerous: true,
  feature: null,
};

const challenge = { token: "tok-1", argsHash: "hash-1", expiresAt: "2999-01-01T00:00:00Z" };

function serve(executeMacro: (variables: Record<string, unknown>) => unknown) {
  routeRequests(requestMock, {
    "query MyMacros": () => ({ myMacros: [macro] }),
    "query Commands": () => ({ commands: [deleteCommand] }),
    "mutation ExecuteMacro": executeMacro,
  });
}

function renderSettings() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MacroSettings />
    </QueryClientProvider>,
  );
}

async function clickRun() {
  fireEvent.click(await screen.findByTitle("Run macro"));
}

describe("MacroSettings running a macro", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  it("runs a macro the server does not hold, without confirmedDangerous", async () => {
    serve(() => ({ executeMacro: { status: "SUCCESS", message: "Done" } }));
    renderSettings();

    await clickRun();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Done"));
    expect(callsTo(requestMock, "mutation ExecuteMacro")).toEqual([
      { input: { macroId: "macro-1", commandContext: { workspaceId: "ws-1" } } },
    ]);
  });

  it("confirms a dangerous macro with the server's challenge", async () => {
    let calls = 0;
    serve(() => {
      calls += 1;
      return calls === 1
        ? {
            executeMacro: {
              status: "CONFIRMATION_REQUIRED",
              message: "macro requires confirmation due to sensitivity tier",
              confirmationRequired: challenge,
            },
          }
        : { executeMacro: { status: "SUCCESS", message: "Done" } };
    });
    renderSettings();

    await clickRun();
    expect(await screen.findByText("Macro contains dangerous commands")).toBeInTheDocument();
    expect(screen.getByText("chat.delete_message")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run anyway" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Done"));
    const sent = callsTo(requestMock, "mutation ExecuteMacro");
    expect(sent).toEqual([
      { input: { macroId: "macro-1", commandContext: { workspaceId: "ws-1" } } },
      {
        input: {
          macroId: "macro-1",
          commandContext: { workspaceId: "ws-1" },
          confirmation: { inBandToken: { token: "tok-1", argsHash: "hash-1" } },
        },
      },
    ]);
    for (const variables of sent) {
      expect(variables.input).not.toHaveProperty("confirmedDangerous");
    }
    expect(screen.queryByText("Macro contains dangerous commands")).not.toBeInTheDocument();
  });

  it("sends nothing more when the user cancels the confirmation", async () => {
    serve(() => ({
      executeMacro: {
        status: "CONFIRMATION_REQUIRED",
        message: "macro requires confirmation due to sensitivity tier",
        confirmationRequired: challenge,
      },
    }));
    renderSettings();

    await clickRun();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Macro contains dangerous commands")).not.toBeInTheDocument();
    expect(callsTo(requestMock, "mutation ExecuteMacro")).toHaveLength(1);
  });

  it("shows the server's message when the challenge is missing", async () => {
    serve(() => ({
      executeMacro: { status: "CONFIRMATION_REQUIRED", message: "needs a proof" },
    }));
    renderSettings();

    await clickRun();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("needs a proof"));
    expect(screen.queryByText("Macro contains dangerous commands")).not.toBeInTheDocument();
  });
});
