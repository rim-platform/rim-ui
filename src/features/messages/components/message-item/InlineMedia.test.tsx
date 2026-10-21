import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders as render } from "../../../../test/utils";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const graphqlRequest = vi.hoisted(() => vi.fn());
vi.mock("../../../../core/graphql/client", () => ({
  graphqlClient: { request: (...args: unknown[]) => graphqlRequest(...args) },
}));

import { InlineMedia } from "./InlineMedia";
import { mediaKindOf } from "./mediaKind";
import { MessageAttachments } from "./MessageAttachments";
import { useMessageDisplaySettingsStore } from "../../state/useMessageDisplaySettingsStore";
import type { MessageAttachment } from "../../../../core/types/messages";
import { useContextMenu } from "../../../../shared/ui/contextMenu/useContextMenu";
/**
 * A successful download as `fetch` answers it. A plain object: Node 22's `Response` cannot read
 * a body made from jsdom's `Blob`.
 */
function okResponse(): Response {
  return { ok: true, status: 200, blob: async () => new Blob(["png"]) } as unknown as Response;
}

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
    const dialog = await screen.findByRole("dialog");
    // The dialog moves focus inside on the next animation frame; until then keys go to the list.
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
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

describe("MessageAttachments in the desktop app", () => {
  const fetchMock = vi.fn(async () => okResponse());

  function setDesktop(desktop: boolean) {
    const win = window as { __TAURI_INTERNALS__?: unknown };
    if (desktop) win.__TAURI_INTERNALS__ = {};
    else delete win.__TAURI_INTERNALS__;
  }

  afterEach(() => {
    setDesktop(false);
    vi.unstubAllGlobals();
    fetchMock.mockClear();
  });

  it("downloads an image with the session and shows it as an object URL", async () => {
    setDesktop(true);
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:tauri://localhost/photo");
    render(<MessageAttachments attachments={[attachment({ id: "desk-1" })]} hasText={false} />);
    await waitFor(() =>
      expect(screen.getByAltText("photo.png")).toHaveAttribute(
        "src",
        "blob:tauri://localhost/photo",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/attachments\/desk-1\/download$/),
      { credentials: "include" },
    );
  });

  it("waits for a click before downloading a large video", async () => {
    setDesktop(true);
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:tauri://localhost/clip");
    const { container } = render(
      <MessageAttachments
        attachments={[
          attachment({
            id: "desk-2",
            filename: "clip.mp4",
            contentType: "video/mp4",
            sizeBytes: 20 * 1024 * 1024,
          }),
        ]}
        hasText
      />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Show clip\.mp4/ }));
    await waitFor(() =>
      expect(container.querySelector("video")).toHaveAttribute(
        "src",
        "blob:tauri://localhost/clip",
      ),
    );
  });
});

describe("attachment context menus", () => {
  /** A message row with its own menu around the attachments, as the timeline has. */
  function Row({ attachments }: { attachments: MessageAttachment[] }) {
    const contextMenu = useContextMenu();
    return (
      <>
        <div
          data-testid="row"
          {...contextMenu.bind(() => [{ id: "row", label: "Copy text", onSelect: () => {} }])}
        >
          <p>message text</p>
          <MessageAttachments attachments={attachments} hasText serverId="ws-1" />
        </div>
        {contextMenu.menu}
      </>
    );
  }

  function labels(): string[] {
    return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
  }

  /** The anchors the menu follows, with their href and download attribute. */
  function followedLinks() {
    const followed: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      followed.push({ href: this.href, download: this.download });
    });
    return followed;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    graphqlRequest.mockReset();
  });

  it("opens an image's menu, not the message's, and opens the image full size", async () => {
    render(<Row attachments={[attachment()]} />);
    fireEvent.contextMenu(screen.getByAltText("photo.png"));
    expect(labels()).toEqual(["Open", "Download"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(await screen.findByRole("dialog", { name: "photo.png" })).toBeInTheDocument();
  });

  it("leaves the rest of the row to the message's menu", () => {
    render(<Row attachments={[attachment()]} />);
    fireEvent.contextMenu(screen.getByText("message text"));
    expect(labels()).toEqual(["Copy text"]);
  });

  it("downloads an image under its file name", () => {
    const followed = followedLinks();
    render(<Row attachments={[attachment()]} />);
    fireEvent.contextMenu(screen.getByAltText("photo.png"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(followed).toHaveLength(1);
    expect(followed[0].href).toMatch(/\/api\/attachments\/att-1\/download$/);
    expect(followed[0].download).toBe("photo.png");
  });

  it("offers only Download on a video", () => {
    const { container } = render(
      <Row attachments={[attachment({ filename: "clip.mp4", contentType: "video/mp4" })]} />,
    );
    fireEvent.contextMenu(container.querySelector("video")!);
    expect(labels()).toEqual(["Download"]);
  });

  it("opens and downloads a file chip", () => {
    const followed = followedLinks();
    render(
      <Row attachments={[attachment({ filename: "notes.pdf", contentType: "application/pdf" })]} />,
    );
    fireEvent.contextMenu(screen.getByRole("link", { name: /notes\.pdf/ }));
    expect(labels()).toEqual(["Open", "Download"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    fireEvent.contextMenu(screen.getByRole("link", { name: /notes\.pdf/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(followed.map((link) => link.download)).toEqual(["", "notes.pdf"]);
  });

  it("opens the file chip's menu from the keyboard", () => {
    render(
      <Row attachments={[attachment({ filename: "notes.pdf", contentType: "application/pdf" })]} />,
    );
    fireEvent.keyDown(screen.getByRole("link", { name: /notes\.pdf/ }), { key: "ContextMenu" });
    expect(labels()).toEqual(["Open", "Download"]);
  });

  it("offers only Delete attachment on a failed upload, and deletes it", async () => {
    graphqlRequest.mockResolvedValue({ deleteAttachment: true });
    render(<Row attachments={[attachment({ status: "FAILED" })]} />);
    fireEvent.contextMenu(screen.getByText("photo.png"));
    expect(labels()).toEqual(["Delete attachment"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete attachment" }));
    await waitFor(() =>
      expect(graphqlRequest).toHaveBeenCalledWith(expect.anything(), {
        input: { attachmentId: "att-1", serverId: "ws-1" },
      }),
    );
  });

  it("leaves an attachment still uploading to the message's menu", () => {
    render(<Row attachments={[attachment({ status: "PENDING_UPLOAD" })]} />);
    fireEvent.contextMenu(screen.getByText("photo.png"));
    expect(labels()).toEqual(["Copy text"]);
  });
});
