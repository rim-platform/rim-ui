import { describe, it, expect } from "vitest";

import { makeEmptyDraftLayer, layerFromExisting } from "./rotationLayer";
import { RotationKindGql } from "../../../core/graphql/generated/schema-types";

describe("makeEmptyDraftLayer", () => {
  it("returns a WEEKLY-default draft with the given priority and no participants", () => {
    const draft = makeEmptyDraftLayer(2);
    expect(draft).toMatchObject({
      name: "",
      priority: 2,
      kind: RotationKindGql.WEEKLY,
      handoffTime: "09:00:00",
      handoffWeekday: 0,
      intervalSeconds: 86400,
      participantIds: [],
    });
    expect(draft.id).toBeUndefined();
  });
});

describe("layerFromExisting", () => {
  it("maps a RotationLayerGql into a draft, carrying its id and participants", () => {
    const layer = {
      id: "layer-1",
      scheduleId: "sched-1",
      name: "Primary",
      priority: 1,
      kind: RotationKindGql.WEEKLY,
      handoffTime: "10:00:00",
      handoffWeekday: 2,
      intervalSeconds: null,
      anchorAt: "2026-07-01T10:00:00Z",
      createdAt: "",
      participants: ["u1", "u2"],
    };

    const draft = layerFromExisting(layer);

    expect(draft.id).toBe("layer-1");
    expect(draft.name).toBe("Primary");
    expect(draft.priority).toBe(1);
    expect(draft.handoffWeekday).toBe(2);
    expect(draft.participantIds).toEqual(["u1", "u2"]);
    // anchorAt is converted to a datetime-local value, not the raw ISO string.
    expect(draft.anchorAt).not.toBe(layer.anchorAt);
    expect(draft.anchorAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("defaults handoffTime/handoffWeekday/intervalSeconds when the backend omits them", () => {
    const layer = {
      id: "layer-2",
      scheduleId: "sched-1",
      name: "Custom",
      priority: 0,
      kind: RotationKindGql.CUSTOM,
      handoffTime: null,
      handoffWeekday: null,
      intervalSeconds: 3600,
      anchorAt: "2026-07-01T00:00:00Z",
      createdAt: "",
      participants: [],
    };

    const draft = layerFromExisting(layer);

    expect(draft.handoffTime).toBe("09:00:00");
    expect(draft.handoffWeekday).toBe(0);
    expect(draft.intervalSeconds).toBe(3600);
  });

  it("does not mutate the original participants array (defensive copy)", () => {
    const participants = ["u1"];
    const layer = {
      id: "layer-3",
      scheduleId: "sched-1",
      name: "Layer",
      priority: 0,
      kind: RotationKindGql.WEEKLY,
      handoffTime: "09:00:00",
      handoffWeekday: 0,
      intervalSeconds: null,
      anchorAt: "2026-07-01T00:00:00Z",
      createdAt: "",
      participants,
    };

    const draft = layerFromExisting(layer);
    draft.participantIds.push("u2");

    expect(participants).toEqual(["u1"]);
  });
});
