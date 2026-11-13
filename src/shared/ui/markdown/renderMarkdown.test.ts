import { describe, expect, it, vi } from "vitest";

import { highlightCode } from "./codeHighlight";
import { renderMarkdown } from "./renderMarkdown";
import { isHttpUrl, isSafeLinkUrl, isSafeMediaUrl } from "./safeUrl";

/** Parses rendered HTML into a detached element for DOM assertions. */
function dom(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

/** Every href and src value in the rendered output, decoded the way the browser reads them. */
function urlsOf(html: string): string[] {
  const root = dom(html);
  return Array.from(root.querySelectorAll("[href], [src]")).flatMap((el) =>
    ["href", "src"].map((name) => el.getAttribute(name)).filter((v): v is string => v !== null),
  );
}

const DANGEROUS_URL = /^\s*(?:javascript|vbscript|data):/i;

describe("renderMarkdown code blocks", () => {
  it("highlights a fenced block with a known language", () => {
    const html = renderMarkdown("```ts\nconst answer: number = 42;\n```", {
      highlight: highlightCode,
    });
    const code = dom(html).querySelector("pre > code");
    expect(code).not.toBeNull();
    expect(code?.className).toBe("hljs language-ts");
    expect(code?.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(code?.textContent).toBe("const answer: number = 42;");
  });

  it("accepts language aliases", () => {
    const html = renderMarkdown("```rs\nfn main() {}\n```", { highlight: highlightCode });
    expect(dom(html).querySelector("code.hljs.language-rs .hljs-keyword")).not.toBeNull();
  });

  it("renders a block without a language as plain code", () => {
    const html = renderMarkdown("```\nplain <b>text</b>\n```", { highlight: highlightCode });
    const code = dom(html).querySelector("pre > code");
    expect(code?.hasAttribute("class")).toBe(false);
    expect(code?.children).toHaveLength(0);
    expect(code?.textContent).toBe("plain <b>text</b>");
  });

  it("renders an unknown language as plain code that keeps its label", () => {
    const html = renderMarkdown("```brainfudge\n+++.\n```", { highlight: highlightCode });
    const code = dom(html).querySelector("pre > code");
    expect(code?.className).toBe("language-brainfudge");
    expect(code?.children).toHaveLength(0);
    expect(code?.textContent).toBe("+++.");
  });

  it("renders plain code until a highlighter is given", () => {
    const html = renderMarkdown("```ts\nconst a = 1;\n```");
    const code = dom(html).querySelector("pre > code");
    expect(code?.className).toBe("language-ts");
    expect(code?.querySelector("span")).toBeNull();
  });

  it("leaves inline code unchanged", () => {
    const html = renderMarkdown("run `npm test` now", { highlight: highlightCode });
    const code = dom(html).querySelector("p > code");
    expect(code?.textContent).toBe("npm test");
    expect(code?.hasAttribute("class")).toBe(false);
  });
});

describe("renderMarkdown raw HTML", () => {
  it("shows a word in angle brackets as typed", () => {
    const root = dom(renderMarkdown("Vote in the Poll panel, or reply /vote <number>"));
    expect(root.querySelector("p")?.textContent).toBe(
      "Vote in the Poll panel, or reply /vote <number>",
    );
  });

  it("shows inline tags as text instead of markup", () => {
    const root = dom(renderMarkdown("<b>bold</b> and <s>old</s>"));
    expect(root.querySelector("b, s")).toBeNull();
    expect(root.querySelector("p")?.textContent).toBe("<b>bold</b> and <s>old</s>");
  });

  it("shows an HTML block as a paragraph of text with its line breaks", () => {
    const root = dom(renderMarkdown("<div>\nhi\n</div>"));
    expect(root.querySelector("div")).toBeNull();
    const p = root.querySelector("p");
    expect(p?.querySelectorAll("br")).toHaveLength(2);
    expect(p?.textContent).toBe("<div>hi</div>");
  });

  it("shows a tag alone on its line and an HTML comment as typed", () => {
    const root = dom(renderMarkdown("<number>\n\nbefore\n<!-- note -->\nafter"));
    expect(Array.from(root.querySelectorAll("p"), (p) => p.textContent)).toEqual([
      "<number>",
      "before",
      "<!-- note -->",
      "after",
    ]);
  });

  it("keeps an autolink, a mention, a custom emoji and a code block around raw HTML", () => {
    const root = dom(
      renderMarkdown("<https://example.com> <@user-1> :party: <i>x</i>\n\n```\n<b>code</b>\n```", {
        memberMap: new Map([["user-1", "Ada"]]),
        customEmojiMap: new Map([["party", "https://other.example/e.png"]]),
      }),
    );
    expect(root.querySelector('a[href="https://example.com"]')).not.toBeNull();
    expect(root.querySelector(".mention")?.textContent).toBe("@Ada");
    expect(root.querySelector('img[src="https://other.example/e.png"]')).not.toBeNull();
    expect(root.querySelector("i")).toBeNull();
    expect(root.querySelector("p")?.textContent).toContain("<i>x</i>");
    expect(root.querySelector("pre > code")?.textContent).toBe("<b>code</b>");
  });
});

describe("renderMarkdown sanitising", () => {
  it("keeps markup inside a code fence as text", () => {
    const html = renderMarkdown(
      '```html\n<script>alert(1)</script><img src=x onerror="alert(2)">\n```',
      { highlight: highlightCode },
    );
    const root = dom(html);
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("code")?.textContent).toContain("<script>alert(1)</script>");
  });

  it("drops an info string that tries to break out of the class attribute", () => {
    const html = renderMarkdown('```ts"><img src=x onerror=alert(1)>\ncode\n```', {
      highlight: highlightCode,
    });
    const root = dom(html);
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.querySelector("pre > code")?.hasAttribute("class")).toBe(false);
  });

  it("drops a fence closed early to smuggle raw HTML", () => {
    const html = renderMarkdown("```js\nx\n```\n<img src=x onerror=alert(1)><script>1</script>");
    const root = dom(html);
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("[onerror]")).toBeNull();
  });

  it.each([
    ["javascript image", "![x](javascript:alert(1))"],
    ["mixed-case javascript image", "![x](JaVaScRiPt:alert(1))"],
    ["data html image", "![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
    ["data svg image", "![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)"],
    ["javascript link", "[click](javascript:alert(1))"],
    ["data html link", "[click](data:text/html,<script>alert(1)</script>)"],
    ["vbscript link", "[click](vbscript:msgbox(1))"],
    ["reference link to javascript", "[x][evil]\n\n[evil]: javascript:alert(1)"],
  ])("removes a dangerous URL: %s", (_name, markdown) => {
    for (const showInlineMedia of [true, false]) {
      const html = renderMarkdown(markdown, { showInlineMedia });
      for (const url of urlsOf(html)) {
        // eslint-disable-next-line no-control-regex
        expect(url.replace(/[\u0000- ]/g, "")).not.toMatch(DANGEROUS_URL);
      }
      expect(html.toLowerCase()).not.toContain("javascript:");
      expect(html.toLowerCase()).not.toContain("data:text/html");
    }
  });

  it.each([
    ["raw img with javascript src", '<img src="javascript:alert(1)">'],
    ["raw img with data html src", '<img src="data:text/html,<script>alert(1)</script>">'],
    ["raw anchor with data html href", '<a href="data:text/html,<b>x</b>">x</a>'],
    ["raw anchor with entity-encoded javascript", '<a href="&#106;avascript:alert(1)">x</a>'],
    ["raw anchor with a tab in the scheme", '<a href="java\tscript:alert(1)">x</a>'],
  ])("shows a raw tag with a dangerous URL as text: %s", (_name, markdown) => {
    for (const showInlineMedia of [true, false]) {
      const root = dom(renderMarkdown(markdown, { showInlineMedia }));
      expect(root.querySelector("img, a")).toBeNull();
      expect(urlsOf(root.innerHTML)).toEqual([]);
      expect(root.textContent).toContain(markdown.slice(0, 4));
    }
  });

  it("removes event handler attributes and script elements from raw HTML", () => {
    const html = renderMarkdown(
      '<p onclick="alert(1)">hi</p><svg onload="alert(1)"></svg><iframe src="https://x"></iframe><script>alert(1)</script>',
    );
    const root = dom(html);
    expect(root.querySelector("[onclick], [onload], svg, iframe, script")).toBeNull();
    expect(root.textContent).toContain("hi");
  });

  it("loads nothing for a raw img that is not a server file", () => {
    expect(dom(renderMarkdown('<img src=x alt="a">')).querySelector("[src]")).toBeNull();
  });

  it("hands raw HTML to the parser only as escaped text", () => {
    const spy = vi.spyOn(DOMParser.prototype, "parseFromString");
    try {
      renderMarkdown("<img src=x onerror=alert(1)>");
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.every(([html]) => !/<img/i.test(String(html)))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("gives raw HTML no element, class or data attribute", () => {
    const html = renderMarkdown(
      '<span class="fixed inset-0 z-50 mention" data-user-id="u1">x</span><p class="bg-rim-danger">y</p>',
    );
    const root = dom(html);
    expect(root.querySelector("span, [class], [data-user-id]")).toBeNull();
    expect(root.querySelectorAll("p")).toHaveLength(1);
  });

  it("opens links in a new context without a referrer", () => {
    const html = renderMarkdown("[a](https://example.com) <https://b.example>");
    const links = dom(html).querySelectorAll("a");
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("keeps the inline markup of link text", () => {
    const html = renderMarkdown("[**bold** link](https://example.com)");
    expect(dom(html).querySelector("a > strong")?.textContent).toBe("bold");
  });
});

describe("renderMarkdown images", () => {
  it("renders an image lazily, bounded and without a referrer", () => {
    const src = `${window.location.origin}/api/files/ws/a/d.png`;
    const html = renderMarkdown(`![diagram](${src})`);
    const img = dom(html).querySelector("img");
    expect(img?.getAttribute("src")).toBe(src);
    expect(img?.getAttribute("alt")).toBe("diagram");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img?.className).toBe("rim-md-image");
  });

  it("renders an image as a link when inline media is off", () => {
    const html = renderMarkdown("![diagram](https://example.com/d.png)", {
      showInlineMedia: false,
    });
    const root = dom(html);
    expect(root.querySelector("img")).toBeNull();
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/d.png");
    expect(link?.textContent).toBe("diagram");
  });

  it("renders an image from another site as a link labelled image", () => {
    const root = dom(renderMarkdown("![diagram](https://example.com/d.png)"));
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector('a[href="https://example.com/d.png"]')?.textContent).toBe("diagram");
    expect(root.querySelector(".rim-md-image-label")?.textContent).toBe("image");
  });

  it("uses the address as the link text of an image without alt text", () => {
    const root = dom(renderMarkdown("![](https://example.com/d.png)"));
    expect(root.querySelector("a")?.textContent).toBe("https://example.com/d.png");
  });

  it("renders a same-origin image outside the server's files as a link", () => {
    expect(dom(renderMarkdown("![x](/settings)")).querySelector("img")).toBeNull();
  });

  it("keeps a custom emoji image from the emoji map wherever it is", () => {
    const html = renderMarkdown(":party:", {
      customEmojiMap: new Map([["party", "https://other.example/e.png"]]),
    });
    const img = dom(html).querySelector('img[src="https://other.example/e.png"]');
    expect(img?.classList.contains("object-contain")).toBe(true);
  });

  it("keeps a custom emoji whose image is an object URL from the emoji map", () => {
    const html = renderMarkdown(":party:", {
      customEmojiMap: new Map([["party", "blob:tauri://localhost/1"]]),
    });
    expect(dom(html).querySelector('img[src="blob:tauri://localhost/1"]')).not.toBeNull();
    const raw = renderMarkdown('<img src="blob:tauri://localhost/1">');
    expect(dom(raw).querySelector("[src]")).toBeNull();
  });
});

describe("renderMarkdown blockquotes and mentions", () => {
  it("renders a blockquote", () => {
    const html = renderMarkdown("> quoted *text*\n\nafter");
    const quote = dom(html).querySelector("blockquote");
    expect(quote?.querySelector("p")?.textContent).toBe("quoted text");
    expect(quote?.querySelector("em")?.textContent).toBe("text");
  });

  it("renders nested blockquotes", () => {
    const html = renderMarkdown("> outer\n>> inner");
    expect(dom(html).querySelector("blockquote blockquote")?.textContent).toContain("inner");
  });

  it("resolves mention tokens into mention spans", () => {
    const html = renderMarkdown("hi <@user-1>", { memberMap: new Map([["user-1", "Ada"]]) });
    const mention = dom(html).querySelector(".mention");
    expect(mention?.textContent).toBe("@Ada");
    expect(mention?.getAttribute("data-user-id")).toBe("user-1");
  });
});

describe("renderMarkdown line breaks and GFM", () => {
  it("renders a single newline as a line break", () => {
    const html = renderMarkdown("line one\nline two\nline three");
    const p = dom(html).querySelector("p");
    expect(p?.querySelectorAll("br")).toHaveLength(2);
    expect(p?.textContent).toBe("line oneline twoline three");
  });

  it("keeps a code block's newlines as text, without line breaks", () => {
    const root = dom(renderMarkdown("```\na\nb\n```"));
    expect(root.querySelector("br")).toBeNull();
    expect(root.querySelector("pre > code")?.textContent).toBe("a\nb");
  });

  it("renders strikethrough", () => {
    const root = dom(renderMarkdown("~~gone~~ and ~old~"));
    expect(Array.from(root.querySelectorAll("del"), (d) => d.textContent)).toEqual(["gone", "old"]);
  });

  it("renders a table with its header row", () => {
    const root = dom(renderMarkdown("| col a | col b |\n|:---|---:|\n| 1 | 2 |"));
    const texts = (selector: string) =>
      Array.from(root.querySelectorAll(selector), (cell) => cell.textContent);
    expect(texts("thead th")).toEqual(["col a", "col b"]);
    expect(texts("tbody td")).toEqual(["1", "2"]);
    expect(root.querySelector("[align]")).toBeNull();
  });

  it("renders a horizontal rule", () => {
    expect(dom(renderMarkdown("above\n\n---\n\nbelow")).querySelectorAll("hr")).toHaveLength(1);
  });

  it("renders task-list items as disabled checkboxes", () => {
    const boxes = dom(renderMarkdown("- [ ] todo\n- [x] done")).querySelectorAll<HTMLInputElement>(
      "input[type=checkbox]",
    );
    expect(boxes).toHaveLength(2);
    expect(boxes[0].disabled).toBe(true);
    expect(boxes[1].disabled).toBe(true);
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
    expect(boxes[0].getAttributeNames().sort()).toEqual(["disabled", "type"]);
    expect(boxes[1].getAttributeNames().sort()).toEqual(["checked", "disabled", "type"]);
  });

  it("shows a raw input as text, never as a control", () => {
    const root = dom(
      renderMarkdown(
        '<input type="text" value="x"><input type="checkbox" name="n" class="mention" onclick="alert(1)">',
      ),
    );
    expect(root.querySelector("input")).toBeNull();
    expect(root.textContent).toContain('<input type="checkbox"');
  });
});

describe("safe URL checks", () => {
  it("accepts web, mail and relative links", () => {
    expect(isSafeLinkUrl("https://example.com")).toBe(true);
    expect(isSafeLinkUrl("mailto:a@example.com")).toBe(true);
    expect(isSafeLinkUrl("/relative/path")).toBe(true);
    expect(isSafeLinkUrl("#anchor")).toBe(true);
  });

  it("rejects script and data schemes, also with whitespace or controls inside", () => {
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl(" \tJavaScript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("java\nscript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("data:text/html,x")).toBe(false);
    expect(isSafeMediaUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isSafeMediaUrl("blob:https://example.com/id")).toBe(false);
    expect(isSafeMediaUrl("https://example.com/a.png")).toBe(true);
  });

  it("accepts only absolute http(s) URLs as server-supplied URLs", () => {
    expect(isHttpUrl("https://example.com/a.png")).toBe(true);
    expect(isHttpUrl("http://example.com/a.png")).toBe(true);
    expect(isHttpUrl("/a.png")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
  });
});
