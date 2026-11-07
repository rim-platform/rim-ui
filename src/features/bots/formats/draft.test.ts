import { describe, expect, it } from "vitest";

import { draftToFormat, formatToDraft, placeRefusal } from "./draft";

const GITHUB_RULE = {
  when: [
    { header: "X-GitHub-Event", equals: "pull_request" },
    { field: "pull_request.merged", equals: "true" },
  ],
  post: "{repository.full_name}: merged #{pull_request.number}",
  link: { value: "{pull_request.html_url}", origin: "https://github.com/" },
};

describe("a format's JSON and the editor's rules", () => {
  it("round-trips: JSON read into rules writes the same JSON back", () => {
    const format = { version: 1, rules: [GITHUB_RULE, { when: [], post: "always" }] };
    const read = formatToDraft(format);
    if (!("rules" in read)) throw new Error(read.error);
    expect(read.rules).toHaveLength(2);
    expect(read.rules[0].conditions.map((c) => c.kind)).toEqual(["header", "field"]);
    expect(draftToFormat(read.rules)).toEqual(format);
  });

  it("reads a rule with no `when` as one that always holds", () => {
    const read = formatToDraft({ version: 1, rules: [{ post: "hi" }] });
    if (!("rules" in read)) throw new Error(read.error);
    expect(read.rules[0].conditions).toEqual([]);
    expect(draftToFormat(read.rules).rules[0]).toEqual({ when: [], post: "hi" });
  });

  it("names an unknown key or a wrong type rather than dropping it", () => {
    for (const [json, said] of [
      [[], "an object, not a list"],
      [{ version: 2, rules: [] }, "`version` 1"],
      [{ version: 1, rules: [], extra: 1 }, "`extra`"],
      [{ version: 1, rules: [{ post: "x", posts: "y" }] }, "Rule 1 has no key `posts`"],
      [
        { version: 1, rules: [{ post: "x" }, { when: [{ field: "a", equal: "b" }], post: "y" }] },
        "Rule 2",
      ],
      [
        { version: 1, rules: [{ when: [{ field: "a", equals: true }], post: "x" }] },
        'such as "true"',
      ],
      [
        { version: 1, rules: [{ when: [{ header: "x-a", field: "a", equals: "b" }], post: "x" }] },
        "either",
      ],
      [{ version: 1, rules: [{ post: 7 }] }, "`post` text"],
    ] as const) {
      const read = formatToDraft(json);
      expect("error" in read && read.error, JSON.stringify(json)).toContain(said);
    }
  });

  it("leaves out a link with both parts empty", () => {
    const read = formatToDraft({ version: 1, rules: [{ post: "x" }] });
    if (!("rules" in read)) throw new Error(read.error);
    read.rules[0].link = { value: "", origin: "" };
    expect(draftToFormat(read.rules).rules[0]).not.toHaveProperty("link");
  });

  it("places a refusal on the rule its message names", () => {
    expect(placeRefusal("Rule 2: `post` is blank.")).toEqual({
      rule: 2,
      reason: "`post` is blank.",
    });
    expect(placeRefusal("The format is over 16 KiB.")).toEqual({
      rule: null,
      reason: "The format is over 16 KiB.",
    });
  });
});
