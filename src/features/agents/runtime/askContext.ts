/**
 * What "Ask agent…" attaches to a prompt: a `rim://` link to the channel or message and a short
 * hint naming its ids, so the agent reads it through RIM's tools, under its grants. No message
 * text is ever put in the prompt.
 */

import { ConversationTypeEnum } from "../../../core/graphql/generated/schema-types";
import type { ContentBlock } from "../acp/acpClient";
import type { PromptContext } from "../acp/agentSession";

/** A channel, or a message in it, the person asks an agent about. */
export interface AskSubject {
  workspaceId: string;
  conversationId: string;
  /** The message, or `null` for the whole channel. */
  messageId: string | null;
  /** The channel's name as RIM knows it, without the "#". */
  channelName: string;
  /** The workspace's name as RIM knows it. */
  workspaceName: string;
}

/** Why a direct message or a group can't be asked about. */
export const NOT_FOR_DIRECT = "Agents can't be given direct messages or groups yet.";

/** Why an encrypted conversation can't be asked about. */
export const NOT_FOR_ENCRYPTED = "Agents can't read encrypted conversations yet.";

/** The longest a name may be in the link an agent is given. */
const NAME_LENGTH = 80;

/** What is known of a conversation when deciding whether it can be asked about. */
export interface AskableConversation {
  conversationType: ConversationTypeEnum | string;
  encryptedAt?: string | null;
}

/**
 * Why a conversation can't be asked about, or `null` when it can: only a channel a grant could
 * cover, so not a direct message, a group, anything in a direct space, or anything encrypted.
 *
 * @param inDirectSpace - Whether its workspace is a direct space.
 */
export function cannotAskAbout(
  conversation: AskableConversation,
  inDirectSpace: boolean,
): string | null {
  if (inDirectSpace || conversation.conversationType !== ConversationTypeEnum.CHANNEL) {
    return NOT_FOR_DIRECT;
  }
  if (conversation.encryptedAt) return NOT_FOR_ENCRYPTED;
  return null;
}

/** A name on one line, cut to {@link NAME_LENGTH} characters. */
function oneLine(name: string): string {
  const line = name.replace(/\s+/gu, " ").trim();
  return line.length > NAME_LENGTH ? `${line.slice(0, NAME_LENGTH - 1)}…` : line;
}

/**
 * The `rim://` reference to a conversation, or to a message in it:
 * `rim://workspace/<workspaceId>/conversation/<conversationId>[/message/<messageId>]`.
 */
export function rimReference(subject: AskSubject): string {
  const base = `rim://workspace/${encodeURIComponent(subject.workspaceId)}/conversation/${encodeURIComponent(subject.conversationId)}`;
  return subject.messageId === null
    ? base
    : `${base}/message/${encodeURIComponent(subject.messageId)}`;
}

/** What the chip above the composer says. */
export function askChipLabel(subject: AskSubject): string {
  const channel = `#${subject.channelName}`;
  return subject.messageId === null ? `About: ${channel}` : `About: a message in ${channel}`;
}

/**
 * What the prompt carries after the person's words: a link to the channel or the message and a
 * hint that names its ids.
 */
export function askContext(subject: AskSubject): PromptContext {
  const channel = `#${oneLine(subject.channelName)}`;
  const link: ContentBlock = {
    type: "resource_link",
    uri: rimReference(subject),
    name:
      subject.messageId === null
        ? `${channel} in ${oneLine(subject.workspaceName)}`
        : `Message in ${channel}`,
    title: null,
    mimeType: null,
  };
  const message = subject.messageId === null ? "" : `, message ${subject.messageId}`;
  const hint: ContentBlock = {
    type: "text",
    text: `About this RIM conversation: workspace ${subject.workspaceId}, conversation ${subject.conversationId}${message}. Use RIM's tools to read it.`,
  };
  return { label: askChipLabel(subject), blocks: [link, hint] };
}
