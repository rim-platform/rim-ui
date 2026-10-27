import { describe, it, expect } from "vitest";

import { HIGHLIGHT_END, HIGHLIGHT_START, plainMessagePreview, plainSnippet } from "./snippetText";

describe("plainSnippet", () => {
  it("drops a code fence and its language", () => {
    expect(plainSnippet("see ```yaml\nreplicas: 3\n``` and ~~~sh\nls\n~~~")).toBe(
      "see replicas: 3 and ls",
    );
  });

  it("drops emphasis but keeps snake_case", () => {
    expect(plainSnippet("**bold** __strong__ *it* _em_ ~~gone~~ `code` my_var_name")).toBe(
      "bold strong it em gone code my_var_name",
    );
  });

  it("keeps link and image text", () => {
    expect(plainSnippet("read [the docs](https://x.test/a_b) ![diagram](img.png)")).toBe(
      "read the docs diagram",
    );
  });

  it("drops heading, quote and list markers", () => {
    expect(plainSnippet("## Title\n> quoted\n- one\n* two\n+ three\n1. four")).toBe(
      "Title quoted one two three four",
    );
  });

  it("keeps highlight sentinels across bold markers", () => {
    const marked = `${HIGHLIGHT_START}deploy${HIGHLIGHT_END}`;
    expect(plainSnippet(`the **${marked}** failed and *${marked}*`)).toBe(
      `the ${marked} failed and ${marked}`,
    );
  });

  it("drops HTML tags, and scripts and styles with their content", () => {
    expect(
      plainSnippet("<b>raw html</b> <script>alert(1)</script> <img src=x onerror=alert(2)>"),
    ).toBe("raw html");
  });

  it("keeps an autolink's address", () => {
    expect(plainSnippet("see <https://example.com>")).toBe("see https://example.com");
  });

  it("keeps HTML inside code", () => {
    expect(plainSnippet("use `<br>` here")).toBe("use <br> here");
  });

  it("keeps comparisons and a lone pipe in prose", () => {
    expect(plainSnippet("a < b and c > d | e")).toBe("a < b and c > d | e");
  });

  it("reads a table as its cells", () => {
    expect(plainSnippet("| col a | col b |\n|---|---|\n| 1 | 2 |")).toBe("col a col b 1 2");
  });

  it("drops task boxes and thematic breaks", () => {
    expect(plainSnippet("- [ ] todo\n- [x] done")).toBe("todo done");
    expect(plainSnippet("above\n\n---\n\nbelow")).toBe("above below");
  });

  it("keeps highlight sentinels found inside a dropped tag", () => {
    expect(plainSnippet(`<a title="${HIGHLIGHT_START}x${HIGHLIGHT_END}">y</a>`)).toBe(
      `${HIGHLIGHT_START}${HIGHLIGHT_END}y`,
    );
  });
});

describe("plainMessagePreview", () => {
  const PRIYA = "01a17a56-216f-75ed-b860-6980876cf99d";
  const names: Record<string, string> = { [PRIYA]: "Priya Nair", rimp1_maya7: "Maya Chen" };
  const nameOf = (id: string) => names[id];
  const mark = (text: string) => `${HIGHLIGHT_START}${text}${HIGHLIGHT_END}`;

  it("names the member a full token mentions", () => {
    expect(plainMessagePreview(`<@${PRIYA}> can you keep an eye on the canary?`, nameOf)).toBe(
      "@Priya Nair can you keep an eye on the canary?",
    );
  });

  it("names any id the resolver knows, such as a principal id", () => {
    expect(plainMessagePreview("thanks <@rimp1_maya7>!", nameOf)).toBe("thanks @Maya Chen!");
  });

  it("writes @member for an id that names no member", () => {
    expect(plainMessagePreview("ask <@0190aaaa-0000-7000-8000-000000000001> first", nameOf)).toBe(
      "ask @member first",
    );
  });

  it("names a whole id the cut left at the start of an excerpt, and drops a partial one", () => {
    expect(plainMessagePreview(`${PRIYA}> can you`, nameOf, { excerpt: true })).toBe(
      "@Priya Nair can you",
    );
    expect(plainMessagePreview("…b860-6980876cf99d> can you", nameOf, { excerpt: true })).toBe(
      "… can you",
    );
  });

  it("drops what the cut left of a token at the end of an excerpt", () => {
    expect(plainMessagePreview("keep an eye <@01a17a56-216f", nameOf, { excerpt: true })).toBe(
      "keep an eye",
    );
    expect(plainMessagePreview("keep an eye <@", nameOf, { excerpt: true })).toBe("keep an eye");
    expect(plainMessagePreview("keep an eye <", nameOf, { excerpt: true })).toBe("keep an eye");
    expect(plainMessagePreview(`keep an eye <@${PRIYA}…`, nameOf, { excerpt: true })).toBe(
      "keep an eye @Priya Nair…",
    );
  });

  it("leaves the ends of a whole message alone", () => {
    expect(plainMessagePreview("x1> y <", nameOf)).toBe("x1> y <");
    expect(plainMessagePreview("Note> the canary", nameOf, { excerpt: true })).toBe(
      "Note> the canary",
    );
  });

  it("removes Markdown around a mention", () => {
    expect(
      plainMessagePreview(
        `**Release 2.1** is out, <@${PRIYA}> see [notes](https://x.test)`,
        nameOf,
      ),
    ).toBe("Release 2.1 is out, @Priya Nair see notes");
  });

  it("keeps a highlight around a mention and drops one inside its id", () => {
    expect(plainMessagePreview(`${mark(`<@${PRIYA}>`)} said ${mark("deploy")}`, nameOf)).toBe(
      `${mark("@Priya Nair")} said ${mark("deploy")}`,
    );
    expect(
      plainMessagePreview(`ping <@${mark("01a17a56")}-216f-75ed-b860-6980876cf99d>`, nameOf),
    ).toBe("ping @Priya Nair");
  });

  it("keeps a highlight that only opens or closes inside an id balanced", () => {
    expect(
      plainMessagePreview(`<@${HIGHLIGHT_START}${PRIYA}> canary${HIGHLIGHT_END}`, nameOf),
    ).toBe(`@Priya Nair${HIGHLIGHT_START} canary${HIGHLIGHT_END}`);
    expect(plainMessagePreview(`${HIGHLIGHT_START}hey <@${PRIYA}${HIGHLIGHT_END}>`, nameOf)).toBe(
      `${HIGHLIGHT_START}hey ${HIGHLIGHT_END}@Priya Nair`,
    );
  });
});
