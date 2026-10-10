import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders as render } from "../../../test/utils";
import type { MessageAttachment } from "../../../core/types/messages";

vi.mock("../../messages/api/messageCache", () => ({
  encryptedStoreAccount: vi.fn(() => "account-1"),
}));
vi.mock("../api/e2eeApi", () => ({
  fetchMessageAttachments: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../api/e2eeCommands", () => ({
  decryptAttachment: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
}));
vi.mock("../runtime/send", () => ({
  downloadBlob: vi.fn(() => Promise.resolve(new Uint8Array([9, 9, 9]))),
}));

import { EncryptedAttachments } from "./EncryptedAttachments";
import { decryptAttachment } from "../api/e2eeCommands";
import { useMessageDisplaySettingsStore } from "../../messages/state/useMessageDisplaySettingsStore";

function attachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "att-1",
    filename: "photo.png",
    contentType: "image/png",
    sizeBytes: 4096,
    status: "READY",
    blobSha256: "hash-1",
    ...overrides,
  };
}

function renderAttachments(attachments: MessageAttachment[]) {
  return render(
    <EncryptedAttachments
      messageId="msg-1"
      serverId="ws-1"
      conversationId="conv-1"
      attachments={attachments}
      hasText
    />,
  );
}

const createObjectURL = vi.fn((blob: Blob) => `blob:decrypted-${blob.type}`);
const revokeObjectURL = vi.fn();
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.mocked(decryptAttachment).mockClear();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  useMessageDisplaySettingsStore.setState({ showInlineMedia: true });
});

describe("EncryptedAttachments", () => {
  it("shows a decrypted image like any other inline image and revokes it on unmount", async () => {
    const { unmount } = renderAttachments([attachment()]);
    const img = await screen.findByAltText("photo.png");
    expect(img).toHaveAttribute("src", "blob:decrypted-image/png");
    expect(screen.getByRole("button", { name: "Open image photo.png" })).toBeInTheDocument();
    expect(decryptAttachment).toHaveBeenCalledWith(
      "account-1",
      "msg-1",
      "hash-1",
      expect.any(Uint8Array),
    );

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:decrypted-image/png");
  });

  it("plays a decrypted video from its object URL", async () => {
    const { container } = renderAttachments([
      attachment({ filename: "clip.mp4", contentType: "video/mp4" }),
    ]);
    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute("src", "blob:decrypted-video/mp4"),
    );
    expect(container.querySelector("video")).toHaveAttribute("preload", "metadata");
  });

  it("decrypts a large video only when asked", async () => {
    const user = userEvent.setup();
    const { container } = renderAttachments([
      attachment({ filename: "talk.mp4", contentType: "video/mp4", sizeBytes: 80 * 1024 * 1024 }),
    ]);
    expect(decryptAttachment).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Show talk\.mp4/ }));
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    expect(decryptAttachment).toHaveBeenCalledTimes(1);
  });

  it("shows file chips without decrypting when inline media is off", () => {
    useMessageDisplaySettingsStore.setState({ showInlineMedia: false });
    renderAttachments([attachment()]);
    expect(screen.getByRole("button", { name: /photo\.png/ })).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(decryptAttachment).not.toHaveBeenCalled();
  });
});
