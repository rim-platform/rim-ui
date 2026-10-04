import {
  CommandExecutionTarget,
  CommandSensitivity,
  CommandSourceKind,
  type Command,
} from "../../../core/graphql/generated/schema-types";

export function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: "chat.send_message",
    title: "Send Message",
    description: "Send a message",
    nlDescription: "Send a chat message.",
    intentSamples: [],
    category: "chat",
    sourceKind: CommandSourceKind.BUILT_IN,
    executionTarget: CommandExecutionTarget.BACKEND,
    requiredContext: [],
    requiredCapabilities: [],
    visibleInPalette: true,
    visibleInContextMenus: false,
    keybindCapable: true,
    dangerous: false,
    sensitivity: CommandSensitivity.SAFE,
    aiCallable: true,
    arguments: [],
    ...overrides,
  };
}
