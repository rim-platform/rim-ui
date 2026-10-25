import type { NotificationStyle } from "../state/useNotificationSettingsStore";
import { formatMessageNotification, type MessageNotificationContent } from "./desktopNotification";

/**
 * A notification with `title` and `body` through the browser's Notifications API, only when the
 * person has already allowed this site's notifications: the web app never asks on its own.
 *
 * @returns Whether it was shown.
 */
export function showBrowserTextNotification(title: string, body: string): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  new Notification(title, { body });
  return true;
}

/**
 * A message notification through the browser's Notifications API, only when the person has
 * already allowed this site's notifications: the web app never asks on its own.
 */
export function showBrowserNotification(
  content: MessageNotificationContent,
  style: NotificationStyle,
): boolean {
  const { title, body } = formatMessageNotification(content, style);
  return showBrowserTextNotification(title, body);
}
