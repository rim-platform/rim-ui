import "../../test/mocks/tauri";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkdownRenderer } from "./MarkdownRenderer";

/** Replaces the clipboard (after userEvent installed its own) with a spy. */
function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

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
    const { container } = render(<MarkdownRenderer content="test" className="my-class" />);
    expect(container.firstElementChild).toHaveClass("my-class");
  });

  it("sanitizes dangerous HTML via DOMPurify", () => {
    const { container } = render(<MarkdownRenderer content='<script>alert("xss")</script>Hello' />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("Hello");
  });

  it("renders code blocks", () => {
    render(<MarkdownRenderer content="`inline code`" />);
    expect(screen.getByText("inline code").tagName).toBe("CODE");
  });

  it("renders lists", () => {
    const { container } = render(<MarkdownRenderer content={"- Item A\n- Item B\n- Item C"} />);
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

  it("highlights a fenced code block once the highlighter loads", async () => {
    const { container } = render(<MarkdownRenderer content={"```ts\nconst x = 1;\n```"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("const x = 1;");
    await waitFor(() => expect(container.querySelector("code.hljs .hljs-keyword")).not.toBeNull());
    expect(container.querySelector("code")?.textContent).toBe("const x = 1;");
  });

  it("gives a code block a language label and a copy button", () => {
    const { container } = render(<MarkdownRenderer content={"```rust\nfn main() {}\n```"} />);
    expect(container.querySelector(".rim-code-language")?.textContent).toBe("rust");
    expect(screen.getByRole("button", { name: "Copy rust code" })).toBeInTheDocument();
  });

  it("copies the code, not the header, when the copy button is clicked", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<MarkdownRenderer content={"```\nline one\nline two\n```"} />);
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("line one\nline two");
    expect(await screen.findByRole("button", { name: "Copied" })).toHaveTextContent("Copied");
  });

  it("copies with the keyboard", async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<MarkdownRenderer content={"```sh\necho hi\n```"} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "Copy sh code" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(writeText).toHaveBeenCalledWith("echo hi");
  });

  it("does not add a copy button to inline code", () => {
    render(<MarkdownRenderer content="`inline`" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders blockquotes", () => {
    const { container } = render(<MarkdownRenderer content="> a quote" />);
    expect(container.querySelector("blockquote")?.textContent?.trim()).toBe("a quote");
  });

  it("renders Markdown images as links when inline media is off", () => {
    const { container } = render(
      <MarkdownRenderer content="![pic](https://example.com/p.png)" showInlineMedia={false} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: "pic" })).toHaveAttribute(
      "href",
      "https://example.com/p.png",
    );
  });

  it("opens a link through the system opener", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    vi.mocked(openUrl).mockClear();
    const user = userEvent.setup();
    render(<MarkdownRenderer content="[safe](https://example.com)" />);
    await user.click(screen.getByText("safe"));
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.com"));
  });
});
