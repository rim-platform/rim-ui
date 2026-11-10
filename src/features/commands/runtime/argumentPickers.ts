/**
 * The field an argument gets when its type alone does not say enough:
 * - `stateKey`: a workspace state key, typed or picked from the keys in the form's scope.
 * - `statePrefix`: a key prefix, with the scope's keys as suggestions.
 * - `stateValue`: a value to store, typed as Yes/No, a number, text or JSON.
 * - `macro`, `pipeline`: one of the person's macros or the workspace's pipelines.
 * - `targetWorkspace`: a workspace to go to, not the one the command runs in.
 * - `clearableText`: text that may be cleared on purpose, sent as an empty string.
 * - `members`: several workspace members, sent as their ids joined with commas.
 * - `member`: one person, picked from the pool `members` names.
 * - `conversation`: one conversation, picked from the pool `conversations` names.
 * - `emoji`: an emoji, or a custom emoji as `:name:`, typed or picked.
 */
export type ArgumentPickerKind =
  | "stateKey"
  | "statePrefix"
  | "stateValue"
  | "macro"
  | "pipeline"
  | "targetWorkspace"
  | "clearableText"
  | "members"
  | "member"
  | "conversation"
  | "emoji";

/**
 * The people a member field offers:
 * - `people`: the workspace's members who are not bots.
 * - `notInConversation`: members not yet in the form's conversation; bots too when the viewer
 *   moderates the workspace and the conversation is a channel.
 * - `inConversation`: the members of the form's conversation, or of the workspace while no
 *   conversation is known.
 * - `timedOut`: members whose timeout is in force.
 * - `banned`: the people banned from the workspace, who are not members.
 */
export type MemberPool = "people" | "notInConversation" | "inConversation" | "timedOut" | "banned";

/**
 * The conversations a conversation field offers:
 * - `channels`: the viewer's channels; a preset form adds the public channels not joined.
 * - `channelsAndGroups`: the viewer's channels and groups, no direct messages.
 * - `archivedChannels`: the workspace's archived channels.
 * - `joinableChannels`: the public channels not joined; a preset form adds the viewer's own
 *   channels, which a saved step may join again after leaving them.
 * - `direct`: the direct messages and groups of the direct spaces.
 */
export type ConversationPool =
  "channels" | "channelsAndGroups" | "archivedChannels" | "joinableChannels" | "direct";

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
  /** For `members` and `member`: the people the field offers. */
  members?: MemberPool;
  /** For `conversation`: the conversations the field offers. */
  conversations?: ConversationPool;
}

const STATE_SCOPE_LABELS = { server: "Workspace (everyone)", user: "Only me" } as const;

const STATE_SCOPE: ArgumentPicker = { valueLabels: STATE_SCOPE_LABELS };

const PEOPLE: ArgumentPicker = { kind: "member", members: "people" };

/** A conversation field over `pool`. */
function conversationsOf(pool: ConversationPool): ArgumentPicker {
  return { kind: "conversation", conversations: pool };
}

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
  "chat.create_group.member_ids": { kind: "members", members: "people" },
  "chat.create_channel.member_ids": { kind: "members", members: "people" },
  "chat.invite_to_conversation.user_ids": { kind: "members", members: "notInConversation" },
  "admin.unban.user_id": { kind: "member", members: "banned" },
  "admin.clear_timeout.user_id": { kind: "member", members: "timedOut" },
  "chat.remove_conversation_member.user_id": { kind: "member", members: "inConversation" },
  "people.message.user_id": PEOPLE,
  "people.add_contact.user_id": PEOPLE,
  "people.remove_contact.user_id": PEOPLE,
  "people.block.user_id": PEOPLE,
  "chat.archive_channel.conversation_id": conversationsOf("channels"),
  "chat.unarchive_channel.conversation_id": conversationsOf("archivedChannels"),
  "chat.set_slow_mode.conversation_id": conversationsOf("channels"),
  "chat.set_channel_posting.conversation_id": conversationsOf("channels"),
  "chat.set_topic.conversation_id": conversationsOf("channels"),
  "chat.leave_conversation.conversation_id": conversationsOf("channelsAndGroups"),
  "chat.invite_to_conversation.conversation_id": conversationsOf("channelsAndGroups"),
  "chat.remove_conversation_member.conversation_id": conversationsOf("channelsAndGroups"),
  "chat.join_channel.conversation_id": conversationsOf("joinableChannels"),
  "workspace.navigate_to_dm.conversation_id": conversationsOf("direct"),
  "chat.toggle_reaction.emoji": { kind: "emoji" },
  "plugins.install.source": {
    valueLabels: { folder: "From a folder", git: "From a git URL" },
  },
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
 * The ids a `members` field holds: its text split on commas, blanks and repeats left out.
 *
 * @param value - The field's text, such as `"a,b"`.
 * @returns The ids, in the order they were picked.
 */
export function memberIdsOf(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * What a cleared field holds: `true`, the state of its "No topic" box, kept apart from text
 * not typed yet, which is asked for or left to its default.
 */
export const CLEARED_FIELD = true;
