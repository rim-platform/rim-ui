/**
 * The field an argument gets when its type alone does not say enough:
 * - `stateKey`: a workspace state key, typed or picked from the keys in the form's scope.
 * - `statePrefix`: a key prefix, with the scope's keys as suggestions.
 * - `stateValue`: a value to store, typed as Yes/No, a number, text or JSON.
 * - `macro`, `pipeline`: one of the person's macros or the workspace's pipelines.
 * - `targetWorkspace`: a workspace to go to, not the one the command runs in.
 * - `clearableText`: text that may be cleared on purpose, sent as an empty string.
 */
export type ArgumentPickerKind =
  | "stateKey"
  | "statePrefix"
  | "stateValue"
  | "macro"
  | "pipeline"
  | "targetWorkspace"
  | "clearableText";

/** How the argument form shows one argument of one command. */
export interface ArgumentPicker {
  /** The field to use instead of the one the argument's type gives. */
  kind?: ArgumentPickerKind;
  /** The label of each allowed value, by value; a value without one is shown as it reads. */
  valueLabels?: Readonly<Record<string, string>>;
  /**
   * For `stateKey`, what the command does with the key: `read` it, `write` it, which may make a
   * new key, or `delete` it. Only a read may name a key under `system.`.
   */
  keyAccess?: "read" | "write" | "delete";
  /** For `clearableText`: the label of the box that clears the field, such as "No topic". */
  clearLabel?: string;
}

const STATE_SCOPE_LABELS = { server: "Workspace (everyone)", user: "Only me" } as const;

const STATE_SCOPE: ArgumentPicker = { valueLabels: STATE_SCOPE_LABELS };

const PICKERS: Readonly<Record<string, ArgumentPicker>> = {
  "state.get.key": { kind: "stateKey", keyAccess: "read" },
  "state.get.scope": STATE_SCOPE,
  "state.set.key": { kind: "stateKey", keyAccess: "write" },
  "state.set.value": { kind: "stateValue" },
  "state.set.scope": STATE_SCOPE,
  "state.delete.key": { kind: "stateKey", keyAccess: "delete" },
  "state.delete.scope": STATE_SCOPE,
  "state.incr.key": { kind: "stateKey", keyAccess: "write" },
  "state.incr.scope": STATE_SCOPE,
  "state.list.prefix": { kind: "statePrefix" },
  "state.list.scope": STATE_SCOPE,
  "notifications.set_level.level": {
    valueLabels: {
      all: "All messages",
      mentions: "Mentions only",
      none: "Nothing",
      default: "Workspace default",
    },
  },
  "notifications.mute_conversation.duration": {
    valueLabels: {
      "1h": "Mute for 1 hour",
      "8h": "Mute for 8 hours",
      until_tomorrow: "Mute until tomorrow",
      forever: "Until I unmute it",
      until: "Until a time",
      minutes: "For a number of minutes",
    },
  },
  "notifications.dnd.mode": {
    valueLabels: { on: "Until I turn it back on", off: "Off", until: "Until a time" },
  },
  "admin.delete_member_messages.window": {
    valueLabels: {
      "1h": "Last hour",
      "24h": "Last 24 hours",
      "7d": "Last 7 days",
      all: "Everything",
    },
  },
  "chat.set_channel_posting.policy": {
    valueLabels: { everyone: "Everyone", moderators: "Owner and moderators" },
  },
  "app.run_macro.macro_id": { kind: "macro" },
  "app.toggle_pipeline.pipeline_id": { kind: "pipeline" },
  "workspace.switch_workspace.workspace_id": { kind: "targetWorkspace" },
  "chat.set_topic.topic": { kind: "clearableText", clearLabel: "No topic" },
};

/**
 * The picker of one argument of one command.
 *
 * @param commandId - The command's id, such as `state.set`; nothing is found without one.
 * @param argumentName - The argument's name, such as `key`.
 * @returns The picker, or `undefined` when the argument's type picks its field.
 */
export function argumentPicker(
  commandId: string | undefined,
  argumentName: string,
): ArgumentPicker | undefined {
  if (!commandId) return undefined;
  const key = `${commandId}.${argumentName}`;
  return Object.prototype.hasOwnProperty.call(PICKERS, key) ? PICKERS[key] : undefined;
}

/** The kind of field `argumentName` of `commandId` gets, when the map names one. */
export function argumentPickerKind(
  commandId: string | undefined,
  argumentName: string,
): ArgumentPickerKind | undefined {
  return argumentPicker(commandId, argumentName)?.kind;
}

/**
 * Whether an empty string is a value of the argument rather than no value: the argument's field
 * can be cleared on purpose, as a topic can.
 */
export function sendsEmptyText(commandId: string | undefined, argumentName: string): boolean {
  return argumentPickerKind(commandId, argumentName) === "clearableText";
}

/**
 * What a cleared field holds: `true`, the state of its "No topic" box, kept apart from text
 * not typed yet, which is asked for or left to its default.
 */
export const CLEARED_FIELD = true;
