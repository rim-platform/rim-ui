import { describe, expect, it } from "vitest";

import { caseCollisions } from "./case-check.mjs";

describe("caseCollisions", () => {
  it("finds files whose paths differ only in case", () => {
    expect(caseCollisions(["docs/Readme.md", "docs/README.md", "docs/other.md"])).toEqual([
      ["docs/README.md", "docs/Readme.md"],
    ]);
  });

  it("finds folders that differ only in case, once per pair", () => {
    expect(caseCollisions(["src/Foo/a.ts", "src/foo/b.ts", "src/foo/c.ts"])).toEqual([
      ["src/Foo", "src/foo"],
    ]);
  });

  it("finds modules an extensionless import cannot tell apart", () => {
    expect(caseCollisions(["src/ReplyQuote.tsx", "src/replyQuote.ts"])).toEqual([
      ["src/ReplyQuote.tsx", "src/replyQuote.ts"],
    ]);
    expect(caseCollisions(["src/types.d.ts", "src/Types.ts"])).toEqual([
      ["src/Types.ts", "src/types.d.ts"],
    ]);
  });

  it("finds a module and a folder an import cannot tell apart", () => {
    expect(caseCollisions(["src/Panel.tsx", "src/panel/index.ts"])).toEqual([
      ["src/Panel.tsx", "src/panel"],
    ]);
  });

  it("passes names that differ by more than case", () => {
    expect(
      caseCollisions([
        "src/ReplyQuote.tsx",
        "src/ReplyQuote.test.tsx",
        "src/replyQuoteView.ts",
        "src/panel.ts",
        "src/panel/index.ts",
        "src/styles.css",
        "src/Styles.module.css",
        "other/ReplyQuote.tsx",
      ]),
    ).toEqual([]);
  });

  it("leaves non-module files compared with their extension", () => {
    expect(caseCollisions(["assets/Logo.svg", "assets/logo.png"])).toEqual([]);
  });
});
