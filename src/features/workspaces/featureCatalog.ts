import { WorkspaceFeature } from "../../core/graphql/generated/schema-types";

/** Owner-facing copy for each optional workspace module, shown in Settings → Workspace. */
export const WORKSPACE_FEATURE_COPY: Record<
  WorkspaceFeature,
  { title: string; description: string }
> = {
  [WorkspaceFeature.INCIDENTS]: {
    title: "Incidents and on-call",
    description:
      "Incident timelines, on-call schedules, escalation policies and alert webhooks. Turning this off hides the module; nothing is deleted.",
  },
};

/** Message shown when a gated command is invoked while its feature is off. */
export const FEATURE_OFF_MESSAGE: Record<WorkspaceFeature, string> = {
  [WorkspaceFeature.INCIDENTS]: "Incidents and on-call are turned off for this workspace.",
};

/**
 * Command-id namespaces owned by each feature. The server tags its gated commands with
 * `Command.feature`; this covers the desktop-local handlers (`incident.start`,
 * `incident.resolve`, …) that never reach the server and keybinds that fire before the
 * command list has loaded.
 */
const FEATURE_COMMAND_PREFIXES: Record<WorkspaceFeature, readonly string[]> = {
  [WorkspaceFeature.INCIDENTS]: ["incident.", "oncall."],
};

/** The workspace feature a command id belongs to, or `null` when it is always available. */
export function featureForCommandId(commandId: string): WorkspaceFeature | null {
  for (const feature of Object.values(WorkspaceFeature)) {
    if (FEATURE_COMMAND_PREFIXES[feature].some((prefix) => commandId.startsWith(prefix))) {
      return feature;
    }
  }
  return null;
}
