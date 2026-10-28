import type { CommandContextInput, CommandResult } from "../types";
import { chatCache, conversationEncrypted } from "../../plugins/chat/appMessageService";
import {
  useCommandResultStore,
  type CommandResultViewData,
  type ResultRow,
} from "../state/useCommandResultStore";

/** The server read commands whose answer is a list or an entry worth showing, not only counting. */
export const READ_RESULT_COMMANDS: ReadonlySet<string> = new Set([
  "chat.list_channels",
  "chat.list_members",
  "chat.get_recent_messages",
  "state.list",
  "state.get",
]);

/** Shown in place of messages the server cannot read and this device does not hold. */
export const ENCRYPTED_MESSAGES_NOTE =
  "Messages in this conversation are end-to-end encrypted and are not stored on this device yet.";

const DEFAULT_MESSAGE_LIMIT = 30;

type Entry = Record<string, unknown>;

function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entries(payload: Entry, field: string): Entry[] {
  const list = payload[field];
  return Array.isArray(list) ? list.filter(isEntry) : [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined ? "" : JSON.stringify(value);
}

function sentAtText(value: unknown): string {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString();
}

function channelRow(channel: Entry, index: number): ResultRow {
  const flags = [
    text(channel.conversation_type).toLowerCase(),
    channel.is_private === true ? "private" : "",
    channel.is_archived === true ? "archived" : "",
    channel.is_member === true ? "member" : "",
  ].filter(Boolean);
  return {
    key: text(channel.id) || String(index),
    primary: text(channel.title) || "Untitled",
    secondary: flags.join(" · "),
  };
}

function memberRow(member: Entry, index: number): ResultRow {
  return {
    key: text(member.username) || String(index),
    primary: text(member.username),
    secondary: text(member.role).toLowerCase(),
  };
}

function messageRow(message: Entry, index: number): ResultRow {
  return {
    key: `${index}`,
    primary: text(message.text),
    secondary: [text(message.author), sentAtText(message.sentAt)].filter(Boolean).join(" · "),
  };
}

function stateRow(entry: Entry, index: number): ResultRow {
  return {
    key: text(entry.key) || String(index),
    primary: `${text(entry.key)} = ${text(entry.value)}`,
    secondary: entry.version === undefined ? undefined : `version ${text(entry.version)}`,
  };
}

function stringArg(args: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = args?.[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The messages this device holds for an end-to-end encrypted conversation, where the server
 * answers with none. `null` when the conversation is not encrypted or cannot be looked up.
 */
async function encryptedMessages(
  args: Record<string, unknown> | undefined,
  commandContext: CommandContextInput | undefined,
): Promise<CommandResultViewData["rows"] | "unavailable" | null> {
  const conversationId = stringArg(args, "conversation_id") ?? commandContext?.conversationId;
  const workspaceId = stringArg(args, "server_id") ?? commandContext?.workspaceId;
  if (!conversationId || !workspaceId) return null;
  try {
    if ((await conversationEncrypted(workspaceId, conversationId)) !== true) return null;
    const limitArg = Number(args?.limit);
    const limit =
      Number.isInteger(limitArg) && limitArg > 0 ? Math.min(limitArg, 100) : DEFAULT_MESSAGE_LIMIT;
    const page = await chatCache()?.list(workspaceId, conversationId, null, limit, {
      encryptedAllowed: true,
      knownEncrypted: [conversationId],
    });
    if (!page) return "unavailable";
    return page.messages.map((m, index) =>
      messageRow({ text: m.text, author: m.author.displayName, sentAt: m.sentAt }, index),
    );
  } catch {
    return "unavailable";
  }
}

/**
 * What to show for the result of a read command, or `null` when it is not one or has nothing
 * to list.
 */
export async function readResultView(
  commandId: string,
  title: string,
  result: CommandResult,
  args?: Record<string, unknown>,
  commandContext?: CommandContextInput,
): Promise<CommandResultViewData | null> {
  if (!READ_RESULT_COMMANDS.has(commandId) || result.status !== "SUCCESS") return null;
  const payload = isEntry(result.payload) ? result.payload : null;
  if (!payload) return null;

  let rows: ResultRow[];
  let note: string | undefined;
  switch (commandId) {
    case "chat.list_channels":
      rows = entries(payload, "channels").map(channelRow);
      break;
    case "chat.list_members":
      rows = entries(payload, "members").map(memberRow);
      break;
    case "state.list":
      rows = entries(payload, "entries").map(stateRow);
      break;
    case "state.get":
      rows = "key" in payload ? [stateRow(payload, 0)] : [];
      break;
    default: {
      rows = entries(payload, "messages").map(messageRow);
      if (rows.length === 0) {
        const local = await encryptedMessages(args, commandContext);
        if (local === "unavailable") note = ENCRYPTED_MESSAGES_NOTE;
        else if (local) rows = local;
      }
    }
  }
  if (rows.length === 0 && !note) return null;
  return { title: note ? title : `${title} (${rows.length})`, rows, note };
}

/**
 * Shows the result of a read command in the result view.
 *
 * @returns `true` when the view opened, so the caller skips its own summary.
 */
export async function presentReadResult(
  commandId: string,
  title: string,
  result: CommandResult | null,
  args?: Record<string, unknown>,
  commandContext?: CommandContextInput,
): Promise<boolean> {
  if (!result) return false;
  const view = await readResultView(commandId, title, result, args, commandContext);
  if (!view) return false;
  useCommandResultStore.getState().show(view);
  return true;
}
