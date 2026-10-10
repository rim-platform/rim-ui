import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders as render } from "../../../../test/utils";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

import { InlineMedia } from "./InlineMedia";
import { mediaKindOf } from "./mediaKind";
import { MessageAttachments } from "./MessageAttachments";
import { useMessageDisplaySettingsStore } from "../../state/useMessageDisplaySettingsStore";
import type { MessageAttachment } from "../../../../core/types/messages";

function attachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "att-1",
    filename: "photo.png",
    contentType: "image/png",
    sizeBytes: 2048,
    status: "READY",
    ...overrides,
  };
}

afterEach(() => {
  useMessageDisplaySettingsStore.setState({ showInlineMedia: true });
});

describe("mediaKindOf", () => {
  it("tells images and videos from other files", () => {
    expect(mediaKindOf("image/png")).toBe("image");
    expect(mediaKindOf("IMAGE/JPEG")).toBe("image");
    expect(mediaKindOf("video/mp4")).toBe("video");
    expect(mediaKindOf("application/pdf")).toBeNull();
  });
});

describe("InlineMedia", () => {
  it("shows an image thumbnail with the file name as alt text, loaded lazily", () => {
    render(<InlineMedia kind="image" src="https://api.example/a.png" filename="a.png" />);
    const img = screen.getByAltText("a.png");
    expect(img).toHaveAttribute("src", "https://api.example/a.png");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("opens the image full size and closes it with Escape, returning focus", async () => {
    const user = userEvent.setup();
    render(<InlineMedia kind="image" src="blob:decrypted" filename="secret.png" />);
    const thumbnail = screen.getByRole("button", { name: "Open image secret.png" });

    await user.tab();
    expect(thumbnail).toHaveFocus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog", { name: "secret.png" });
    expect(within(dialog).getByAltText("secret.png")).toHaveAttribute("src", "blob:decrypted");
    expect(within(dialog).getByRole("link", { name: "Save image" })).toHaveAttribute(
      "download",
      "secret.png",
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(thumbnail).toHaveFocus();
  });

  it("keeps key presses in the lightbox away from the surrounding list", async () => {
    const user = userEvent.setup();
    const onListKeyDown = vi.fn();
    render(
      <div onKeyDown={onListKeyDown}>
        <InlineMedia kind="image" src="blob:x" filename="x.png" />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Open image x.png" }));
    onListKeyDown.mockClear();
    await screen.findByRole("dialog");
    await user.keyboard("j");
    expect(onListKeyDown).not.toHaveBeenCalled();
  });

  it("shows a video with controls that never autoplays and preloads metadata only", () => {
    const { container } = render(
      <InlineMedia kind="video" src="https://api.example/v.mp4" filename="clip.mp4" />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("aria-label", "clip.mp4");
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
  });
});

describe("MessageAttachments embeds", () => {
  it("embeds a ready image and links it to its download URL", () => {
    render(<MessageAttachments attachments={[attachment()]} hasText={false} />);
    const img = screen.getByAltText("photo.png");
    expect(img.getAttribute("src")).toMatch(/\/api\/attachments\/att-1\/download$/);
    expect(screen.getByRole("button", { name: "Open image photo.png" })).toBeInTheDocument();
  });

  it("embeds a ready video", () => {
    const { container } = render(
      <MessageAttachments
        attachments={[attachment({ filename: "clip.webm", contentType: "video/webm" })]}
        hasText
      />,
    );
    expect(container.querySelector("video")?.getAttribute("src")).toMatch(
      /\/api\/attachments\/att-1\/download$/,
    );
  });

  it("shows a file chip while an image is still uploading", () => {
    render(<MessageAttachments attachments={[attachment({ status: "PENDING_UPLOAD" })]} hasText />);
    expect(screen.queryByAltText("photo.png")).toBeNull();
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("Uploading...")).toBeInTheDocument();
  });

  it("shows file chips only when inline media is off", () => {
    useMessageDisplaySettingsStore.setState({ showInlineMedia: false });
    const { container } = render(
      <MessageAttachments
        attachments={[
          attachment(),
          attachment({ id: "att-2", filename: "clip.mp4", contentType: "video/mp4" }),
        ]}
        hasText
      />,
    );
    expect(container.querySelector("img, video")).toBeNull();
    expect(screen.getByRole("link", { name: /photo\.png/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /clip\.mp4/ })).toBeInTheDocument();
  });

  it("keeps other files as chips", () => {
    render(
      <MessageAttachments
        attachments={[attachment({ filename: "notes.pdf", contentType: "application/pdf" })]}
        hasText
      />,
    );
    expect(screen.getByRole("link", { name: /notes\.pdf/ })).toBeInTheDocument();
  });
});
