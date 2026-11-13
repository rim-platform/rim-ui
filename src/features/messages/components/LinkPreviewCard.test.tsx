import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

import { LinkPreviewCard, type LinkPreview } from "./LinkPreviewCard";
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

  it.each([
    ["the web", false],
    ["the desktop", true],
  ])("shows no image on %s, so no other site is asked for one", (_where, desktop) => {
    if (desktop) (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    try {
      const { container } = render(<LinkPreviewCard preview={fullPreview} />);
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByText("Example Article")).toBeInTheDocument();
    } finally {
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });

  it("renders nothing when no title or description", () => {
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

  it("renders nothing when only an image is known", () => {
    const imageOnly: LinkPreview = {
      id: "lp-5",
      url: "https://example.com",
      title: null,
      description: null,
      imageUrl: "https://example.com/image.jpg",
      siteName: null,
    };
    const { container } = render(<LinkPreviewCard preview={imageOnly} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is clickable (renders as button)", () => {
    render(<LinkPreviewCard preview={fullPreview} />);
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
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
