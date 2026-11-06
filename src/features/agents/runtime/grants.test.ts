import { describe, expect, it } from "vitest";

import { grantCovers, grantMayCover, hasGrantIn, type AgentGrants } from "./grants";

const CHANNEL = { id: "c1", isChannel: true, encrypted: false };
const DM = { id: "c1", isChannel: false, encrypted: false };
const ENCRYPTED = { id: "c1", isChannel: true, encrypted: true };

const BY_ID: AgentGrants = { w1: { all: false, channelIds: ["c1"] } };
const ALL: AgentGrants = { w1: { all: true, channelIds: [] } };

describe("grantCovers", () => {
  it("covers nothing with no grant", () => {
    expect(grantCovers({}, "w1", CHANNEL)).toBe(false);
    expect(grantCovers({ w1: { all: false, channelIds: [] } }, "w1", CHANNEL)).toBe(false);
  });

  it("covers a channel by its id", () => {
    expect(grantCovers(BY_ID, "w1", CHANNEL)).toBe(true);
    expect(grantCovers(BY_ID, "w1", { ...CHANNEL, id: "c2" })).toBe(false);
  });

  it("covers a channel by all", () => {
    expect(grantCovers(ALL, "w1", CHANNEL)).toBe(true);
  });

  it("keeps a grant to its workspace", () => {
    expect(grantCovers(ALL, "w2", CHANNEL)).toBe(false);
    expect(grantCovers(BY_ID, "w2", CHANNEL)).toBe(false);
  });

  it("never covers a direct message or a group, even by all or by id", () => {
    expect(grantCovers(ALL, "w1", DM)).toBe(false);
    expect(grantCovers(BY_ID, "w1", DM)).toBe(false);
  });

  it("never covers anything encrypted, even by all or by id", () => {
    expect(grantCovers(ALL, "w1", ENCRYPTED)).toBe(false);
    expect(grantCovers(BY_ID, "w1", ENCRYPTED)).toBe(false);
  });

  it("never covers null", () => {
    expect(grantCovers(ALL, "w1", null)).toBe(false);
    expect(grantCovers(BY_ID, "w1", null)).toBe(false);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "finds no grant in a workspace called %s",
    (workspaceId) => {
      expect(grantCovers(ALL, workspaceId, CHANNEL)).toBe(false);
      expect(grantMayCover(ALL, workspaceId, "c1")).toBe(false);
      expect(hasGrantIn(ALL, workspaceId)).toBe(false);
    },
  );
});

describe("grantMayCover", () => {
  it("says no for an id no grant names", () => {
    expect(grantMayCover({}, "w1", "c1")).toBe(false);
    expect(grantMayCover(BY_ID, "w1", "c2")).toBe(false);
  });

  it("says yes for a listed id, and for any id under all", () => {
    expect(grantMayCover(BY_ID, "w1", "c1")).toBe(true);
    expect(grantMayCover(ALL, "w1", "anything")).toBe(true);
  });
});

describe("hasGrantIn", () => {
  it("does not count an entry that grants nothing", () => {
    expect(hasGrantIn({ w1: { all: false, channelIds: [] } }, "w1")).toBe(false);
    expect(hasGrantIn({}, "w1")).toBe(false);
  });

  it("counts all and a listed channel", () => {
    expect(hasGrantIn(ALL, "w1")).toBe(true);
    expect(hasGrantIn(BY_ID, "w1")).toBe(true);
  });
});
