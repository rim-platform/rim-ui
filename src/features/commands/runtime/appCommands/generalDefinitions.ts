import type { TargetPickerKind } from "../../state/useCommandStore";
import type { CommandDefinition } from "../../types";
import { localCommand } from "./localCommand";
import { SETTINGS_TABS, settingsTabCommandId } from "../../../settings/settingsTabs";

const SETTINGS_TAB_COMMANDS: CommandDefinition[] = SETTINGS_TABS.map((tab) =>
  localCommand(
    settingsTabCommandId(tab.key),
    tab.group === "Workspace" ? "Workspace" : "App",
    `Settings: ${tab.label}`,
    `Open Settings on the ${tab.label} page`,
  ),
);

/** The commands for opening Settings pages, the workspace, status, profiles, updates and more. */
export const GENERAL_COMMANDS: CommandDefinition[] = [
  localCommand(
    "plugins.open_settings",
    "Plugins",
    "Open Plugin Settings",
    "Manage the installed plugins",
  ),
  localCommand(
    "workspace.open_direct_messages",
    "Navigation",
    "Open Direct Messages",
    "Switch to your direct messages",
  ),
  localCommand(
    "workspace.add",
    "Workspace",
    "Add a Workspace…",
    "Create a workspace or join one with an invite",
    false,
  ),
  localCommand(
    "workspace.open_workspace_settings",
    "Workspace",
    "Open Workspace Settings",
    "Open the settings of the open workspace",
  ),
  localCommand(
    "workspace.open_join_requests",
    "Workspace",
    "Open Join Requests",
    "See who asked to join the open workspace",
  ),
  localCommand("people.set_status", "People", "Set Status…", "Choose or clear your status", false),
  localCommand(
    "people.view_profile",
    "People",
    "View Profile…",
    "Pick a person and see their profile",
    false,
  ),
  localCommand(
    "people.message",
    "People",
    "Message Someone…",
    "Pick a person and open your direct message",
    false,
  ),
  localCommand("app.sign_out", "App", "Sign Out…", "Sign out of this device", false),
  localCommand(
    "app.check_for_updates",
    "App",
    "Check for Updates",
    "Look for a newer version of RIM",
  ),
  localCommand(
    "app.restart_to_update",
    "App",
    "Restart to Update",
    "Install the downloaded update and restart",
  ),
  localCommand(
    "app.open_log_folder",
    "App",
    "Open Log Folder",
    "Show the folder with RIM's log files",
  ),
  localCommand("app.minimize_window", "App", "Minimize Window", "Minimize the RIM window"),
  localCommand(
    "app.toggle_maximize_window",
    "App",
    "Maximize or Restore Window",
    "Maximize the RIM window, or restore it",
  ),
  localCommand(
    "app.close_window",
    "App",
    "Close Window",
    "Close the RIM window, as its close button does",
  ),
  ...SETTINGS_TAB_COMMANDS,
  localCommand(
    "settings.assign_keybind",
    "App",
    "Assign Keybind…",
    "Give the open conversation, or the open workspace, a keystroke",
    false,
  ),
  localCommand(
    "settings.back_up_history",
    "App",
    "Back Up History Now",
    "Write your new message history to the archive now",
  ),
  localCommand("app.run_macro", "App", "Run Macro…", "Pick one of your macros and run it", false),
  localCommand(
    "app.toggle_pipeline",
    "App",
    "Turn Pipeline On or Off…",
    "Pick a pipeline of the open workspace and switch it",
    false,
  ),
];

/** The target each picker command asks for, and the argument it gets it as. */
export const GENERAL_ARGUMENT_PROMPTS: Record<
  string,
  { argument: string; alias?: string; picker: TargetPickerKind }
> = {
  "people.view_profile": { argument: "user_id", alias: "userId", picker: "member" },
  "people.message": { argument: "user_id", alias: "userId", picker: "messageableMember" },
  "app.run_macro": { argument: "macro_id", alias: "macroId", picker: "macro" },
  "app.toggle_pipeline": { argument: "pipeline_id", alias: "pipelineId", picker: "pipeline" },
};
