import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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
}));

import { useCommands } from "../api/useCommands";
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

describe("UserCommandSettings editing a command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCommands).mockReturnValue({
      data: [makeCommand(), userCommand],
      isLoading: false,
    } as ReturnType<typeof useCommands>);
  });

  it("keeps Save off and says why until a step is chosen again", () => {
    render(<UserCommandSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Edit command" }));

    expect(screen.getByDisplayValue("Standup")).toBeInTheDocument();
    expect(screen.getByText(/The saved steps cannot be loaded here/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // A step left on "Select..." does not count.
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateUserCommand).not.toHaveBeenCalled();
  });

  it("saves the steps chosen again", () => {
    render(<UserCommandSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Edit command" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "state.incr" } });

    expect(screen.queryByText(/The saved steps cannot be loaded here/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateUserCommand).toHaveBeenCalledWith(
      {
        commandId: "user.standup",
        title: "Standup",
        description: "Counts a standup",
        steps: [{ commandId: "state.incr" }],
        isEnabled: true,
      },
      expect.anything(),
    );
  });
});
