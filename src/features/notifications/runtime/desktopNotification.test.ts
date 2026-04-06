import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { showMessageNotification } from "./desktopNotification";

describe("showMessageNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notification when permission is already granted", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await showMessageNotification({
      channelName: "#general",
      authorName: "Alice",
      messageText: "Hello world",
      showPreview: true,
    });

    expect(sendNotification).toHaveBeenCalledWith({
      title: "#general",
      body: "Alice: Hello world",
    });
  });

  it("requests permission when not granted", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue("granted");

    await showMessageNotification({
      channelName: "#general",
      authorName: "Alice",
      messageText: "Hello",
      showPreview: true,
    });

    expect(requestPermission).toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalled();
  });

  it("does not send notification when permission is denied", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue("denied");

    await showMessageNotification({
      channelName: "#general",
      authorName: "Alice",
      messageText: "Hello",
      showPreview: true,
    });

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("truncates message text to 100 characters when showPreview is true", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    const longText = "a".repeat(200);
    await showMessageNotification({
      channelName: "#general",
      authorName: "Alice",
      messageText: longText,
      showPreview: true,
    });

    expect(sendNotification).toHaveBeenCalledWith({
      title: "#general",
      body: `Alice: ${"a".repeat(100)}`,
    });
  });

  it("hides preview when showPreview is false", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await showMessageNotification({
      channelName: "#general",
      authorName: "Bob",
      messageText: "Secret message",
      showPreview: false,
    });

    expect(sendNotification).toHaveBeenCalledWith({
      title: "#general",
      body: "New message from Bob",
    });
  });

  it("uses channel name as notification title", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await showMessageNotification({
      channelName: "#announcements",
      authorName: "Admin",
      messageText: "Important update",
      showPreview: true,
    });

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "#announcements",
      }),
    );
  });
});
