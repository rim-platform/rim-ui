import { describe, expect, it } from "vitest";

import { createPaletteSearch, fuzzySearchFactory } from "./paletteSearch";

interface Item {
  title: string;
  description: string;
  category: string;
}

function item(title: string, description: string, category: string): Item {
  return { title, description, category };
}

function titles(results: { item: Item }[]): string[] {
  return results.map((result) => result.item.title);
}

function categories(results: { item: Item }[]): string[] {
  return [...new Set(results.map((result) => result.item.category))];
}

describe("createPaletteSearch", () => {
  it("ranks a title prefix above scattered matches in another category", () => {
    const search = createPaletteSearch([
      item("Invite Member", "Send an invitation to a new member", "Admin"),
      item("Reset Password", "Set a new password for a member", "Admin"),
      item("Search Messages", "Search workspace messages by text content.", "Chat"),
    ]);

    const results = search("sea");

    expect(titles(results)[0]).toBe("Search Messages");
    expect(results[0].titleRanges).toEqual([[0, 2]]);
    expect(categories(results)).toEqual(["Chat", "Admin"]);
  });

  it("orders groups by their best match and items within a group by match quality", () => {
    const search = createPaletteSearch([
      item("Invite Member", "Invite someone to the workspace", "Admin"),
      item("Archive Member", "Move a member to the archive", "Chat"),
      item("Member List", "Show who is in the conversation", "Chat"),
    ]);

    expect(titles(search("mem"))).toEqual(["Member List", "Archive Member", "Invite Member"]);
  });

  it("drops letters scattered through a description", () => {
    const search = createPaletteSearch([
      item("Invite Member", "Send an invitation to a new member", "Admin"),
      item("Export Data", "For researchers and auditors", "Admin"),
    ]);

    expect(search("sea")).toEqual([]);
  });

  it("keeps a description word-start match below every title match", () => {
    const search = createPaletteSearch([
      item("Show Saved", "List the pinned messages", "Chat"),
      item("Purge Inbox", "Empty the inbox", "Admin"),
      item("Pin Message", "Pin the selected message", "Pins"),
    ]);

    const results = search("pin");

    expect(titles(results)).toEqual(["Pin Message", "Purge Inbox", "Show Saved"]);
    expect(results.map((result) => result.tier)).toEqual([0, 0, 1]);
    expect(results[2].titleRanges).toBeNull();
    expect(results[2].descriptionRanges).toEqual([[9, 11]]);
  });

  it("orders titles alphabetically inside a category for an empty query", () => {
    const search = createPaletteSearch([
      item("Create Channel", "Create a channel", "Chat"),
      item("Toggle Zen Mode", "Hide everything but the timeline", "Workspace"),
      item("New Message", "Start a conversation", "Chat"),
      item("Cycle Layout Preset", "Switch to the next saved layout", "Workspace"),
      item("Get Recent Messages", "Read the latest messages", "Chat"),
    ]);

    expect(titles(search(""))).toEqual([
      "Create Channel",
      "Get Recent Messages",
      "New Message",
      "Cycle Layout Preset",
      "Toggle Zen Mode",
    ]);
  });

  it("groups everything alphabetically by category for an empty query", () => {
    const search = createPaletteSearch([
      item("Search Messages", "Search workspace messages", "Chat"),
      item("Invite Member", "Invite someone", "Admin"),
      item("Toggle Zen mode", "Hide everything but the timeline", "Workspace"),
      item("Member List", "Show who is here", "Admin"),
    ]);

    for (const query of ["", "  "]) {
      const results = search(query);
      expect(titles(results)).toEqual([
        "Invite Member",
        "Member List",
        "Search Messages",
        "Toggle Zen mode",
      ]);
      expect(
        results.every((result) => result.titleRanges === null && result.descriptionRanges === null),
      ).toBe(true);
    }
  });
});

describe("fuzzySearchFactory", () => {
  const createFuzzySearch = () => () => [];

  it("takes the function when the default export is the function", () => {
    expect(fuzzySearchFactory({ default: createFuzzySearch })).toBe(createFuzzySearch);
  });

  it("takes the function from the module object a production bundle gives as the default", () => {
    const moduleObject = { __esModule: true, default: createFuzzySearch };
    expect(fuzzySearchFactory({ default: moduleObject })).toBe(createFuzzySearch);
  });

  it("refuses a module without the function", () => {
    expect(() => fuzzySearchFactory({ default: {} })).toThrow(/createFuzzySearch/);
  });
});
