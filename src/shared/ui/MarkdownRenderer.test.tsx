import "../../test/mocks/tauri";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders basic markdown text", () => {
    render(<MarkdownRenderer content="Hello **world**" />);
    expect(screen.getByText("world")).toBeInTheDocument();
    expect(screen.getByText("world").tagName).toBe("STRONG");
  });

  it("renders italic text", () => {
    render(<MarkdownRenderer content="This is *italic*" />);
    expect(screen.getByText("italic")).toBeInTheDocument();
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders links with target=_blank", () => {
    render(<MarkdownRenderer content="[Link](https://example.com)" />);
    const link = screen.getByText("Link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("applies className prop", () => {
    const { container } = render(
      <MarkdownRenderer content="test" className="my-class" />,
    );
    expect(container.firstElementChild).toHaveClass("my-class");
  });

  it("sanitizes dangerous HTML via DOMPurify", () => {
    const { container } = render(
      <MarkdownRenderer content='<script>alert("xss")</script>Hello' />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("Hello");
  });

  it("renders code blocks", () => {
    render(<MarkdownRenderer content="`inline code`" />);
    expect(screen.getByText("inline code").tagName).toBe("CODE");
  });

  it("renders lists", () => {
    const { container } = render(
      <MarkdownRenderer content={"- Item A\n- Item B\n- Item C"} />,
    );
    const listItems = container.querySelectorAll("li");
    expect(listItems).toHaveLength(3);
  });

  it("replaces custom emoji shortcodes with images", () => {
    const emojiMap = new Map([["tada", "https://example.com/tada.png"]]);
    const { container } = render(
      <MarkdownRenderer content="Hello :tada: world" customEmojiMap={emojiMap} />,
    );
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/tada.png");
    expect(img).toHaveAttribute("alt", ":tada:");
  });

  it("does not replace unknown shortcodes", () => {
    const emojiMap = new Map([["tada", "https://example.com/tada.png"]]);
    const { container } = render(
      <MarkdownRenderer content="Hello :unknown: world" customEmojiMap={emojiMap} />,
    );
    expect(container.textContent).toContain(":unknown:");
  });
});
