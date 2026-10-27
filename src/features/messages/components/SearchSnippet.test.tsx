import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SearchSnippet } from "./SearchSnippet";

const PRIYA = "01a17a56-216f-75ed-b860-6980876cf99d";
const names: Record<string, string> = { [PRIYA]: "Priya Nair" };
const nameOf = (userId: string) => names[userId];
const noNames = () => undefined;

describe("SearchSnippet", () => {
  it("renders the mark highlight from a clean headline", () => {
    render(
      <SearchSnippet
        nameOf={noNames}
        headline="the <mark>deploy</mark> failed"
        text="the deploy failed"
      />,
    );
    const mark = screen.getByText("deploy");
    expect(mark.tagName).toBe("MARK");
  });

  it("strips an injected <img onerror> while keeping the <mark> highlight (XSS)", () => {
    const { container } = render(
      <SearchSnippet
        nameOf={noNames}
        headline="<img src=x onerror=alert(1)><mark>hit</mark>"
        text="hit"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    const mark = container.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe("hit");
  });

  it("strips a <script> tag embedded in the headline", () => {
    const { container } = render(
      <SearchSnippet
        nameOf={noNames}
        headline="<script>alert(1)</script><mark>safe</mark>"
        text="safe"
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("safe");
  });

  it("strips attributes even on the allowed <mark> tag", () => {
    const { container } = render(
      <SearchSnippet
        nameOf={noNames}
        headline='<mark onclick="alert(1)" class="x">hit</mark>'
        text="hit"
      />,
    );
    const mark = container.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("onclick")).toBeNull();
    expect(mark?.getAttribute("class")).toBeNull();
  });

  it("falls back to plain text without markup when headline is null", () => {
    render(
      <SearchSnippet nameOf={noNames} headline={null} text="<script>alert(1)</script>plain text" />,
    );
    expect(screen.getByText("plain text")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("shows a fenced code block's text without backticks or yaml", () => {
    const { container } = render(
      <SearchSnippet
        nameOf={noNames}
        headline={"config:\n```yaml\n<mark>replicas</mark>: 3\n```"}
        text="config"
      />,
    );
    expect(container.textContent).toBe("config: replicas: 3");
    expect(container.querySelector("mark")?.textContent).toBe("replicas");
  });

  it("keeps the highlight inside bold", () => {
    const { container } = render(
      <SearchSnippet
        nameOf={noNames}
        headline="the **<mark>deploy</mark>** failed"
        text="the deploy failed"
      />,
    );
    expect(container.textContent).toBe("the deploy failed");
    expect(container.querySelector("mark")?.textContent).toBe("deploy");
  });

  it("decodes the desktop cache's escaped snippet", () => {
    const { container } = render(
      <SearchSnippet
        nameOf={noNames}
        headline={"a &lt;b&gt; &amp; c &lt; d <mark>deploy</mark>"}
        text="a <b> & c < d deploy"
      />,
    );
    expect(container.textContent).toBe("a & c < d deploy");
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("deploy");
  });

  it("names a mentioned member in a snippet", () => {
    const { container } = render(
      <SearchSnippet
        headline={`<@${PRIYA}> can you keep an eye on the <mark>canary</mark>?`}
        text={`<@${PRIYA}> can you keep an eye on the canary?`}
        nameOf={nameOf}
      />,
    );
    expect(container.textContent).toBe("@Priya Nair can you keep an eye on the canary?");
    expect(container.querySelector("mark")?.textContent).toBe("canary");
  });

  it("names the member whose token the server's cut left without its <@", () => {
    const { container } = render(
      <SearchSnippet
        headline={`${PRIYA}> can you keep an eye on the <mark>canary</mark> before <@01a17a56-21`}
        text=""
        nameOf={nameOf}
      />,
    );
    expect(container.textContent).toBe("@Priya Nair can you keep an eye on the canary before");
  });

  it("drops a highlight that lands inside a mention's id", () => {
    const { container } = render(
      <SearchSnippet
        headline={`ping <@<mark>01a17a56</mark>-216f-75ed-b860-6980876cf99d> about **<mark>deploy</mark>**`}
        text=""
        nameOf={nameOf}
      />,
    );
    expect(container.textContent).toBe("ping @Priya Nair about deploy");
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["deploy"]);
  });

  it("names a mention in the plain text when headline is null", () => {
    const { container } = render(
      <SearchSnippet headline={null} text={`**hi** <@${PRIYA}>`} nameOf={nameOf} />,
    );
    expect(container.textContent).toBe("hi @Priya Nair");
  });
});
