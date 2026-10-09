import { describe, expect, it } from "vitest";

import { commitDelayMs, commitRank, MAX_JITTER_MS } from "./ranking";

const id = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

describe("commitRank", () => {
  it("follows lowercase UUID order and skips pending removes", () => {
    const devices = [id(3), id(1), id(2)];
    expect(commitRank(devices, [], null, id(1))).toBe(0);
    expect(commitRank(devices, [], null, id(3))).toBe(2);
    expect(commitRank(devices, [id(1)], null, id(2))).toBe(0);
    expect(commitRank(devices, [id(1)], null, id(1))).toBeNull();
    expect(commitRank([id(1).toUpperCase()], [], null, id(1))).toBe(0);
  });

  it("puts the member's own other device first for a device link", () => {
    const devices = [id(1), id(2), id(3)];
    expect(commitRank(devices, [], id(3), id(3))).toBe(0);
    expect(commitRank(devices, [], id(3), id(1))).toBe(1);
  });
});

describe("commitDelayMs", () => {
  it("waits 15 s per rank, at most 8 steps, plus at most 3 s of jitter", () => {
    expect(commitDelayMs(0, 0)).toBe(0);
    expect(commitDelayMs(2, 1_000)).toBe(31_000);
    expect(commitDelayMs(20, 9_000)).toBe(8 * 15_000 + MAX_JITTER_MS);
    const random = commitDelayMs(1);
    expect(random).toBeGreaterThanOrEqual(15_000);
    expect(random).toBeLessThanOrEqual(18_000);
  });
});
