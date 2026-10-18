import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

import { LinkPreviewCard, type LinkPreview } from "./LinkPreviewCard";
import { useMessageDisplaySettingsStore } from "../state/useMessageDisplaySettingsStore";
import { openUrl } from "@tauri-apps/plugin-opener";

describe("LinkPreviewCard", () => {
  const fullPreview: LinkPreview = {
    id: "lp-1",
    url: "https://example.com/article",
    title: "Example Article",
    description: "This is a test article about testing.",
    imageUrl: "https://example.com/image.jpg",
    siteName: "Example.com",
  };

  it("renders nothing when no title, description, or image", () => {
    const emptyPreview: LinkPreview = {
      id: "lp-2",
      url: "https://example.com",
      title: null,
      description: null,
      imageUrl: null,
      siteName: null,
    };

    const { container } = render(<LinkPreviewCard preview={emptyPreview} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders title when provided", () => {
    render(<LinkPreviewCard preview={fullPreview} />);
    expect(screen.getByText("Example Article")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<LinkPreviewCard preview={fullPreview} />);
    expect(screen.getByText("This is a test article about testing.")).toBeInTheDocument();
  });

  it("renders site name when provided", () => {
    render(<LinkPreviewCard preview={fullPreview} />);
    expect(screen.getByText("Example.com")).toBeInTheDocument();
  });

  it("renders image when imageUrl is provided", () => {
    const { container } = render(<LinkPreviewCard preview={fullPreview} />);
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/image.jpg");
  });

  it("does not render image when imageUrl is null", () => {
    const noImagePreview: LinkPreview = {
      ...fullPreview,
      imageUrl: null,
    };
    render(<LinkPreviewCard preview={noImagePreview} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders when only title is provided", () => {
    const titleOnly: LinkPreview = {
      id: "lp-3",
      url: "https://example.com",
      title: "Just a Title",
      description: null,
      imageUrl: null,
      siteName: null,
    };
    render(<LinkPreviewCard preview={titleOnly} />);
    expect(screen.getByText("Just a Title")).toBeInTheDocument();
  });

  it("renders when only description is provided", () => {
    const descOnly: LinkPreview = {
      id: "lp-4",
      url: "https://example.com",
      title: null,
      description: "Just a description",
      imageUrl: null,
      siteName: null,
    };
    render(<LinkPreviewCard preview={descOnly} />);
    expect(screen.getByText("Just a description")).toBeInTheDocument();
  });

  it("renders when only imageUrl is provided", () => {
    const imageOnly: LinkPreview = {
      id: "lp-5",
      url: "https://example.com",
      title: null,
      description: null,
      imageUrl: "https://example.com/image.jpg",
      siteName: null,
    };
    const { container } = render(<LinkPreviewCard preview={imageOnly} />);
    expect(container.querySelector("img")).toBeInTheDocument();
  });

  it("is clickable (renders as button)", () => {
    render(<LinkPreviewCard preview={fullPreview} />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  it("loads the preview image lazily without a referrer", () => {
    const { container } = render(<LinkPreviewCard preview={fullPreview} />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("hides the preview image when inline media is off", () => {
    useMessageDisplaySettingsStore.setState({ showInlineMedia: false });
    try {
      const { container } = render(<LinkPreviewCard preview={fullPreview} />);
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByText("Example Article")).toBeInTheDocument();
    } finally {
      useMessageDisplaySettingsStore.setState({ showInlineMedia: true });
    }
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:image/png;base64,AAAA",
    "/relative.png",
  ])("never loads a preview image from %s", (imageUrl) => {
    const { container } = render(<LinkPreviewCard preview={{ ...fullPreview, imageUrl }} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("hides an image that fails to load", () => {
    const { container } = render(<LinkPreviewCard preview={fullPreview} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not open a preview whose URL is not http(s)", () => {
    vi.mocked(openUrl).mockClear();
    render(<LinkPreviewCard preview={{ ...fullPreview, url: "javascript:alert(1)" }} />);
    const card = screen.getByRole("button");
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("offers Open link and Copy link address on a right click", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.mocked(openUrl).mockClear();
    render(<LinkPreviewCard preview={fullPreview} />);

    fireEvent.contextMenu(screen.getByRole("button", { name: /Example Article/ }));
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Open link",
      "Copy link address",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link address" }));
    expect(writeText).toHaveBeenCalledWith("https://example.com/article");

    fireEvent.contextMenu(screen.getByRole("button", { name: /Example Article/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open link" }));
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com/article"));
  });

  it("opens no menu for a preview whose URL may not open", () => {
    render(<LinkPreviewCard preview={{ ...fullPreview, url: "javascript:alert(1)" }} />);
    fireEvent.contextMenu(screen.getByRole("button", { name: /Example Article/ }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
