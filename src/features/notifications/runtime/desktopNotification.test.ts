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
import type { NotificationStyle } from "../state/useNotificationSettingsStore";
import { formatMessageNotification, showMessageNotification } from "./desktopNotification";

const FULL: NotificationStyle = {
  preview: "full",
  hideEncryptedText: false,
  title: "conversation",
};

describe("showMessageNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends notification when permission is already granted", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await showMessageNotification(
      {
        channelName: "#general",
        authorName: "Alice",
        messageText: "Hello world",
        encrypted: false,
      },
      FULL,
    );

    expect(sendNotification).toHaveBeenCalledWith({
      title: "#general",
      body: "Alice: Hello world",
    });
  });

  it("requests permission when not granted", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue("granted");

    await showMessageNotification(
      {
        channelName: "#general",
        authorName: "Alice",
        messageText: "Hello",
        encrypted: false,
      },
      FULL,
    );

    expect(requestPermission).toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalled();
  });

  it("does not send notification when permission is denied", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestPermission).mockResolvedValue("denied");

    await showMessageNotification(
      {
        channelName: "#general",
        authorName: "Alice",
        messageText: "Hello",
        encrypted: false,
      },
      FULL,
    );

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("truncates message text to 100 characters with the full preview", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    const longText = "a".repeat(200);
    await showMessageNotification(
      {
        channelName: "#general",
        authorName: "Alice",
        messageText: longText,
        encrypted: false,
      },
      FULL,
    );

    expect(sendNotification).toHaveBeenCalledWith({
      title: "#general",
      body: `Alice: ${"a".repeat(100)}`,
    });
  });

  it("shows only the sender with a sender-only preview", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await showMessageNotification(
      {
        channelName: "#general",
        authorName: "Bob",
        messageText: "Secret message",
        encrypted: false,
      },
      { ...FULL, preview: "sender" },
    );

    expect(sendNotification).toHaveBeenCalledWith({
      title: "#general",
      body: "New message from Bob",
    });
  });

  it("uses channel name as notification title", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);

    await showMessageNotification(
      {
        channelName: "#announcements",
        authorName: "Admin",
        messageText: "Important update",
        encrypted: false,
      },
      FULL,
    );

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "#announcements",
      }),
    );
  });
});

describe("formatMessageNotification", () => {
  const message = {
    channelName: "#general",
    authorName: "Alice",
    messageText: "The deploy is done",
    encrypted: false,
  };

  it("puts the sender before the text under the conversation's name", () => {
    expect(formatMessageNotification(message, FULL)).toEqual({
      title: "#general",
      body: "Alice: The deploy is done",
    });
  });

  it("names the sender in the title and leaves the body to the text", () => {
    expect(formatMessageNotification(message, { ...FULL, title: "sender" })).toEqual({
      title: "Alice",
      body: "The deploy is done",
    });
    expect(formatMessageNotification(message, { ...FULL, title: "both" })).toEqual({
      title: "Alice in #general",
      body: "The deploy is done",
    });
  });

  it("does not repeat a direct message's sender, who is also its conversation", () => {
    const direct = { ...message, channelName: "Alice" };
    expect(formatMessageNotification(direct, { ...FULL, title: "both" }).title).toBe("Alice");
  });

  it("says only who sent it with a sender-only preview", () => {
    expect(formatMessageNotification(message, { ...FULL, preview: "sender" })).toEqual({
      title: "#general",
      body: "New message from Alice",
    });
    expect(
      formatMessageNotification(message, { ...FULL, preview: "sender", title: "sender" }),
    ).toEqual({ title: "Alice", body: "New message" });
  });

  it("shows neither sender nor conversation with no preview, whatever the title", () => {
    expect(formatMessageNotification(message, { ...FULL, preview: "none", title: "both" })).toEqual(
      { title: "RIM", body: "New message" },
    );
  });

  it("hides an encrypted message's text when asked, and only that", () => {
    const style = { ...FULL, hideEncryptedText: true };
    expect(formatMessageNotification({ ...message, encrypted: true }, style).body).toBe(
      "New message from Alice",
    );
    expect(formatMessageNotification(message, style).body).toBe("Alice: The deploy is done");
  });

  it("says who sent a message without text instead of an empty preview", () => {
    expect(formatMessageNotification({ ...message, messageText: "" }, FULL).body).toBe(
      "New message from Alice",
    );
  });
});
