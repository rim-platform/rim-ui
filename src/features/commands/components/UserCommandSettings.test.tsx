import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../api/useCommands", () => ({
  useCommands: vi.fn(),
}));

const updateUserCommand = vi.fn();

vi.mock("../api/useUserCommands", () => ({
  useCreateUserCommandMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateUserCommandMutation: vi.fn(() => ({
    mutate: updateUserCommand,
    isPending: false,
    isError: false,
  })),
  useDeleteUserCommandMutation: vi.fn(() => ({ mutate: vi.fn() })),
  useUserCommand: vi.fn(),
  useUserCommandSteps: vi.fn(),
}));

import { graphqlError } from "../../conversations/__fixtures__/conversations";
import { useCommands } from "../api/useCommands";
import {
  useCreateUserCommandMutation,
  useUserCommand,
  useUserCommandSteps,
  type SavedUserCommand,
} from "../api/useUserCommands";
import { UserCommandSettings } from "./UserCommandSettings";
import type { CommandDefinition } from "../types";

function makeCommand(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id: "state.incr",
    title: "Increment state",
    description: "Adds one to a state key",
    category: "state",
    sourceKind: "BUILT_IN",
    executionTarget: "BACKEND",
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    ...overrides,
  };
}

const userCommand = makeCommand({
  id: "user.standup",
  title: "Standup",
  description: "Counts a standup",
  category: "user",
  sourceKind: "USER",
});

const saved: SavedUserCommand = {
  id: "user.standup",
  title: "Standup",
  description: "Counts a standup",
  isEnabled: true,
  steps: [
    { commandId: "state.incr", args: { key: "standups" } },
    { commandId: "chat.mark_read", args: null },
  ],
};

/** Makes `useUserCommand` answer `result` for any id and nothing while no id is set. */
function answerUserCommand(result: Partial<ReturnType<typeof useUserCommand>>) {
  vi.mocked(useUserCommand).mockImplementation(
    (id) =>
      (id === null ? { data: undefined } : result) as unknown as ReturnType<typeof useUserCommand>,
  );
}

function openEditor() {
  render(<UserCommandSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Edit command" }));
}

describe("UserCommandSettings editing a command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCommands).mockReturnValue({
      data: [
        makeCommand(),
        makeCommand({ id: "chat.mark_read", title: "Mark read" }),
        makeCommand({ id: "chat.pin", title: "Pin message" }),
        userCommand,
      ],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
    vi.mocked(useUserCommandSteps).mockReturnValue({
      data: [{ id: "user.standup", steps: [{ commandId: "state.incr" }, { commandId: "x" }] }],
    } as unknown as ReturnType<typeof useUserCommandSteps>);
    answerUserCommand({ data: saved, isError: false });
  });

  it("asks for the saved command of the pencil's row", () => {
    openEditor();
    expect(useUserCommand).toHaveBeenLastCalledWith("user.standup");
  });

  it("shows a loading state until the saved command arrives", () => {
    answerUserCommand({ data: undefined, isError: false });
    openEditor();

    expect(screen.getByText("Loading the saved steps...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("fills the form with the saved title, description, steps and arguments", () => {
    openEditor();

    expect(screen.getByDisplayValue("Standup")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Counts a standup")).toBeInTheDocument();
    expect(screen.getByText("Steps (2)")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Step 1 command" })).toHaveValue("state.incr");
    expect(screen.getByRole("combobox", { name: "Step 2 command" })).toHaveValue("chat.mark_read");
    expect(screen.getByText('Arguments: {"key":"standups"}')).toBeInTheDocument();
    expect(screen.getAllByText(/^Arguments:/)).toHaveLength(1);
    expect(screen.queryByText(/cannot be loaded/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("saves the saved steps unchanged", () => {
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateUserCommand).toHaveBeenCalledWith(
      {
        commandId: "user.standup",
        title: "Standup",
        description: "Counts a standup",
        steps: [
          { commandId: "state.incr", args: { key: "standups" } },
          { commandId: "chat.mark_read" },
        ],
        isEnabled: true,
      },
      expect.anything(),
    );
  });

  it("sends the edited step list, dropping the arguments of a step whose command changed", () => {
    answerUserCommand({ data: { ...saved, isEnabled: false }, isError: false });
    openEditor();
    fireEvent.change(screen.getByRole("combobox", { name: "Step 1 command" }), {
      target: { value: "chat.pin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Step 3 command" }), {
      target: { value: "state.incr" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateUserCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [
          { commandId: "chat.pin" },
          { commandId: "chat.mark_read" },
          { commandId: "state.incr" },
        ],
        isEnabled: false,
      }),
      expect.anything(),
    );
  });

  it("keeps Save off until a step is chosen", () => {
    answerUserCommand({ data: { ...saved, steps: [] }, isError: false });
    openEditor();

    expect(screen.getByText("Choose at least one step to save.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // A step left on "Select..." does not count.
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateUserCommand).not.toHaveBeenCalled();
  });

  it("shows the id of a saved step whose command is not offered", () => {
    answerUserCommand({
      data: { ...saved, steps: [{ commandId: "user.hidden", args: null }] },
      isError: false,
    });
    openEditor();

    const select = screen.getByRole("combobox", { name: "Step 1 command" });
    expect(select).toHaveValue("user.hidden");
    expect(within(select).getByRole("option", { name: "user.hidden" })).toBeInTheDocument();
  });

  it("closes the editor and says so when the command is gone", () => {
    answerUserCommand({ data: null, isError: false });
    openEditor();

    expect(screen.getByRole("status")).toHaveTextContent(
      '"Standup" no longer exists for this account, so it cannot be edited.',
    );
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByText("Loading the saved steps...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit command" })).toBeInTheDocument();
  });

  it("shows a load failure with a way out", () => {
    answerUserCommand({ data: undefined, isError: true, error: new Error("network down") });
    openEditor();

    expect(
      screen.getByText("The saved command could not be loaded: network down"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit command" })).toBeInTheDocument();
  });
});

describe("UserCommandSettings list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCommands).mockReturnValue({
      data: [makeCommand(), userCommand],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
    answerUserCommand({ data: undefined, isError: false });
  });

  it("shows each command's step count", () => {
    vi.mocked(useUserCommandSteps).mockReturnValue({
      data: [{ id: "user.standup", steps: [{ commandId: "a" }, { commandId: "b" }] }],
    } as unknown as ReturnType<typeof useUserCommandSteps>);
    render(<UserCommandSettings />);
    expect(screen.getByText(/· 2 steps/)).toBeInTheDocument();
  });

  it("leaves the count out while the steps are not loaded", () => {
    vi.mocked(useUserCommandSteps).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useUserCommandSteps>);
    render(<UserCommandSettings />);
    expect(screen.getByText("user.standup")).toBeInTheDocument();
    expect(screen.queryByText(/steps?$/)).not.toBeInTheDocument();
  });

  it("shows a refused new command as one sentence, without the request", () => {
    vi.mocked(useUserCommandSteps).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useUserCommandSteps>);
    vi.mocked(useCreateUserCommandMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: graphqlError("CONFLICT", "user command already exists"),
    } as unknown as ReturnType<typeof useCreateUserCommandMutation>);
    render(<UserCommandSettings />);
    fireEvent.click(screen.getByRole("button", { name: /New command/ }));

    expect(screen.getByText("User command already exists.")).toBeInTheDocument();
    expect(screen.queryByText(/serialized response/)).not.toBeInTheDocument();
  });
});
