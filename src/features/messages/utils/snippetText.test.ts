import { describe, it, expect } from "vitest";

import { HIGHLIGHT_END, HIGHLIGHT_START, plainSnippet } from "./snippetText";

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
});
