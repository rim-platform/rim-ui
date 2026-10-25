import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { detectOs } from "../../../core/runtime/runtime";
import type { NotificationStyle } from "../state/useNotificationSettingsStore";

export interface MessageNotificationContent {
  /** The conversation's label: `#channel`, a group's title, the other member of a DM. */
  channelName: string;
  authorName: string;
  messageText: string;
  /** Whether the message is end-to-end encrypted. */
  encrypted: boolean;
}

const PREVIEW_LENGTH = 100;

/**
 * A message notification's title and body, as this device's settings ask.
 *
 * @param content - The message and where it was sent.
 * @param style - How much to show and what the title names.
 * @returns With `preview: "none"` only "New message" under the app's name; otherwise the
 * title names the conversation, the sender or both, and the body carries the text (prefixed with
 * the sender when the title does not name them) or, without a preview, says who sent it.
 */
export function formatMessageNotification(
  content: MessageNotificationContent,
  style: NotificationStyle,
): { title: string; body: string } {
  if (style.preview === "none") return { title: "RIM", body: "New message" };
  const { channelName, authorName } = content;
  const titleNamesSender = style.title !== "conversation";
  const title =
    style.title === "conversation"
      ? channelName
      : style.title === "sender" || channelName === authorName
        ? authorName
        : `${authorName} in ${channelName}`;
  const text = content.messageText.slice(0, PREVIEW_LENGTH);
  const showText = style.preview === "full" && !(content.encrypted && style.hideEncryptedText);
  if (showText && text) {
    return { title, body: titleNamesSender ? text : `${authorName}: ${text}` };
  }
  return { title, body: titleNamesSender ? "New message" : `New message from ${authorName}` };
}

/**
 * The platform's notification sound name (the plugin's `sound` option is platform specific).
 * Windows plays its default toast sound without one.
 */
function platformSound(): string | undefined {
  switch (detectOs()) {
    case "macos":
      return "Ping";
    case "linux":
      return "message-new-instant";
    default:
      return undefined;
  }
}

/**
 * A desktop notification with `title` and `body`, asking for the permission first when it was
 * never given; nothing is shown when it is refused.
 *
 * @param opts.sound - Whether to play the platform's notification sound.
 */
export async function showDesktopNotification(opts: {
  title: string;
  body: string;
  sound?: boolean;
}) {
  const granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    if (permission !== "granted") return;
  }

  const sound = opts.sound ? platformSound() : undefined;
  sendNotification({
    title: opts.title,
    body: opts.body,
    ...(sound ? { sound } : {}),
  });
}

/** A desktop notification of a message, formatted with `style`. */
export async function showMessageNotification(
  content: MessageNotificationContent,
  style: NotificationStyle,
  sound?: boolean,
) {
  await showDesktopNotification({ ...formatMessageNotification(content, style), sound });
}
