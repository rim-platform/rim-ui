import { notificationBody, type MessageNotificationContent } from "./desktopNotification";

/**
 * A message notification through the browser's Notifications API, only when the person has
 * already allowed this site's notifications: the web app never asks on its own.
 */
export function showBrowserNotification(opts: MessageNotificationContent): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  new Notification(opts.channelName, { body: notificationBody(opts) });
  return true;
}
