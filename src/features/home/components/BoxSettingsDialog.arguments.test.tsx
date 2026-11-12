import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommandArgumentType } from "../../../core/graphql/generated/schema-types";
import type { CommandDefinition } from "../../commands/types";

function definition(id: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id,
    title: id,
    description: "",
    category: "Chat",
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

const DND = definition("notifications.dnd", {
  title: "Do Not Disturb",
  arguments: [
    {
      name: "server_id",
      title: "Workspace",
      description: "",
      argumentType: CommandArgumentType.WORKSPACE_ID,
      required: true,
    },
    {
      name: "mode",
      title: "Mode",
      description: "",
      argumentType: CommandArgumentType.ENUM,
      required: true,
      allowedValues: ["on", "off"],
    },
  ],
});

const POLL = definition("plugin.chat.rim.poll.create", {
  title: "Create Poll",
  sourceKind: "PLUGIN",
  executionTarget: "DESKTOP_LOCAL",
});

vi.mock("../../updater/hooks/useSpaceHasCapability", () => ({
  useSpaceHasCapability: () => false,
}));
vi.mock("../../commands/api/useKeybindableCommands", () => ({
  useKeybindableCommands: () => ({
    builtIn: [DND],
    device: [POLL],
    all: [DND, POLL],
    unrunnable: [],
    needsArguments: () => false,
  }),
}));

import { BoxSettingsDialog } from "./BoxSettingsDialog";

function renderQuick(actions: unknown[]) {
  const onSave = vi.fn();
  render(
    <BoxSettingsDialog
      kind="quick"
      title="Settings of Quick actions"
      initial={{ actions }}
      adding={false}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  return { onSave, dialog: screen.getByRole("dialog", { name: "Settings of Quick actions" }) };
}

describe("BoxSettingsDialog quick action arguments", () => {
  it("asks a server command's arguments in fields instead of JSON", async () => {
    const user = userEvent.setup();
    const { onSave, dialog } = renderQuick([{ commandId: "notifications.dnd" }]);

    const section = within(dialog).getByRole("group", { name: "Arguments" });
    expect(within(dialog).queryByLabelText("Arguments (optional JSON)")).toBeNull();
    expect(within(section).getByText(/asked for when the action runs/)).toBeInTheDocument();
    await user.selectOptions(within(section).getByLabelText("Pause"), "Until I turn it back on");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      actions: [{ commandId: "notifications.dnd", presetArgs: { mode: "on" } }],
    });
  });

  it("shows a saved action's arguments in the fields", () => {
    const { dialog } = renderQuick([
      { commandId: "notifications.dnd", presetArgs: { mode: "off" } },
    ]);
    expect(within(dialog).getByLabelText("Pause")).toHaveValue("off");
  });

  it("keeps the JSON input for a plugin command", async () => {
    const user = userEvent.setup();
    const { onSave, dialog } = renderQuick([{ commandId: POLL.id }]);

    expect(within(dialog).queryByRole("group", { name: "Arguments" })).toBeNull();
    const json = within(dialog).getByLabelText("Arguments (optional JSON)");
    await user.click(json);
    await user.paste('{"question":"Lunch?"}');
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith({
      actions: [{ commandId: POLL.id, presetArgs: { question: "Lunch?" } }],
    });
  });

  it("keeps saved arguments that do not fit the fields as JSON, unchanged", async () => {
    const user = userEvent.setup();
    const saved = { mode: "later", note: 1 };
    const { onSave, dialog } = renderQuick([{ commandId: "notifications.dnd", presetArgs: saved }]);

    expect(within(dialog).getByLabelText("Arguments (optional JSON)")).toHaveValue(
      JSON.stringify(saved),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      actions: [{ commandId: "notifications.dnd", presetArgs: saved }],
    });
  });
});
