import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { detectOs } from "../../../core/runtime/runtime";

export interface MessageNotificationContent {
  channelName: string;
  authorName: string;
  messageText: string;
  showPreview: boolean;
}

/** The notification body: the author and the text, or only the author without a preview. */
export function notificationBody(opts: MessageNotificationContent): string {
  return opts.showPreview
    ? `${opts.authorName}: ${opts.messageText.slice(0, 100)}`
    : `New message from ${opts.authorName}`;
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

export async function showMessageNotification(
  opts: MessageNotificationContent & { sound?: boolean },
) {
  await showDesktopNotification({
    title: opts.channelName,
    body: notificationBody(opts),
    sound: opts.sound,
  });
}
