import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export async function showMessageNotification(opts: {
  channelName: string;
  authorName: string;
  messageText: string;
  showPreview: boolean;
}) {
  const granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    if (permission !== "granted") return;
  }

  sendNotification({
    title: opts.channelName,
    body: opts.showPreview
      ? `${opts.authorName}: ${opts.messageText.slice(0, 100)}`
      : `New message from ${opts.authorName}`,
  });
}
