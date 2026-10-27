import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { createTestQueryClient } from "../../../test/utils";
import { limitsQueryClient } from "../../../test/limits";
import { useWorkspaceStore } from "../../workspaces/state/useWorkspaceStore";
import {
  callsTo,
  graphqlError,
  routeRequests,
} from "../../conversations/__fixtures__/conversations";

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
import { CommandSensitivity } from "../../../core/graphql/generated/schema-types";
import { ConfirmCommandModal } from "../../agent/components/ConfirmCommandModal";
import { useConfirmationModalStore } from "../../agent/state/confirmationModalStore";
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
  sensitivity: CommandSensitivity.RESTRICTED,
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

/** Renders the settings, against a server whose macro cap is `macrosPerWorkspace` when given. */
function renderSettings(macrosPerWorkspace?: number) {
  const client =
    macrosPerWorkspace === undefined
      ? createTestQueryClient()
      : limitsQueryClient({ macrosPerWorkspace });
  render(
    <QueryClientProvider client={client}>
      <MacroSettings />
      <ConfirmCommandModal />
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
    useConfirmationModalStore.getState().reset();
  });

  it("runs a macro the server does not hold, without confirmedDangerous", async () => {
    serve(() => ({ executeMacro: { status: "SUCCESS", message: "Done" } }));
    renderSettings();

    await clickRun();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Macro "Cleanup" executed'));
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
    const dialog = await screen.findByRole("dialog", { name: 'Confirm: Run macro "Cleanup"' });
    expect(within(dialog).getByText("chat.delete_message")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    // A Restricted step needs its verb typed before the run can be confirmed.
    const confirm = within(dialog).getByTestId("confirm-button");
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId("verb-input"), { target: { value: "delete" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Macro "Cleanup" executed'));
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
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    const dialog = await screen.findByRole("dialog", { name: 'Confirm: Run macro "Cleanup"' });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(callsTo(requestMock, "mutation ExecuteMacro")).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows the server's message when the challenge is missing", async () => {
    serve(() => ({
      executeMacro: { status: "CONFIRMATION_REQUIRED", message: "needs a proof" },
    }));
    renderSettings();

    await clickRun();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Macro "Cleanup" failed', {
        description: "needs a proof",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the server's message under a failed macro", async () => {
    serve(() => ({
      executeMacro: {
        status: "ERROR",
        message: "Step 1 (Delete Message) failed: message not found",
      },
    }));
    renderSettings();

    await clickRun();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Macro "Cleanup" failed', {
        description: "Step 1 (Delete Message) failed: message not found",
      }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("MacroSettings macro cap", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.error).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
  });

  it("shows the workspace's cap, which it cannot count", async () => {
    serve(() => ({}));
    renderSettings(10);
    expect(await screen.findByTestId("limit-note")).toHaveTextContent(
      "Up to 10 macros per workspace",
    );
  });

  it("shows no cap on a server without one", async () => {
    serve(() => ({}));
    renderSettings();
    expect(await screen.findByText("Cleanup")).toBeInTheDocument();
    expect(screen.queryByTestId("limit-note")).not.toBeInTheDocument();
  });

  it("shows the server's refusal of a macro past the cap", async () => {
    routeRequests(requestMock, {
      "query MyMacros": () => ({ myMacros: [macro] }),
      "query Commands": () => ({ commands: [deleteCommand] }),
      "mutation CreateMacro": () => {
        throw graphqlError("VALIDATION", "this instance allows 1 macros per workspace");
      },
    });
    renderSettings(1);
    fireEvent.click(await screen.findByRole("button", { name: /new macro/i }));
    fireEvent.change(screen.getByPlaceholderText("My macro"), { target: { value: "Second" } });
    fireEvent.change(screen.getByPlaceholderText("Search commands..."), {
      target: { value: "chat.delete_message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("this instance allows 1 macros per workspace"),
    );
  });
});

describe("MacroSettings step picker", () => {
  const openSettings = {
    ...deleteCommand,
    id: "workspace.open_settings",
    title: "Open Settings",
    category: "Workspace",
    executionTarget: "DESKTOP_LOCAL",
    dangerous: false,
    sensitivity: CommandSensitivity.SAFE,
  };

  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(toast.error).mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    routeRequests(requestMock, {
      "query MyMacros": () => ({ myMacros: [macro] }),
      "query Commands": () => ({ commands: [deleteCommand, openSettings] }),
    });
  });

  async function openEditor() {
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: /new macro/i }));
    // The palette's and the keybind picker's registries load after the editor opens.
    await waitFor(() => expect(callsTo(requestMock, "query Commands")).toHaveLength(2));
  }

  it("offers server commands as steps and leaves out desktop-local ones", async () => {
    await openEditor();
    fireEvent.focus(screen.getByPlaceholderText("Search commands..."));

    expect(await screen.findByText("Delete Message")).toBeInTheDocument();
    expect(screen.queryByText("Open Settings")).not.toBeInTheDocument();
  });

  it("warns under a step typed as a desktop-local command", async () => {
    await openEditor();
    fireEvent.change(screen.getByPlaceholderText("Search commands..."), {
      target: { value: "workspace.open_settings" },
    });

    expect(
      await screen.findByText("This command only runs in the app, so it fails as a macro step."),
    ).toBeInTheDocument();
  });

  it("marks a step typed as a title as an unknown command once the field is left", async () => {
    await openEditor();
    const field = screen.getByPlaceholderText("Search commands...");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Post Message" } });
    expect(screen.queryByText("Unknown command: Post Message")).not.toBeInTheDocument();

    fireEvent.blur(field);

    expect(await screen.findByText("Unknown command: Post Message")).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("does not save a macro with an unknown step", async () => {
    await openEditor();
    fireEvent.change(screen.getByPlaceholderText("My macro"), { target: { value: "Standup" } });
    fireEvent.change(screen.getByPlaceholderText("Search commands..."), {
      target: { value: "Post Message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Fix the steps marked in red before saving."),
    );
    expect(callsTo(requestMock, "mutation CreateMacro")).toHaveLength(0);
  });

  it("marks an unknown step of a saved macro when the editor opens", async () => {
    routeRequests(requestMock, {
      "query MyMacros": () => ({
        myMacros: [{ ...macro, steps: [{ commandId: "Toggle Sidebar", args: null }] }],
      }),
      "query Commands": () => ({ commands: [deleteCommand, openSettings] }),
    });
    renderSettings();
    fireEvent.click(await screen.findByTitle("Edit macro"));

    expect(await screen.findByText("Unknown command: Toggle Sidebar")).toBeInTheDocument();
  });
});

describe("MacroSettings Build with AI", () => {
  beforeEach(() => {
    requestMock.mockReset();
    useWorkspaceStore.setState({ workspaceId: "ws-1" });
    serve(() => ({}));
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("offers Build with AI only in the desktop app", async () => {
    renderSettings();
    expect(await screen.findByText("Cleanup")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /build with ai/i })).not.toBeInTheDocument();
  });

  it("offers Build with AI in the desktop app", async () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    renderSettings();
    expect(await screen.findByRole("button", { name: /build with ai/i })).toBeInTheDocument();
  });
});
