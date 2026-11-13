import { describe, expect, it } from "vitest";

import {
  addBox,
  defaultLayout,
  moveBox,
  moveBoxTo,
  newBoxId,
  parseLayout,
  removeBox,
  setBoxWidth,
  type HomeLayoutDoc,
} from "./homeLayout";

const layout: HomeLayoutDoc = {
  version: 1,
  boxes: [
    { id: "a", kind: "waiting", width: "half" },
    { id: "b", kind: "mentions", width: "half" },
    { id: "c", kind: "unread", width: "full" },
  ],
};

describe("the Home layout", () => {
  it("is today's Home by default, with the agents' runs only where agents are on", () => {
    expect(defaultLayout(false).boxes.map((box) => box.kind)).toEqual([
      "start",
      "waiting",
      "mentions",
      "unread",
    ]);
    expect(defaultLayout(true).boxes.map((box) => box.kind)).toEqual([
      "start",
      "waiting",
      "mentions",
      "unread",
      "agentRuns",
    ]);
  });

  it("starts with the Getting started box at full width", () => {
    expect(defaultLayout(false).boxes[0]).toEqual({ id: "start", kind: "start", width: "full" });
  });

  it("reads a version 1 layout and keeps what it does not know", () => {
    const stored = {
      version: 1,
      note: "kept",
      boxes: [{ id: "x", kind: "futureThing", width: "full", settings: { x: 1 }, more: [1] }],
    };
    expect(parseLayout(stored)).toEqual(stored);
  });

  it("refuses what is not a layout it can show", () => {
    for (const bad of [
      null,
      [],
      { version: 2, boxes: [] },
      { version: 1 },
      { version: 1, boxes: [{ id: "", kind: "k", width: "half" }] },
      { version: 1, boxes: [{ id: "a", kind: "k", width: "wide" }] },
      { version: 1, boxes: [{ id: "a", kind: "k", width: "half", settings: [] }] },
      {
        version: 1,
        boxes: [
          { id: "a", kind: "k", width: "half" },
          { id: "a", kind: "k", width: "half" },
        ],
      },
    ]) {
      expect(parseLayout(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("moves a box past the boxes hidden here, and not past either end", () => {
    const shown = (box: { id: string }) => box.id !== "b";
    expect(moveBox(layout, "c", -1, shown).boxes.map((box) => box.id)).toEqual(["c", "b", "a"]);
    expect(moveBox(layout, "a", -1)).toBe(layout);
    expect(moveBox(layout, "c", 1)).toBe(layout);
  });

  it("takes a dragged box to the place it was dropped on, leaving hidden boxes in place", () => {
    const four: HomeLayoutDoc = {
      version: 1,
      boxes: [...layout.boxes, { id: "d", kind: "agentRuns", width: "half" }],
    };
    const ids = (doc: HomeLayoutDoc) => doc.boxes.map((box) => box.id);
    expect(ids(moveBoxTo(four, "a", "c"))).toEqual(["b", "c", "a", "d"]);
    expect(ids(moveBoxTo(four, "d", "a"))).toEqual(["d", "a", "b", "c"]);
    const shown = (box: { id: string }) => box.id !== "b";
    expect(ids(moveBoxTo(four, "a", "c", shown))).toEqual(["c", "b", "a", "d"]);
    expect(moveBoxTo(four, "a", "a")).toBe(four);
    expect(moveBoxTo(four, "a", "b", shown)).toBe(four);
  });

  it("resizes, removes and adds boxes with ids unique in the layout", () => {
    expect(setBoxWidth(layout, "a", "full").boxes[0].width).toBe("full");
    expect(removeBox(layout, "b").boxes.map((box) => box.id)).toEqual(["a", "c"]);
    expect(newBoxId(layout, "unread")).toBe("unread");
    const withUnread = addBox(layout, "unread").layout;
    expect(newBoxId(withUnread, "unread")).toBe("unread-2");
    expect(withUnread.boxes.at(-1)).toEqual({ id: "unread", kind: "unread", width: "half" });
  });
});
