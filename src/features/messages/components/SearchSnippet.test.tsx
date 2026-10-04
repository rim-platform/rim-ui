import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SearchSnippet } from "./SearchSnippet";

describe("SearchSnippet", () => {
  it("renders the mark highlight from a clean headline", () => {
    render(<SearchSnippet headline="the <mark>deploy</mark> failed" text="the deploy failed" />);
    const mark = screen.getByText("deploy");
    expect(mark.tagName).toBe("MARK");
  });

  it("strips an injected <img onerror> while keeping the <mark> highlight (XSS)", () => {
    const { container } = render(
      <SearchSnippet headline="<img src=x onerror=alert(1)><mark>hit</mark>" text="hit" />,
    );
    expect(container.querySelector("img")).toBeNull();
    const mark = container.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe("hit");
  });

  it("strips a <script> tag embedded in the headline", () => {
    const { container } = render(
      <SearchSnippet headline="<script>alert(1)</script><mark>safe</mark>" text="safe" />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("safe");
  });

  it("strips attributes even on the allowed <mark> tag", () => {
    const { container } = render(
      <SearchSnippet headline='<mark onclick="alert(1)" class="x">hit</mark>' text="hit" />,
    );
    const mark = container.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("onclick")).toBeNull();
    expect(mark?.getAttribute("class")).toBeNull();
  });

  it("falls back to escaped plain text when headline is null", () => {
    render(<SearchSnippet headline={null} text="<script>alert(1)</script>plain text" />);
    // React auto-escapes text content — the literal string is shown, not executed.
    expect(screen.getByText("<script>alert(1)</script>plain text")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
});
